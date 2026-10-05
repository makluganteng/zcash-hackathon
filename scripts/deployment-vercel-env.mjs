#!/usr/bin/env node
// Upload only reviewed web variables, never the entire worker environment.
import { readFileSync } from "node:fs";
import { parseEnv } from "node:util";
import { spawnSync } from "node:child_process";

const args = process.argv.slice(2);
const source = args.find(arg => !arg.startsWith("--"));
if (!source || args.some(arg => arg.startsWith("--") && arg !== "--apply")) {
  console.error("Usage: node scripts/deployment-vercel-env.mjs PATH [--apply]");
  process.exit(1);
}
const values = parseEnv(readFileSync(source, "utf8"));
const allowed = [
  "APP_ORIGIN", "DATABASE_URL", "DATABASE_POOL_MAX", "DATABASE_SSL_CA", "BASE_CHAIN_ID", "BASE_RPC_URL",
  "REGISTRY_ADDRESS", "EXPECTED_VERIFIER_ADDRESS", "RELAY_PRIVATE_KEY",
  "INVOICE_PRIVATE_KEY", "OPERATOR_TOKEN", "EVALUATOR_PUBLIC_JWK",
  "DRAND_MARGIN_SECONDS", "SELLER_ZCASH_ADDRESS", "ZCASH_CONFIRMATIONS",
];
if (values.APP_ORIGIN !== "https://sealed-auctions.vercel.app") {
  throw new Error("APP_ORIGIN must be the intended production origin.");
}
if (values.BASE_CHAIN_ID !== "84532") throw new Error("Only Base Sepolia is allowed.");
for (const key of ["DATABASE_URL", "BASE_RPC_URL"]) {
  if (!values[key]) throw new Error(`${key} is required.`);
  const url = new URL(values[key]);
  if (["localhost", "127.0.0.1", "[::1]"].includes(url.hostname)) {
    throw new Error(`${key} cannot target a local service.`);
  }
  if (key === "DATABASE_URL" && url.port === "6543" &&
      (url.hostname.endsWith(".pooler.supabase.com") || url.hostname.endsWith(".supabase.co"))) {
    throw new Error("Supabase must use Session pooler (5432) or direct access; session advisory locks require a persistent session.");
  }
}
if (values.EVALUATOR_PUBLIC_JWK) {
  const key = JSON.parse(values.EVALUATOR_PUBLIC_JWK);
  if (["d", "p", "q", "dp", "dq", "qi", "oth"].some(field => field in key)) {
    throw new Error("Evaluator private material cannot be uploaded to the web host.");
  }
}
const entries = allowed.filter(key => values[key]);
console.log(`Project: sealed-auctions; environment: production; keys: ${entries.join(", ")}`);
if (!args.includes("--apply")) {
  console.log("Dry run only. Pass --apply to upload these values through stdin.");
  process.exit(0);
}
// VERCEL_CLI_PATH optionally points to a reviewed installed CLI JavaScript file.
const command = process.env.VERCEL_CLI_PATH ? process.execPath : "vercel";
const prefix = process.env.VERCEL_CLI_PATH ? [process.env.VERCEL_CLI_PATH] : [];
for (const key of entries) {
  const result = spawnSync(command, [...prefix, "env", "add", key, "production",
    "--project", "sealed-auctions", "--scope", "vincents-projects-2bbb9bb8",
    "--sensitive", "--force", "--yes", "--non-interactive"],
  { input: values[key], encoding: "utf8", stdio: ["pipe", "pipe", "pipe"] });
  // Never echo CLI output: provider errors can include a supplied value.
  if (result.status !== 0) throw new Error(`Upload failed for ${key}; inspect Vercel configuration without printing secrets.`);
  console.log(`Configured ${key}`);
}
console.log("Environment saved. Redeploy production for changes to take effect.");
