import { privateKeyToAccount } from "viem/accounts";
import { isAddress, keccak256, toHex, type Address, type Hex } from "viem";
import type { PublicConfig } from "../lib/api-types";
import { ApiFault } from "./errors";

export function configuration(): PublicConfig {
  const missing = ["DATABASE_URL", "BASE_RPC_URL", "REGISTRY_ADDRESS", "RELAY_PRIVATE_KEY", "EVALUATOR_PUBLIC_JWK", "INVOICE_PRIVATE_KEY", "OPERATOR_TOKEN"].filter(k => !process.env[k]);
  const registry = process.env.REGISTRY_ADDRESS;
  if (registry && !isAddress(registry)) missing.push("valid REGISTRY_ADDRESS");
  let evaluatorPublicKey: JsonWebKey | null = null;
  try { if (process.env.EVALUATOR_PUBLIC_JWK) {
    const key = JSON.parse(process.env.EVALUATOR_PUBLIC_JWK);
    if (key.d || key.p || key.q || key.dp || key.dq || key.qi || key.oth || key.kty !== "RSA" || typeof key.n !== "string" || key.e !== "AQAB" || Buffer.from(key.n,"base64url").length !== 384) throw new Error("Invalid public RSA key");
    // Reconstruct the public key; never forward unrecognized fields from operator JSON.
    evaluatorPublicKey = {kty:"RSA",n:key.n,e:key.e,alg:"RSA-OAEP-256",ext:true,key_ops:["encrypt"]};
  } } catch { missing.push("valid public EVALUATOR_PUBLIC_JWK"); }
  let invoiceSigner: Address | null = null;
  try { if (process.env.INVOICE_PRIVATE_KEY) invoiceSigner = privateKeyToAccount(process.env.INVOICE_PRIVATE_KEY as Hex).address; } catch { missing.push("valid INVOICE_PRIVATE_KEY"); }
  return { ready: missing.length === 0, missing, chainId: Number(process.env.BASE_CHAIN_ID || 84532), registry: registry && isAddress(registry) ? registry : null, evaluatorPublicKey, invoiceSigner, zcashNetwork: "testnet", finality: "finalized", paymentConfirmations: Number(process.env.ZCASH_CONFIRMATIONS || 3), paymentReady: false };
}
// The web host never needs wallet RPC credentials. A completed worker scan is
// authoritative only for this seller destination and for a short freshness window.
export async function publicConfiguration(): Promise<PublicConfig> {
  const config = configuration();
  if (!process.env.DATABASE_URL || !process.env.SELLER_ZCASH_ADDRESS) return config;
  try {
    const { db } = await import("./db");
    const health = (await db().query("SELECT checked_at,status,payment_ready,payment_destination_hash FROM worker_health WHERE singleton=true")).rows[0];
    const age = Date.now() - new Date(health?.checked_at).getTime();
    config.paymentReady = health?.status === "ok" && health.payment_ready === true
      && age >= 0 && age <= 90_000
      && health.payment_destination_hash === keccak256(toHex(process.env.SELLER_ZCASH_ADDRESS));
  } catch { /* Missing migration, disconnected DB or invalid health fails closed. */ }
  return config;
}
export function requireConfiguration() { const config = configuration(); if (!config.ready) throw new ApiFault(503, "SETUP_REQUIRED", `Configure ${config.missing.join(", ")} to enable live auctions.`); return config; }
export function secret(name: string): string { const value = process.env[name]; if (!value) throw new ApiFault(503, "SETUP_REQUIRED", `${name} is not configured.`); return value; }
