import test, { type TestContext } from "node:test";
import assert from "node:assert/strict";
import type { Pool } from "pg";
import { keccak256, toHex } from "viem";
import { publicConfiguration } from "../../src/server/config";
import { scanPayments } from "../../src/server/payments";
import { workerTick } from "../../src/server/worker";

const destination = "ztestsapling1-readiness-test-only";
const globals = globalThis as unknown as { auctionPool?: Pool };
const envKeys = ["ZCASH_SCANNER_BACKEND", "DATABASE_URL", "SELLER_ZCASH_ADDRESS", "ZALLET_RPC_URL", "ZCASH_NODE_RPC_URL", "ZALLET_ACCOUNT_UUID", "BASE_RPC_URL", "BASE_CHAIN_ID", "REGISTRY_ADDRESS", "RELAY_PRIVATE_KEY", "INVOICE_PRIVATE_KEY", "OPERATOR_TOKEN", "EVALUATOR_PUBLIC_JWK"];
function setup(t: TestContext) {
  const saved = Object.fromEntries(envKeys.map(key => [key, process.env[key]]));
  const pool = globals.auctionPool;
  Object.assign(process.env, { DATABASE_URL: "postgresql://unused", SELLER_ZCASH_ADDRESS: destination });
  for (const key of ["ZCASH_SCANNER_BACKEND", "ZALLET_RPC_URL", "ZCASH_NODE_RPC_URL", "ZALLET_ACCOUNT_UUID"]) delete process.env[key];
  t.after(() => {
    globals.auctionPool = pool;
    for (const key of envKeys) { if (saved[key] === undefined) delete process.env[key]; else process.env[key] = saved[key]; }
  });
}
const healthy = () => ({ status: "ok", checked_at: new Date(), payment_ready: true, payment_destination_hash: keccak256(toHex(destination)) });
function database(rows: unknown[], fail = false) {
  globals.auctionPool = { query: async () => { if (fail) throw new Error("database unavailable"); return { rows }; } } as unknown as Pool;
}

test("public readiness uses a fresh worker heartbeat without wallet RPC credentials", async t => {
  setup(t); database([healthy()]);
  const config = await publicConfiguration();
  assert.equal(config.paymentReady, true);
  assert.equal(config.ready, false); // Auction setup and receiver health remain separate.
  assert.doesNotMatch(JSON.stringify(config), /unused|readiness-test-only/);
});
test("missing, stale, future, failed and mismatched receiver heartbeats fail closed", async t => {
  setup(t);
  for (const rows of [[], [{ ...healthy(), checked_at: new Date(Date.now() - 91_000) }],
    [{ ...healthy(), checked_at: new Date(Date.now() + 60_000) }], [{ ...healthy(), status: "error" }],
    [{ ...healthy(), payment_ready: false }], [{ ...healthy(), payment_destination_hash: "wrong" }]]) {
    database(rows); assert.equal((await publicConfiguration()).paymentReady, false);
  }
  database([], true); assert.equal((await publicConfiguration()).paymentReady, false);
});
test("scanner validates node network and wallet account even with no invoices", async t => {
  setup(t); database([]);
  Object.assign(process.env, { ZALLET_RPC_URL: "https://wallet.invalid", ZCASH_NODE_RPC_URL: "https://node.invalid", ZALLET_ACCOUNT_UUID: "test-account" });
  const requests: { method: string; params: unknown[] }[] = [];
  t.mock.method(globalThis, "fetch", async (_url: unknown, init: RequestInit) => {
    const request = JSON.parse(String(init.body)); requests.push(request);
    return Response.json({ result: request.method === "getblockchaininfo" ? { chain: "test" } : [] });
  });
  assert.equal(await scanPayments(), true);
  assert.deepEqual(requests.map(request => request.method), ["getblockchaininfo", "z_listtransactions"]);
  assert.equal(requests[1].params[0], "test-account");
});
test("wallet RPC error and wrong node network cannot establish readiness", async t => {
  setup(t); database([]);
  Object.assign(process.env, { ZALLET_RPC_URL: "https://wallet.invalid", ZCASH_NODE_RPC_URL: "https://node.invalid", ZALLET_ACCOUNT_UUID: "test-account" });
  let wrongNetwork = false;
  t.mock.method(globalThis, "fetch", async (_url: unknown, init: RequestInit) => {
    const request = JSON.parse(String(init.body));
    return Response.json(request.method === "getblockchaininfo" ? { result: { chain: wrongNetwork ? "main" : "test" } } : { error: { message: "unknown account" } });
  });
  await assert.rejects(scanPayments());
  wrongNetwork = true; await assert.rejects(scanPayments());
});
test("an unconfigured scanner reports false", async t => {
  setup(t); assert.equal(await scanPayments(), false);
});
test("worker persists verified readiness, immediately revokes it on scanner error, and releases its lease", async t => {
  setup(t);
  Object.assign(process.env, {
    BASE_RPC_URL: "https://base.invalid", BASE_CHAIN_ID: "84532", REGISTRY_ADDRESS: `0x${"11".repeat(20)}`,
    RELAY_PRIVATE_KEY: `0x${"01".repeat(32)}`, INVOICE_PRIVATE_KEY: `0x${"02".repeat(32)}`, OPERATOR_TOKEN: "test-only",
    EVALUATOR_PUBLIC_JWK: JSON.stringify({ kty: "RSA", n: Buffer.alloc(384, 1).toString("base64url"), e: "AQAB" }),
    ZALLET_RPC_URL: "https://wallet.invalid", ZCASH_NODE_RPC_URL: "https://node.invalid", ZALLET_ACCOUNT_UUID: "test-account",
  });
  let health: ReturnType<typeof healthy> | undefined;
  let unlocks = 0; let releases = 0; let fail = false;
  const query = async (sql: string, values?: unknown[]) => {
    if (sql.includes("pg_try_advisory_lock")) return { rows: [{ acquired: true }] };
    if (sql.includes("pg_advisory_unlock(914024)")) unlocks++;
    if (sql.startsWith("INSERT INTO worker_health")) {
      health = { ...healthy(), status: values ? "ok" : "error", payment_ready: values?.[0] === true };
    }
    if (sql.startsWith("SELECT checked_at")) return { rows: health ? [health] : [] };
    return { rows: [] };
  };
  globals.auctionPool = { query, connect: async () => ({ query, release: () => releases++ }) } as unknown as Pool;
  t.mock.method(globalThis, "fetch", async (_url: unknown, init: RequestInit) => {
    const request = JSON.parse(String(init.body));
    if (fail) return Response.json({ error: { message: "scanner unavailable" } });
    return Response.json({ result: request.method === "getblockchaininfo" ? { chain: "test" } : [] });
  });
  await workerTick(); assert.equal((await publicConfiguration()).paymentReady, true);
  fail = true; await assert.rejects(workerTick());
  assert.equal((await publicConfiguration()).paymentReady, false);
  assert.equal(unlocks, 2); assert.equal(releases, 2);
});
