/** Local identities are browser-held secrets. Backups are plaintext and must never be uploaded. */
import { getAddress, isAddress, type Address, type Hex } from "viem";
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";
import { bidTypedData, type BidEnvelope } from "./protocol";
export type LocalIdentity = { version: 1; scope: string; privateKey: Hex; address: Address; createdAt: string };
const PREFIX = "sealed-auction:identity:v1:";
export function identityScope(chainId: number, contract: Address, auctionId: string | bigint): string {
  if (!Number.isSafeInteger(chainId) || chainId < 1 || !isAddress(contract) || !/^[1-9][0-9]*$/.test(String(auctionId))) throw new Error("Invalid identity scope");
  return `${chainId}:${contract.toLowerCase()}:${auctionId}`;
}
export function createIdentity(scope: string): LocalIdentity {
  if (!scope || scope.length > 256) throw new Error("Invalid identity scope");
  const privateKey = generatePrivateKey();
  return { version: 1, scope, privateKey, address: privateKeyToAccount(privateKey).address, createdAt: new Date().toISOString() };
}
export function importIdentity(backup: string, expectedScope: string): LocalIdentity {
  if (backup.length > 4096) throw new Error("Invalid identity backup");
  const value = JSON.parse(backup) as LocalIdentity;
  if (value.version !== 1 || value.scope !== expectedScope || !/^0x[0-9a-fA-F]{64}$/.test(value.privateKey) || !isAddress(value.address) || !Number.isFinite(Date.parse(value.createdAt))) throw new Error("Backup is invalid or belongs to another auction");
  const account = privateKeyToAccount(value.privateKey);
  if (account.address !== getAddress(value.address)) throw new Error("Backup identity mismatch");
  return { version: 1, scope: value.scope, privateKey: value.privateKey, address: account.address, createdAt: value.createdAt };
}
export function exportIdentity(identity: LocalIdentity): string { return JSON.stringify(importIdentity(JSON.stringify(identity), identity.scope), null, 2); }
export function accountForIdentity(identity: LocalIdentity) { return privateKeyToAccount(importIdentity(JSON.stringify(identity), identity.scope).privateKey); }
export async function signBidEnvelope(identity: LocalIdentity, chainId: number, registry: Address, envelope: BidEnvelope): Promise<Hex> {
  if (identity.scope !== identityScope(chainId, registry, envelope.auctionId) || getAddress(envelope.bidder) !== getAddress(identity.address)) throw new Error("Bid is outside this identity's scope");
  return accountForIdentity(identity).signTypedData(bidTypedData(chainId, registry, envelope));
}
export function saveIdentity(identity: LocalIdentity): void {
  if (typeof window === "undefined") throw new Error("Identity storage is browser-only");
  window.localStorage.setItem(PREFIX + identity.scope, exportIdentity(identity));
}
export function loadIdentity(scope: string): LocalIdentity | null {
  if (typeof window === "undefined") throw new Error("Identity storage is browser-only");
  const value = window.localStorage.getItem(PREFIX + scope);
  return value ? importIdentity(value, scope) : null;
}
export function removeIdentity(scope: string): void {
  if (typeof window === "undefined") throw new Error("Identity storage is browser-only");
  window.localStorage.removeItem(PREFIX + scope);
}
