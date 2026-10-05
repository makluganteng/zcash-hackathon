import { keccak256, toHex, verifyMessage } from "viem";
import { invoiceMessage, type InvoicePayload, type PrivateInvoice, type PublicAuction, type PublicConfig } from "./api-types";
export class ApiRequestError extends Error {
  constructor(message: string, readonly status: number, readonly code: string) { super(message); }
}
export async function validatePrivateInvoice(invoice: PrivateInvoice, auction: PublicAuction, config: PublicConfig, identity: string, expectedPayload?: InvoicePayload): Promise<void> {
  const p = invoice.payload;
  if (expectedPayload && invoiceMessage(p) !== invoiceMessage(expectedPayload)) throw new Error("Invoice contents changed after issuance. Do not send payment.");
  if (auction.phase !== "verified-sale" || !auction.result?.sale || p.version !== 1
    || p.chainId !== auction.chainId || p.registry.toLowerCase() !== auction.registry.toLowerCase()
    || p.auctionId !== auction.id || p.rulesHash !== auction.rulesHash
    || p.winnerIdentity.toLowerCase() !== identity.toLowerCase()
    || p.winnerIdentity.toLowerCase() !== auction.result.winnerIdentity.toLowerCase()
    || p.amount !== auction.result.price || p.destinationHash !== auction.destinationHash
    || keccak256(toHex(p.destination)) !== auction.destinationHash || p.network !== "testnet"
    || p.expiresAt !== auction.result.paymentDeadline || !Number.isFinite(Date.parse(p.expiresAt))
    || !/^sealed:[0-9a-f]{48}$/.test(p.reference) || !/^0x[0-9a-fA-F]{64}$/.test(p.resultBlockHash)
    || !/^[0-9]+$/.test(p.resultBlockNumber) || !config.invoiceSigner
    || invoice.signer.toLowerCase() !== config.invoiceSigner.toLowerCase()
    || !await verifyMessage({address:config.invoiceSigner, message:invoiceMessage(p), signature:invoice.signature}))
    throw new Error("Invoice verification failed. Do not send payment.");
  if (!p.destination.startsWith("utest1") && !p.destination.startsWith("ztestsapling1")) throw new Error("Invoice destination is not a shielded testnet address.");
}
export function zec(value: string): string {
  const n = BigInt(value), whole = n / 100000000n, fraction = (n % 100000000n).toString().padStart(8,"0").replace(/0+$/,"");
  return `${whole}${fraction ? `.${fraction}` : ""}`;
}
export function zatoshis(value: string): string {
  if (!/^(0|[1-9][0-9]*)(\.[0-9]{1,8})?$/.test(value)) throw new Error("Enter a positive ZEC amount with up to 8 decimal places.");
  const [whole,fraction=""] = value.split("."); const n = BigInt(whole)*100000000n + BigInt(fraction.padEnd(8,"0"));
  if (n<=0n || n>2100000000000000n) throw new Error("Amount must be greater than zero and within the ZEC supply limit.");
  return n.toString();
}
export function short(value: string, size=6): string { return value.length > size*2+3 ? `${value.slice(0,size)}…${value.slice(-size)}` : value; }
export function dateTime(value: string): string { return new Date(value).toLocaleString(undefined,{month:"short",day:"numeric",hour:"numeric",minute:"2-digit"}); }
export async function api<T>(url: string, init?: RequestInit): Promise<T> {
  const response = await fetch(url,{...init,cache:"no-store",headers:{...(init?.body?{"Content-Type":"application/json"}:{}),...init?.headers}});
  const data = await response.json();
  if(!response.ok) throw new ApiRequestError(data.error?.message || "The request could not be completed. Please try again.",response.status,data.error?.code || "REQUEST_FAILED");
  return data as T;
}
export function downloadJson(name: string, value: unknown) {
  const blob = new Blob([typeof value === "string" ? value : JSON.stringify(value,null,2)],{type:"application/json"});
  const url=URL.createObjectURL(blob); const a=document.createElement("a"); a.href=url;a.download=name;a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);
}
