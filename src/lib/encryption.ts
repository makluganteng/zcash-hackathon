/** Browser/worker shared cryptography. Never import evaluator private keys into a client. */
import { Buffer, timelockDecrypt, timelockEncrypt } from "tlock-js";
import { HttpCachingChain, HttpChainClient } from "drand-client";
import { isAddress, keccak256, toHex, type Address, type Hex } from "viem";

// Pinned to https://api.drand.sh/<hash>/info, checked 2026-10-05.
export const DRAND = Object.freeze({
  chainHash: "52db9ba70e0cc0f6eaf7803dd07447a1f5477735fd3f661792ba94600c84e971",
  publicKey: "83cf0f2896adee7eb8b5f01fcad3912212c437e0073e911fb90022d3e760183c8c4b450b6a0a6c3ac6a5776a2d1064510d1fec758c921cc22b0e17e63aaf4bcb5ed66304de9cf809bd274ca73bab4af5a6e9c76a4bc09e76eae8991ef5ece45a",
  genesisTime: 1692803367, period: 3, scheme: "bls-unchained-g1-rfc9380",
  url: "https://api.drand.sh/52db9ba70e0cc0f6eaf7803dd07447a1f5477735fd3f661792ba94600c84e971",
});
export const MAX_CIPHERTEXT_BYTES = 32_768;
export type EncryptedBidOpening = {
  version: 1; chainId: number; contract: Address; auctionId: string;
  rulesHash: Hex; bidder: Address; amount: string; nonce: Hex;
};
export type BidOpening = EncryptedBidOpening;
type InnerCiphertext = { version: 1; algorithm: "RSA-OAEP-3072+A256GCM"; wrappedKey: string; iv: string; data: string };
type CiphertextEnvelope = { version: 1; chainHash: string; round: number; evaluatorKeyHash: Hex; ciphertext: string };
const encoder = new TextEncoder();
const decoder = new TextDecoder("utf-8", { fatal: true });
const RSA = { name: "RSA-OAEP", hash: "SHA-256" };
const AAD = encoder.encode("private-auction:sealed-bid:inner:v1");

