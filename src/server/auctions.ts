import { randomUUID } from "node:crypto";
import { encodeFunctionData,isAddress, keccak256, parseEventLogs, toHex, verifyTypedData, type Address, type Hex } from "viem";
import { z } from "zod";
import { auctionAbi } from "../lib/contract";
import { bidTypedData, type AuctionRules } from "../lib/protocol";
import { DRAND, ciphertextDigest, evaluatorKeyHash, parseCiphertext, roundAfterClose } from "../lib/encryption";
import type { BidReceipt, PublicAuction } from "../lib/api-types";
import { publicConfiguration, requireConfiguration, secret } from "./config";
import { db, transaction } from "./db";
import { ApiFault, assert } from "./errors";
import { chainClients, readSnapshot, relayClient } from "./chain";

export async function getAuction(id: string): Promise<PublicAuction> {
  const meta = (await db().query("SELECT * FROM auctions WHERE id=$1", [id])).rows[0];
  assert(meta, 404, "NOT_FOUND", "Auction not found.");
  const { auction: a, bids, block } = await readSnapshot(id);
  assert(keccak256(toHex(JSON.stringify({title:meta.title,description:meta.description,category:meta.category}))) === a.rules.itemHash,409,"ITEM_MISMATCH","Stored item details do not match the immutable auction commitment.");
  const { address, chain } = chainClients();
  let phase: PublicAuction["phase"] = "open";
  if (a.status === 1) phase = "verified-sale";
  else if (a.status === 2) phase = "verified-no-sale";
  else if (a.status === 3 || block.timestamp >= a.rules.closesAt + BigInt(a.rules.finalizationWindow)) phase = "expired";
  else if (block.timestamp >= a.rules.closesAt) phase = meta.worker_status === "blocked" ? "blocked" : meta.worker_status === "proving" ? "proving" : "opening";
  const value: PublicAuction = {
    id, title: meta.title, description: meta.description, category: meta.category, phase, chainId: chain.id, registry: address,
    rulesHash: a.rulesHash, reserve: a.rules.reserve.toString(), maxAmount: a.rules.maxAmount.toString(),
    closesAt: new Date(Number(a.rules.closesAt) * 1000).toISOString(), finalizationWindow: a.rules.finalizationWindow, paymentWindow: a.rules.paymentWindow,
    seller: a.rules.seller, destinationHash: a.rules.destinationHash, evaluatorKeyHash: a.rules.evaluatorKeyHash, drandChainHash: a.rules.drandChainHash, drandRound: a.rules.drandRound.toString(),
    bidCount: bids.length, capacity: 16, snapshotBlock: block.number.toString(), snapshotHash: block.hash,
    result: a.status === 1 || a.status === 2 ? { sale: a.status === 1, winnerIndex: a.winnerIndex, winnerIdentity: a.winnerIdentity, price: a.price.toString(), finalizedAt: new Date(Number(a.finalizedAt) * 1000).toISOString(), paymentDeadline: new Date(Number(a.finalizedAt + BigInt(a.rules.paymentWindow)) * 1000).toISOString() } : null,
    proofAvailable: Boolean(meta.proof_bundle),
  };
  // Cached state is display/index data only; privileged actions always read the chain.
  await db().query("UPDATE auctions SET public_state=$2 WHERE id=$1", [id, value]);
  return value;
}
export async function listAuctions() {
  const config = await publicConfiguration();
  if (!config.ready) return { auctions: [], config };
  const rows = (await db().query("SELECT id,title,creation_tx FROM auctions WHERE creation_tx IS NOT NULL ORDER BY created_at DESC LIMIT 50")).rows;
  const settled = await Promise.allSettled(rows.map(row => getAuction(row.id)));
  const failure = settled.find(result=>result.status === "rejected" && !(result.reason instanceof ApiFault && result.reason.code === "PENDING_FINALITY"));
  if(failure?.status === "rejected") throw failure.reason;
  return { auctions: settled.flatMap(result => result.status === "fulfilled" ? [result.value] : []), pending: settled.flatMap((result,index)=>result.status === "rejected"?[{id:rows[index].id,title:rows[index].title,transactionHash:rows[index].creation_tx}]:[]), config };
}
const createSchema = z.object({ requestId:z.string().uuid().optional(),title: z.string().trim().min(3).max(120), description: z.string().trim().min(10).max(4000), category: z.string().trim().min(1).max(40).default("Collectible"), reserve: z.string().regex(/^[1-9][0-9]{0,15}$/), maxAmount: z.string().regex(/^[1-9][0-9]{0,15}$/).default("2100000000000000"), closesAt: z.string().datetime(), finalizationWindow: z.number().int().min(60).max(604800).default(86400), paymentWindow: z.number().int().min(60).max(86400).default(3600) }).strict();
export async function createAuction(input: unknown) {
  const config = requireConfiguration(); const value = createSchema.parse(input);
  const reserve = BigInt(value.reserve), maxAmount = BigInt(value.maxAmount);
  assert(reserve <= maxAmount && maxAmount <= 2100000000000000n, 400, "INVALID_AMOUNT", "Reserve must fit the ZEC amount bounds.");
  const closesAt = Math.floor(Date.parse(value.closesAt) / 1000);
  assert(closesAt > Date.now() / 1000 + 60 && closesAt < Date.now() / 1000 + 30 * 86400, 400, "INVALID_DEADLINE", "Close time must be between one minute and 30 days ahead.");
  const destination = secret("SELLER_ZCASH_ADDRESS");
  assert(destination.startsWith("utest1") || destination.startsWith("ztestsapling1"), 503, "INVALID_DESTINATION", "Configure a shielded Zcash testnet destination.");
  const { walletClient, address, account } = relayClient();
  const rules: AuctionRules = { seller: account.address, itemHash: keccak256(toHex(JSON.stringify({ title: value.title, description: value.description, category: value.category }))), destinationHash: keccak256(toHex(destination)), reserve, maxAmount, closesAt: BigInt(closesAt), finalizationWindow: value.finalizationWindow, paymentWindow: value.paymentWindow, evaluatorKeyHash: evaluatorKeyHash(config.evaluatorPublicKey!), drandChainHash: `0x${DRAND.chainHash}`, drandRound: BigInt(roundAfterClose(closesAt, Number(process.env.DRAND_MARGIN_SECONDS || 120))) };
  const requestId=value.requestId || randomUUID(); const requestHash=keccak256(toHex(JSON.stringify({...value,requestId:undefined})));
  const client=await db().connect();
  try {
    assert((await client.query("SELECT pg_try_advisory_lock(914023) AS acquired")).rows[0].acquired,409,"RELAY_BUSY","The relay is processing another transaction. Retry shortly.");
    for(const pending of (await client.query("SELECT id FROM creation_requests WHERE auction_id IS NULL AND NOT failed AND id<>$1",[requestId])).rows) await recoverCreation(pending.id);
    await recoverPendingBids();
    const existing=(await client.query("SELECT * FROM creation_requests WHERE id=$1",[requestId])).rows[0];
    assert(!existing || existing.request_hash===requestHash,409,"REQUEST_CONFLICT","Creation request ID already refers to different rules.");
    if(!existing) {
      const request=await walletClient.prepareTransactionRequest({account,to:address,data:encodeFunctionData({abi:auctionAbi,functionName:"createAuction",args:[rules]})});
      const raw=await walletClient.signTransaction(request); const hash=keccak256(raw);
      // Commit the signed transaction before broadcast. Recovery rebroadcasts these exact bytes.
      await client.query("INSERT INTO creation_requests(id,request_hash,title,description,category,item_hash,transaction_hash,raw_transaction) VALUES($1,$2,$3,$4,$5,$6,$7,$8)",[requestId,requestHash,value.title,value.description,value.category,rules.itemHash,hash,raw]);
    }
    return await recoverCreation(requestId);
  } finally { await client.query("SELECT pg_advisory_unlock(914023)");client.release(); }
}
export async function recoverCreation(requestId:string) {
  const row=(await db().query("SELECT * FROM creation_requests WHERE id=$1",[requestId])).rows[0];
  assert(row,404,"NOT_FOUND","Creation request not found.");
  if(row.auction_id) return {id:row.auction_id,requestId,transactionHash:row.transaction_hash,status:"pending"};
  const {publicClient,address}=chainClients();
  try { await publicClient.sendRawTransaction({serializedTransaction:row.raw_transaction}); }
  catch { /* An identical transaction can already be mined or in the mempool. Receipt remains authoritative. */ }
  const receipt=await publicClient.waitForTransactionReceipt({hash:row.transaction_hash,timeout:45000});
  if(receipt.status!=="success") await db().query("UPDATE creation_requests SET failed=true WHERE id=$1",[requestId]);
  assert(receipt.status==="success",409,"CREATE_REVERTED","Auction creation was rejected by the registry.");
  const event=parseEventLogs({abi:auctionAbi,eventName:"AuctionCreated",logs:receipt.logs}).find(event=>event.address.toLowerCase()===address.toLowerCase());
  assert(event,503,"MISSING_CREATION_EVENT","Registry did not emit the expected creation event.");
  const id=event.args.auctionId.toString();
  await transaction(async client=>{
    await client.query("INSERT INTO auctions(id,title,description,category,item_hash,creation_tx) VALUES($1,$2,$3,$4,$5,$6) ON CONFLICT(id) DO NOTHING",[id,row.title,row.description,row.category,row.item_hash,row.transaction_hash]);
    await client.query("UPDATE creation_requests SET auction_id=$2 WHERE id=$1",[requestId,id]);
  });
  return {id,requestId,transactionHash:row.transaction_hash,status:"pending"};
}
const hex32 = z.string().regex(/^0x[0-9a-fA-F]{64}$/);
const bidSchema = z.object({ bidder: z.string().refine(isAddress), commitment: hex32, ciphertextHash: hex32, signature: z.string().regex(/^0x[0-9a-fA-F]{130}$/), ciphertext: z.string().min(1).max(32768) }).strict();
export async function submitBid(id: string, input: unknown): Promise<BidReceipt> {
  requireConfiguration(); const bid = bidSchema.parse(input);
  const { auction, block } = await readSnapshot(id);
  assert(auction.status === 0 && block.timestamp < auction.rules.closesAt && BigInt(Math.floor(Date.now() / 1000)) < auction.rules.closesAt, 409, "AUCTION_CLOSED", "Bidding is closed.");
  assert(ciphertextDigest(bid.ciphertext).toLowerCase() === bid.ciphertextHash.toLowerCase(), 400, "CIPHERTEXT_MISMATCH", "Ciphertext digest does not match.");
  const encrypted = parseCiphertext(bid.ciphertext);
  assert(BigInt(encrypted.round) === auction.rules.drandRound && encrypted.evaluatorKeyHash === auction.rules.evaluatorKeyHash, 400, "ENCRYPTION_MISMATCH", "Ciphertext parameters differ from the fixed rules.");
  const { publicClient, walletClient, address, chain } = relayClient();
  const envelope = { auctionId: BigInt(id), rulesHash: auction.rulesHash, bidder: bid.bidder as Address, commitment: bid.commitment as Hex, ciphertextHash: bid.ciphertextHash as Hex };
  assert(await verifyTypedData({ ...bidTypedData(chain.id, address, envelope), address: envelope.bidder, signature: bid.signature as Hex }), 401, "INVALID_SIGNATURE", "Bid signature is invalid.");
  // Durable ciphertext write happens before any broadcast.
  await transaction(async client => {
    await client.query("INSERT INTO bid_blobs(ciphertext_hash,ciphertext) VALUES($1,$2) ON CONFLICT DO NOTHING", [bid.ciphertextHash.toLowerCase(), bid.ciphertext]);
    const existing = (await client.query("SELECT * FROM bid_submissions WHERE auction_id=$1 AND bidder=$2 FOR UPDATE", [id, bid.bidder.toLowerCase()])).rows[0];
    assert(!existing || (existing.commitment === bid.commitment.toLowerCase() && existing.ciphertext_hash === bid.ciphertextHash.toLowerCase()), 409, "DUPLICATE_BID", "This identity already submitted a different bid envelope.");
    await client.query("INSERT INTO bid_submissions(auction_id,bidder,commitment,ciphertext_hash,signature) VALUES($1,$2,$3,$4,$5) ON CONFLICT DO NOTHING", [id, bid.bidder.toLowerCase(), bid.commitment.toLowerCase(), bid.ciphertextHash.toLowerCase(), bid.signature]);
  });
  const relayLock=await db().connect();
  try {
    assert((await relayLock.query("SELECT pg_try_advisory_lock(914023) AS acquired")).rows[0].acquired,409,"RELAY_BUSY","The relay is processing another transaction. Retry shortly.");
    for(const pending of (await relayLock.query("SELECT id FROM creation_requests WHERE auction_id IS NULL AND NOT failed")).rows) await recoverCreation(pending.id);
    await recoverPendingBids();
    const row = (await relayLock.query("SELECT * FROM bid_submissions WHERE auction_id=$1 AND bidder=$2", [id, bid.bidder.toLowerCase()])).rows[0];
    if (!row.transaction_hash) {
      const args=[BigInt(id),envelope.bidder,envelope.commitment,envelope.ciphertextHash,bid.signature as Hex] as const;
      await publicClient.simulateContract({account:walletClient.account,address,abi:auctionAbi,functionName:"registerBid",args});
      const request=await walletClient.prepareTransactionRequest({account:walletClient.account,to:address,data:encodeFunctionData({abi:auctionAbi,functionName:"registerBid",args})});
      const raw=await walletClient.signTransaction(request); const hash=keccak256(raw);
      await relayLock.query("UPDATE bid_submissions SET transaction_hash=$3,raw_transaction=$4 WHERE auction_id=$1 AND bidder=$2",[id,bid.bidder.toLowerCase(),hash,raw]);
      await publicClient.sendRawTransaction({serializedTransaction:raw});
    }
  } finally {await relayLock.query("SELECT pg_advisory_unlock(914023)");relayLock.release();}
  return getBidReceipt(id, bid.commitment);
}
export async function getBidReceipt(id: string, commitment: string): Promise<BidReceipt> {
  assert(/^0x[0-9a-fA-F]{64}$/.test(commitment), 400, "INVALID_COMMITMENT", "Invalid commitment.");
  const row = (await db().query("SELECT * FROM bid_submissions WHERE auction_id=$1 AND commitment=$2", [id, commitment.toLowerCase()])).rows[0];
  assert(row, 404, "NOT_FOUND", "Bid receipt not found.");
  const { bids, block } = await readSnapshot(id); const index = bids.findIndex(b => b.commitment.toLowerCase() === commitment.toLowerCase() && b.bidder.toLowerCase() === row.bidder && b.ciphertextHash.toLowerCase() === row.ciphertext_hash);
  const { address, chain,publicClient } = chainClients();
  let status:BidReceipt["status"]=index>=0?"accepted":"pending";
  if(index<0 && row.transaction_hash) {
    try { const receipt=await publicClient.getTransactionReceipt({hash:row.transaction_hash}); if(receipt.blockNumber<=block.number && receipt.status==="reverted") status="rejected"; }
    catch(error) { if(!(error instanceof Error && error.name==="TransactionReceiptNotFoundError")) throw error; }
  }
  return { auctionId: id, bidder: row.bidder, commitment: row.commitment, ciphertextHash: row.ciphertext_hash, status, transactionHash: row.transaction_hash, insertionIndex: index >= 0 ? index : null, chainId: chain.id, registry: address, blockHash: index >= 0 ? block.hash : null, blockNumber: index >= 0 ? block.number.toString() : null };
}
export async function resupplyCiphertext(id:string,input:unknown) {
  const {ciphertext}=z.object({ciphertext:z.string().min(1).max(32768)}).strict().parse(input);
  const hash=ciphertextDigest(ciphertext); const {bids}=await readSnapshot(id);
  assert(bids.some(bid=>bid.ciphertextHash===hash),400,"UNREGISTERED_CIPHERTEXT","Ciphertext must match a confirmed registry digest.");
  await db().query("INSERT INTO bid_blobs(ciphertext_hash,ciphertext) VALUES($1,$2) ON CONFLICT DO NOTHING",[hash.toLowerCase(),ciphertext]);
  return {ciphertextHash:hash,status:"stored"};
}
/** Call while holding the shared relay lock, before allocating a new transaction nonce. */
export async function recoverPendingBids() {
  const {publicClient}=chainClients();
  const rows=(await db().query("SELECT auction_id,bidder,transaction_hash,raw_transaction FROM bid_submissions WHERE raw_transaction IS NOT NULL AND status IN ('pending','broadcast-mined')")).rows;
  for(const row of rows) {
    try { const receipt=await publicClient.getTransactionReceipt({hash:row.transaction_hash});
      await db().query("UPDATE bid_submissions SET status=$3 WHERE auction_id=$1 AND bidder=$2",[row.auction_id,row.bidder,receipt.status==="success"?"broadcast-mined":"rejected"]);continue;
    } catch(error) { if(!(error instanceof Error && error.name==="TransactionReceiptNotFoundError")) throw error; }
    try {await publicClient.sendRawTransaction({serializedTransaction:row.raw_transaction});}
    catch {await publicClient.getTransaction({hash:row.transaction_hash});}
  }
}
