/** An explicitly non-payable local fixture for exercising the real registry and encrypted bids. */
import { keccak256, parseEventLogs, toHex } from "viem";
import { auctionAbi } from "../src/lib/contract";
import { DRAND, evaluatorKeyHash, roundAfterClose } from "../src/lib/encryption";
import { configuration } from "../src/server/config";
import { relayClient } from "../src/server/chain";
import { db } from "../src/server/db";

if (process.env.BASE_CHAIN_ID !== "31337") throw new Error("Local fixtures require chain 31337.");
const { walletClient, publicClient, account, address } = relayClient();
if (await publicClient.getChainId() !== 31337) throw new Error("Refusing to seed a public chain.");
const seconds = Number(process.argv[2] ?? 600);
if (!Number.isSafeInteger(seconds) || seconds < 120 || seconds > 86400) throw new Error("Use a duration between 120 and 86400 seconds.");
const metadata = {
  title: "Cipher Study No. 01",
  description: "A local integration auction for an original generative print. This fixture exercises real encrypted bids and winner proofs on your local EVM. No item is being sold, and no Zcash invoice can be paid: the receiver is intentionally unconfigured.",
  category: "Local test",
};
const block = await publicClient.getBlock();
const closesAt = Math.max(Number(block.timestamp), Math.floor(Date.now() / 1000)) + seconds;
const key = configuration().evaluatorPublicKey;
if (!key) throw new Error("Generate evaluator keys and configure the public JWK first.");
const hash = await walletClient.writeContract({ address, abi: auctionAbi, functionName: "createAuction", args: [{
  seller: account.address, itemHash: keccak256(toHex(JSON.stringify(metadata))),
  destinationHash: keccak256(toHex("LOCAL_NONPAYABLE_FIXTURE_NO_ZCASH_DESTINATION")),
  reserve: 100000000n, maxAmount: 2100000000000000n, closesAt: BigInt(closesAt),
  finalizationWindow: 86400, paymentWindow: 3600, evaluatorKeyHash: evaluatorKeyHash(key),
  drandChainHash: `0x${DRAND.chainHash}`, drandRound: BigInt(roundAfterClose(closesAt, 30)),
}] });
const receipt = await publicClient.waitForTransactionReceipt({ hash });
if (receipt.status !== "success") throw new Error("Local fixture creation reverted.");
const event = parseEventLogs({ abi: auctionAbi, eventName: "AuctionCreated", logs: receipt.logs })[0];
if (!event) throw new Error("Missing creation receipt.");
const id = event.args.auctionId.toString();
await db().query("INSERT INTO auctions(id,title,description,category,item_hash,creation_tx) VALUES($1,$2,$3,$4,$5,$6)", [id, metadata.title, metadata.description, metadata.category, keccak256(toHex(JSON.stringify(metadata))), hash]);
console.log(JSON.stringify({ id, chain: "local-only", payment: "disabled", closesAt: new Date(closesAt * 1000).toISOString(), transaction: hash }));
await db().end();
