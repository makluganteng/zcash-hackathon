import { createPublicClient, createWalletClient, defineChain, http, type Address, type Hex } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { auctionAbi as registryAbi } from "../lib/contract";
import type { AuctionRules, RegisteredBid } from "../lib/protocol";
import { configuration, secret } from "./config";
import { assert } from "./errors";
export type ChainAuction = { rules: AuctionRules; rulesHash: Hex; count: number; status: number; winnerIndex: number; winnerIdentity: Address; price: bigint; finalizedAt: bigint };
export function chainClients() {
  const config = configuration();
  assert(config.chainId === 84532 || (config.chainId === 31337 && process.env.NODE_ENV !== "production"), 503, "CHAIN_NOT_ALLOWED", "Only Base Sepolia or explicit local development is supported.");
  assert(config.registry, 503, "SETUP_REQUIRED", "Registry is not configured.");
  const chain = defineChain({ id: config.chainId, name: config.chainId === 31337 ? "Local EVM" : "Base Sepolia", nativeCurrency: { name: "Ether", symbol: "ETH", decimals: 18 }, rpcUrls: { default: { http: [secret("BASE_RPC_URL")] } } });
  const publicClient = createPublicClient({ chain, transport: http(secret("BASE_RPC_URL"), { timeout: 15000 }) });
  return { publicClient, address: config.registry, chain };
}
export function relayClient() {
  const clients = chainClients();
  const account = privateKeyToAccount(secret("RELAY_PRIVATE_KEY") as Hex);
  return { ...clients, account, walletClient: createWalletClient({ account, chain: clients.chain, transport: http(secret("BASE_RPC_URL")) }) };
}
export async function readSnapshot(id: string) {
  const { publicClient, address, chain } = chainClients();
  assert(await publicClient.getChainId() === chain.id, 503, "CHAIN_MISMATCH", "RPC network differs from the configured network.");
  const block = await publicClient.getBlock({ blockTag: "finalized" });
  assert(block.number !== null && block.hash, 503, "FINALITY_UNAVAILABLE", "A finalized block is required.");
  const code = await publicClient.getCode({ address, blockNumber: block.number });
  assert(code && code !== "0x", 409, "PENDING_FINALITY", "Registry deployment is not yet finalized.");
  const verifier = await publicClient.readContract({address,abi:registryAbi,functionName:"verifier",blockNumber:block.number});
  const expected = process.env.EXPECTED_VERIFIER_ADDRESS;
  assert(!expected || verifier.toLowerCase() === expected.toLowerCase(),503,"VERIFIER_MISMATCH","The registry verifier differs from the configured verifier.");
  const verifierCode = await publicClient.getCode({address:verifier,blockNumber:block.number});
  assert(verifierCode && verifierCode !== "0x",503,"VERIFIER_MISSING","Registry verifier code is missing.");
  const nextId = await publicClient.readContract({address,abi:registryAbi,functionName:"nextAuctionId",blockNumber:block.number});
  assert(BigInt(id)<nextId,409,"PENDING_FINALITY","Auction creation is waiting for finalized chain inclusion.");
  const auction = await publicClient.readContract({ address, abi: registryAbi, functionName: "getAuction", args: [BigInt(id)], blockNumber: block.number }) as ChainAuction;
  const bids = await publicClient.readContract({ address, abi: registryAbi, functionName: "getBids", args: [BigInt(id)], blockNumber: block.number }) as readonly RegisteredBid[];
  assert(auction.rulesHash !== `0x${"00".repeat(32)}`, 404, "NOT_FOUND", "Auction is not present in the finalized registry.");
  return { auction, bids: [...bids], block };
}