export function drandClient() {
  const options = { disableBeaconVerification: false, noCache: false,
    chainVerificationParams: { chainHash: DRAND.chainHash, publicKey: DRAND.publicKey } };
  const chain = new HttpCachingChain(DRAND.url, options);
  // Chain hash/public key are library-verified; pin timing and scheme as well.
  const checkedChain = { baseUrl: DRAND.url, async info() {
    const info = await chain.info();
    if (info.period !== DRAND.period || info.genesis_time !== DRAND.genesisTime || info.schemeID !== DRAND.scheme) throw new Error("Drand chain configuration changed");
    return info;
  } };
  return new HttpChainClient(checkedChain, options);
}
/** First round strictly after close + margin; seconds throughout, never milliseconds. */
export function roundAfterClose(closesAtSeconds: number, marginSeconds = 30): number {
  if (!Number.isSafeInteger(closesAtSeconds) || !Number.isSafeInteger(marginSeconds) || marginSeconds < 0 || closesAtSeconds < DRAND.genesisTime) throw new Error("Invalid drand deadline");
  return Math.floor((closesAtSeconds + marginSeconds - DRAND.genesisTime) / DRAND.period) + 2;
}
export function timeForRound(round: number): number {
  assertRound(round);
  return DRAND.genesisTime + (round - 1) * DRAND.period;
}
function assertRound(round: number) {
  if (!Number.isSafeInteger(round) || round < 1) throw new Error("Invalid drand round");
}
function base64(bytes: ArrayBuffer | Uint8Array): string { return Buffer.from(bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes)).toString("base64"); }
function unbase64(value: string): Uint8Array<ArrayBuffer> {
  if (typeof value !== "string" || !/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(value)) throw new Error("Invalid encoded ciphertext");
  return new Uint8Array(Buffer.from(value, "base64"));
}
function publicJwk(key: JsonWebKey): JsonWebKey {
  if (key.kty !== "RSA" || typeof key.n !== "string" || typeof key.e !== "string" || key.e !== "AQAB" || Buffer.from(key.n.replace(/-/g, "+").replace(/_/g, "/").padEnd(Math.ceil(key.n.length / 4) * 4, "="), "base64").length !== 384) throw new Error("Expected RSA-3072 evaluator JWK");
  return { kty: "RSA", n: key.n, e: key.e, alg: "RSA-OAEP-256", ext: true, key_ops: ["encrypt"] };
}
export function evaluatorKeyHash(key: JsonWebKey): Hex {
  const { kty, n, e } = publicJwk(key);
  return keccak256(toHex(JSON.stringify({ kty, n, e })));
}
export function ciphertextDigest(ciphertext: string): Hex { return keccak256(toHex(ciphertext)); }
export function randomNonce(): Hex { return toHex(crypto.getRandomValues(new Uint8Array(32))); }
export async function generateEvaluatorKeys(): Promise<{ publicKey: JsonWebKey; privateKey: JsonWebKey }> {
  const pair = await crypto.subtle.generateKey({ ...RSA, modulusLength: 3072, publicExponent: new Uint8Array([1, 0, 1]) }, true, ["encrypt", "decrypt"]);
  return { publicKey: await crypto.subtle.exportKey("jwk", pair.publicKey), privateKey: await crypto.subtle.exportKey("jwk", pair.privateKey) };
}
export function validateOpening(value: unknown): EncryptedBidOpening {
  if (!value || typeof value !== "object") throw new Error("Invalid bid opening");
  const o = value as EncryptedBidOpening;
  if (o.version !== 1 || !Number.isSafeInteger(o.chainId) || o.chainId < 1 || !isAddress(o.contract) || !isAddress(o.bidder)
    || typeof o.auctionId !== "string" || !/^[1-9][0-9]*$/.test(o.auctionId) || BigInt(o.auctionId) >= 2n ** 256n
    || typeof o.amount !== "string" || !/^[1-9][0-9]*$/.test(o.amount) || BigInt(o.amount) > 0xffffffffffffffffn
    || !/^0x[0-9a-fA-F]{64}$/.test(o.rulesHash) || !/^0x[0-9a-fA-F]{64}$/.test(o.nonce)) throw new Error("Invalid bid opening");
  // Reconstruct, do not forward unrecognized fields or accidental secrets.
  return { version: 1, chainId: o.chainId, contract: o.contract, auctionId: o.auctionId, rulesHash: o.rulesHash, bidder: o.bidder, amount: o.amount, nonce: o.nonce };
}
export async function encryptInner(opening: EncryptedBidOpening, evaluatorPublicKey: JsonWebKey): Promise<string> {
  const plaintext = encoder.encode(JSON.stringify(validateOpening(opening)));
  const rsa = await crypto.subtle.importKey("jwk", publicJwk(evaluatorPublicKey), RSA, false, ["encrypt"]);
  const aes = await crypto.subtle.generateKey({ name: "AES-GCM", length: 256 }, true, ["encrypt"]);
  const raw = await crypto.subtle.exportKey("raw", aes);
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const data = await crypto.subtle.encrypt({ name: "AES-GCM", iv, additionalData: AAD, tagLength: 128 }, aes, plaintext);
  const wrappedKey = await crypto.subtle.encrypt(RSA, rsa, raw);
  return JSON.stringify({ version: 1, algorithm: "RSA-OAEP-3072+A256GCM", wrappedKey: base64(wrappedKey), iv: base64(iv), data: base64(data) } satisfies InnerCiphertext);
}
export async function decryptInner(ciphertext: string, evaluatorPrivateKey: JsonWebKey): Promise<EncryptedBidOpening> {
  if (ciphertext.length > MAX_CIPHERTEXT_BYTES) throw new Error("Ciphertext too large");
  const inner = JSON.parse(ciphertext) as InnerCiphertext;
  if (inner.version !== 1 || inner.algorithm !== "RSA-OAEP-3072+A256GCM") throw new Error("Unsupported inner ciphertext");
  publicJwk(evaluatorPrivateKey);
  const rsa = await crypto.subtle.importKey("jwk", evaluatorPrivateKey, RSA, false, ["decrypt"]);
  const raw = await crypto.subtle.decrypt(RSA, rsa, unbase64(inner.wrappedKey));
  const aes = await crypto.subtle.importKey("raw", raw, "AES-GCM", false, ["decrypt"]);
  const iv = unbase64(inner.iv);
  if (iv.length !== 12) throw new Error("Invalid IV");
  const plaintext = await crypto.subtle.decrypt({ name: "AES-GCM", iv, additionalData: AAD, tagLength: 128 }, aes, unbase64(inner.data));
  return validateOpening(JSON.parse(decoder.decode(plaintext)));
}
export async function encryptBid(opening: EncryptedBidOpening, evaluatorPublicKey: JsonWebKey, round: number): Promise<string> {
  assertRound(round);
  if (timeForRound(round) * 1000 <= Date.now()) throw new Error("Unlock round must be in the future");
  const inner = await encryptInner(opening, evaluatorPublicKey);
  const ciphertext = await timelockEncrypt(round, Buffer.from(inner), drandClient());
  return JSON.stringify({ version: 1, chainHash: DRAND.chainHash, round, evaluatorKeyHash: evaluatorKeyHash(evaluatorPublicKey), ciphertext } satisfies CiphertextEnvelope);
}
export function parseCiphertext(ciphertext: string): CiphertextEnvelope {
  if (encoder.encode(ciphertext).length > MAX_CIPHERTEXT_BYTES) throw new Error("Ciphertext too large");
  const envelope = JSON.parse(ciphertext) as CiphertextEnvelope;
  if (envelope.version !== 1 || envelope.chainHash !== DRAND.chainHash || !/^0x[0-9a-fA-F]{64}$/.test(envelope.evaluatorKeyHash) || typeof envelope.ciphertext !== "string") throw new Error("Unsupported ciphertext envelope");
  assertRound(envelope.round);
  return envelope;
}
/** Outer opening is intentionally public; its output must remain evaluator-encrypted. */
export async function openTimeLock(ciphertext: string, expected?: { round?: number; evaluatorKeyHash?: Hex }): Promise<string> {
  const envelope = parseCiphertext(ciphertext);
  if ((expected?.round !== undefined && envelope.round !== expected.round) || (expected?.evaluatorKeyHash !== undefined && envelope.evaluatorKeyHash !== expected.evaluatorKeyHash)) throw new Error("Ciphertext does not match auction encryption parameters");
  if (Date.now() < timeForRound(envelope.round) * 1000) throw new Error("Time lock has not opened");
  return (await timelockDecrypt(envelope.ciphertext, drandClient())).toString("utf8");
}
export async function decryptBid(ciphertext: string, evaluatorPrivateKey: JsonWebKey, expected?: { round?: number; evaluatorKeyHash?: Hex }): Promise<EncryptedBidOpening> {
  const keyHash = evaluatorKeyHash(evaluatorPrivateKey);
  if (expected?.evaluatorKeyHash && keyHash !== expected.evaluatorKeyHash) throw new Error("Evaluator key differs from auction key");
  return decryptInner(await openTimeLock(ciphertext, { ...expected, evaluatorKeyHash: keyHash }), evaluatorPrivateKey);
}
