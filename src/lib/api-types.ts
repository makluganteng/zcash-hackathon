import type { Address, Hex } from "viem";

export type AuctionPhase = "open" | "opening" | "proving" | "blocked" | "verified-sale" | "verified-no-sale" | "expired" | "pending";
export type PublicConfig = {
  ready: boolean; missing: string[]; chainId: number; registry: Address | null;
  evaluatorPublicKey: JsonWebKey | null; invoiceSigner: Address | null;
  zcashNetwork: "testnet"; finality: "finalized"; paymentConfirmations: number;
  paymentReady: boolean;
};
export type PublicAuction = {
  id: string; title: string; description: string; category: string;
  phase: AuctionPhase; chainId: number; registry: Address; rulesHash: Hex;
  reserve: string; maxAmount: string; closesAt: string; finalizationWindow: number; paymentWindow: number;
  seller: Address; destinationHash: Hex; evaluatorKeyHash: Hex; drandChainHash: Hex; drandRound: string;
  bidCount: number; capacity: 16; snapshotBlock: string; snapshotHash: Hex;
  result: null | { sale: boolean; winnerIndex: number; winnerIdentity: Address; price: string; finalizedAt: string; paymentDeadline: string };
  proofAvailable: boolean;
};
export type BidSubmission = { bidder: Address; commitment: Hex; ciphertextHash: Hex; signature: Hex; ciphertext: string };
export type BidReceipt = {
  auctionId: string; bidder: Address; commitment: Hex; ciphertextHash: Hex;
  status: "pending" | "accepted" | "rejected"; transactionHash: Hex | null;
  insertionIndex: number | null; chainId: number; registry: Address;
  blockHash: Hex | null; blockNumber: string | null;
};
export type ClaimChallenge = { challengeId: string; message: string; expiresAt: string };
export type PaymentStatus = "awaiting-payment" | "detected" | "confirming" | "receiver-confirmed" | "expired" | "needs-review";
export type InvoicePayload = {
  version: 1; id: string; auctionId: string; chainId: number; registry: Address;
  rulesHash: Hex; resultBlockHash: Hex; resultBlockNumber: string; winnerIdentity: Address;
  destination: string; destinationHash: Hex; network: "testnet"; amount: string;
  reference: string; expiresAt: string;
};
export type PrivateInvoice = { payload: InvoicePayload; signature: Hex; signer: Address; paymentUri: string; status: PaymentStatus; confirmations: number };
export type ApiError = { error: { code: string; message: string } };
export function invoiceMessage(p: InvoicePayload): string {
  return "Sealed Auctions invoice v1\n" + JSON.stringify([p.version,p.id,p.auctionId,p.chainId,p.registry.toLowerCase(),p.rulesHash,p.resultBlockHash,p.resultBlockNumber,p.winnerIdentity.toLowerCase(),p.destination,p.destinationHash,p.network,p.amount,p.reference,p.expiresAt]);
}
