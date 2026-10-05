import { randomBytes, randomUUID, createHash } from "node:crypto";
import { isAddress, keccak256, toHex, verifyMessage, type Address, type Hex } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { z } from "zod";
import { invoiceMessage, type InvoicePayload, type PrivateInvoice } from "../lib/api-types";
import { db, transaction } from "./db";
import { requireConfiguration, secret } from "./config";
import { assert } from "./errors";
import { getAuction } from "./auctions";
import { chainClients } from "./chain";

const digest = (value: string) => createHash("sha256").update(value).digest("hex");
const challengeSchema = z.object({ bidder: z.string().refine(isAddress) }).strict();
export async function createChallenge(id: string, input: unknown) {
  requireConfiguration(); const { bidder } = challengeSchema.parse(input); const auction = await getAuction(id);
  assert(auction.phase === "verified-sale" && auction.result?.winnerIdentity.toLowerCase() === bidder.toLowerCase(), 403, "NOT_WINNER", "Only the verified winning identity can claim.");
  assert(Date.parse(auction.result.paymentDeadline) > Date.now(), 409, "PAYMENT_EXPIRED", "The fixed payment window expired. Contact the seller for manual review.");
  const challengeId = randomUUID(); const expiresAt = new Date(Date.now() + 5 * 60 * 1000).toISOString();
  const message = ["Sealed Auctions winner claim v1", `Origin: ${new URL(secret("APP_ORIGIN")).origin}`, `Chain: ${auction.chainId}`, `Registry: ${auction.registry.toLowerCase()}`, `Auction: ${id}`, `Rules: ${auction.rulesHash}`, `Bidder: ${bidder.toLowerCase()}`, `Challenge: ${challengeId}`, `Nonce: ${randomBytes(32).toString("hex")}`, `Expires: ${expiresAt}`].join("\n");
  await db().query("INSERT INTO claim_challenges(id,auction_id,bidder,message,expires_at) VALUES($1,$2,$3,$4,$5)", [challengeId,id,bidder.toLowerCase(),message,expiresAt]);
  return { challengeId, message, expiresAt };
}
export function paymentUri(payload: InvoicePayload): string {
  const amount = BigInt(payload.amount); const decimal = `${amount / 100000000n}.${(amount % 100000000n).toString().padStart(8,"0")}`;
  return `zcash:${payload.destination}?amount=${decimal}&memo=${Buffer.from(payload.reference).toString("base64url")}`;
}
const claimSchema = z.object({ challengeId: z.string().uuid(), signature: z.string().regex(/^0x[0-9a-fA-F]{130}$/) }).strict();
export async function claimInvoice(id: string, input: unknown) {
  const claim = claimSchema.parse(input); const auction = await getAuction(id);
  assert(auction.phase === "verified-sale" && auction.result, 409, "NO_VERIFIED_SALE", "A finalized verified sale is required.");
  assert(Date.parse(auction.result.paymentDeadline) > Date.now(), 409, "PAYMENT_EXPIRED", "The fixed payment window expired. No active invoice can be issued.");
  const destination = secret("SELLER_ZCASH_ADDRESS");
  assert(keccak256(toHex(destination)) === auction.destinationHash, 409, "DESTINATION_CHANGED", "The seller destination no longer matches the opening commitment.");
  const signer = privateKeyToAccount(secret("INVOICE_PRIVATE_KEY") as Hex);
  const token = randomBytes(32).toString("hex");
  const invoice = await transaction(async client => {
    const challenge = (await client.query("SELECT * FROM claim_challenges WHERE id=$1 FOR UPDATE", [claim.challengeId])).rows[0];
    assert(challenge && challenge.auction_id === id && !challenge.consumed_at && new Date(challenge.expires_at).getTime() > Date.now(), 401, "INVALID_CHALLENGE", "Challenge expired, was consumed, or belongs to another auction.");
    assert(challenge.bidder === auction.result!.winnerIdentity.toLowerCase(), 403, "NOT_WINNER", "The claimant is not the verified winner.");
    assert(await verifyMessage({ address: challenge.bidder as Address, message: challenge.message, signature: claim.signature as Hex }), 401, "INVALID_SIGNATURE", "Winner signature is invalid.");
    // Serialize all invoice issuances for this auction, including different valid challenges.
    await client.query("SELECT id FROM auctions WHERE id=$1 FOR UPDATE", [id]);
    let row = (await client.query("SELECT * FROM invoices WHERE auction_id=$1", [id])).rows[0];
    if (!row) {
      const payload: InvoicePayload = { version: 1,id:randomUUID(),auctionId:id,chainId:auction.chainId,registry:auction.registry,rulesHash:auction.rulesHash,resultBlockHash:auction.snapshotHash,resultBlockNumber:auction.snapshotBlock,winnerIdentity:auction.result!.winnerIdentity,destination,destinationHash:auction.destinationHash,network:"testnet",amount:auction.result!.price,reference:`sealed:${randomBytes(24).toString("hex")}`,expiresAt:auction.result!.paymentDeadline };
      const signature = await signer.signMessage({ message: invoiceMessage(payload) });
      row = (await client.query("INSERT INTO invoices(id,auction_id,payload,signature,signer) VALUES($1,$2,$3,$4,$5) RETURNING *", [payload.id,id,payload,signature,signer.address])).rows[0];
    }
    assert(!row.suspended, 409, "INVOICE_SUSPENDED", "Invoice requires review after a chain change.");
    const existingPayload = row.payload as InvoicePayload;
    const existingBlock = await chainClients().publicClient.getBlock({blockNumber:BigInt(existingPayload.resultBlockNumber)});
    assert(existingBlock.hash === existingPayload.resultBlockHash && existingPayload.rulesHash === auction.rulesHash && existingPayload.amount === auction.result!.price && existingPayload.winnerIdentity.toLowerCase() === auction.result!.winnerIdentity.toLowerCase(),409,"INVOICE_SUSPENDED","Invoice references stale chain state and requires manual review.");
    await client.query("UPDATE claim_challenges SET consumed_at=now() WHERE id=$1", [claim.challengeId]);
    await client.query("INSERT INTO claim_sessions(token_hash,invoice_id,expires_at) VALUES($1,$2,now()+interval '24 hours')", [digest(token),row.id]);
    return rowToInvoice(row);
  });
  return { invoice, token };
}
function rowToInvoice(row: Record<string, unknown>): PrivateInvoice {
  const payload = row.payload as InvoicePayload;
  return { payload, signature: row.signature as Hex, signer: row.signer as Address, paymentUri: paymentUri(payload), status: row.suspended ? "needs-review" : row.status === "awaiting-payment" && Date.parse(payload.expiresAt) <= Date.now() ? "expired" : row.status as PrivateInvoice["status"], confirmations: Number(row.confirmations) };
}
export async function getInvoice(id: string, authorization: string | null) {
  assert(/^[0-9a-f-]{36}$/i.test(id), 400, "INVALID_INVOICE", "Invalid invoice ID.");
  const token = authorization?.match(/^Bearer ([0-9a-f]{64})$/)?.[1]; assert(token, 401, "UNAUTHORIZED", "Winner authorization is required.");
  const row = (await db().query("SELECT i.* FROM invoices i JOIN claim_sessions s ON i.id=s.invoice_id WHERE i.id=$1 AND s.token_hash=$2 AND s.expires_at>now()", [id,digest(token)])).rows[0];
  assert(row, 401, "UNAUTHORIZED", "Winner authorization expired or is invalid.");
  const valid = await invoiceCanonical(row.payload);
  if (!valid) { await db().query("UPDATE invoices SET suspended=true,status='needs-review' WHERE id=$1", [id]); row.suspended = true; }
  return { invoice: rowToInvoice(row) };
}
export async function invoiceCanonical(payload: InvoicePayload): Promise<boolean> {
  const auction = await getAuction(payload.auctionId);
  const { publicClient } = chainClients(); const block = await publicClient.getBlock({ blockNumber: BigInt(payload.resultBlockNumber) });
  return payload.network === "testnet" && payload.chainId === auction.chainId && payload.registry.toLowerCase() === auction.registry.toLowerCase() && block.hash === payload.resultBlockHash && auction.phase === "verified-sale" && auction.rulesHash === payload.rulesHash && auction.result?.winnerIdentity.toLowerCase() === payload.winnerIdentity.toLowerCase() && auction.result?.price === payload.amount && auction.destinationHash === payload.destinationHash;
}
