import { concatHex, encodeAbiParameters, keccak256, sha256, toHex, type Address, type Hex } from "viem";

export const CAPACITY = 16;
export const PUBLIC_INPUT_COUNT = 57;
export const PROTOCOL_VERSION = "private-auction-v1";
export const ZERO_HASH = `0x${"00".repeat(32)}` as Hex;
export type AuctionRules = {
  seller: Address; itemHash: Hex; destinationHash: Hex; reserve: bigint; maxAmount: bigint;
  closesAt: bigint; finalizationWindow: number; paymentWindow: number;
  evaluatorKeyHash: Hex; drandChainHash: Hex; drandRound: bigint;
};
export type BidEnvelope = { auctionId: bigint; rulesHash: Hex; bidder: Address; commitment: Hex; ciphertextHash: Hex };
export type RegisteredBid = { bidder: Address; commitment: Hex; ciphertextHash: Hex };
export type AuctionResult = { sale: boolean; winnerIndex: number; winnerIdentity: Address; price: bigint };
export type BidOpening = { amount: bigint; nonce: Hex };
export const rulesComponents = [
  {name:"seller",type:"address"},{name:"itemHash",type:"bytes32"},{name:"destinationHash",type:"bytes32"},
  {name:"reserve",type:"uint64"},{name:"maxAmount",type:"uint64"},{name:"closesAt",type:"uint64"},
  {name:"finalizationWindow",type:"uint32"},{name:"paymentWindow",type:"uint32"},
  {name:"evaluatorKeyHash",type:"bytes32"},{name:"drandChainHash",type:"bytes32"},{name:"drandRound",type:"uint64"},
] as const;
export function hashRules(chainId: bigint, registry: Address, auctionId: bigint, rules: AuctionRules): Hex {
  return keccak256(encodeAbiParameters([{type:"uint256"},{type:"address"},{type:"uint256"},{type:"tuple",components:rulesComponents}], [chainId,registry,auctionId,rules]));
}
export function bidCommitment(rulesHash: Hex, bidder: Address, amount: bigint, nonce: Hex): Hex {
  if (amount <= 0n || amount > 0xffffffffffffffffn || nonce.length !== 66) throw new Error("Invalid opening");
  return sha256(concatHex([rulesHash,bidder,toHex(amount,{size:8}),nonce]));
}
export const bidTypes = { Bid: [
  {name:"auctionId",type:"uint256"},{name:"rulesHash",type:"bytes32"},{name:"bidder",type:"address"},
  {name:"commitment",type:"bytes32"},{name:"ciphertextHash",type:"bytes32"},
]} as const;
export function bidTypedData(chainId: number, registry: Address, envelope: BidEnvelope) {
  return {domain:{name:"PrivateAuction",version:"1",chainId,verifyingContract:registry},types:bidTypes,primaryType:"Bid" as const,message:envelope};
}
export function splitDigest(digest: Hex): [bigint,bigint] {
  return [BigInt(`0x${digest.slice(2,34)}`), BigInt(`0x${digest.slice(34)}`)];
}
export function buildPublicInputs(rulesHash: Hex, rules: Pick<AuctionRules,"reserve"|"maxAmount">, bids: RegisteredBid[], result: AuctionResult): Hex[] {
  if (bids.length > CAPACITY) throw new Error("Registry capacity exceeded");
  const padded=Array.from({length:CAPACITY},(_,i)=>bids[i]);
  const fields=[...splitDigest(rulesHash),rules.reserve,rules.maxAmount,BigInt(bids.length),
    ...padded.map(b=>b?BigInt(b.bidder):0n),...padded.map(b=>b?splitDigest(b.commitment)[0]:0n),
    ...padded.map(b=>b?splitDigest(b.commitment)[1]:0n),result.sale?1n:0n,BigInt(result.winnerIndex),BigInt(result.winnerIdentity),result.price];
  return fields.map(f=>toHex(f,{size:32}));
}
export function selectWinner(rules: Pick<AuctionRules,"reserve"|"maxAmount">, bids: RegisteredBid[], openings: BidOpening[]): AuctionResult {
  if(bids.length !== openings.length || bids.length > CAPACITY) throw new Error("Incomplete registry");
  let result: AuctionResult={sale:false,winnerIndex:0,winnerIdentity:"0x0000000000000000000000000000000000000000",price:0n};
  openings.forEach((o,i)=>{ if(o.amount<=0n || o.amount>rules.maxAmount) throw new Error("Amount outside bounds");
    if(o.amount>=rules.reserve && (!result.sale || o.amount>result.price)) result={sale:true,winnerIndex:i,winnerIdentity:bids[i].bidder,price:o.amount}; });
  return result;
}
