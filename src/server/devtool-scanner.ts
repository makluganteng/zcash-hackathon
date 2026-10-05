import { execFile } from "node:child_process";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import { z } from "zod";
import { secret } from "./config";
import { ApiFault, assert } from "./errors";
import { viewedTransactionSchema } from "./viewed-transaction";

const execute = promisify(execFile);
const exporter = fileURLToPath(new URL("../../tools/zcash-testnet-build/export-notes.py", import.meta.url));
const testnetAddress = z.string().regex(/^(utest1|zutest1|tutest1|ztestsapling1)/);
const snapshotSchema = z.object({
  network: z.literal("test"),
  accountUuid: z.uuid(),
  scannedHeight: z.number().int().safe().min(4_465_026),
  serverTargetHeight: z.number().int().safe().min(4_465_026),
  observedAt: z.number().int().safe().nonnegative(),
  // ZIP 316 R2 adds shielded-only zutest and transparent-enabled tutest UAs.
  // Exporter ownership comes from account rows with shielded receiver flags;
  // this prefix check is only a network/format guard, never address equivalence.
  receivingAddresses: z.array(testnetAddress).min(1).max(10_000),
  destinationBindings: z.array(z.object({
    destination: testnetAddress,
    receivers: z.array(z.object({address: testnetAddress, pool: z.enum(["sapling", "orchard", "ironwood"])})).min(1).max(30_000),
  })).min(1).max(10_000),
  transactions: z.array(viewedTransactionSchema).max(10_000),
});
export type DevtoolSnapshot = z.infer<typeof snapshotSchema>;

export function validateDevtoolSnapshot(raw: unknown, account: string, destination: string, now = Date.now()): DevtoolSnapshot {
  const snapshot = snapshotSchema.parse(raw);
  assert(snapshot.accountUuid === account, 503, "SCANNER_ACCOUNT", "The viewing wallet does not match the configured account.");
  assert(snapshot.scannedHeight >= snapshot.serverTargetHeight, 503, "SCANNER_BEHIND", "The viewing wallet has not scanned the server target.");
  const age = now - snapshot.observedAt * 1000;
  assert(age >= -5_000 && age <= 30_000, 503, "SCANNER_STALE", "The viewing wallet snapshot is not fresh.");
  assert(snapshot.receivingAddresses.includes(destination), 503, "SCANNER_DESTINATION", "The seller destination is not verified by this viewing wallet.");
  const destinations = new Set<string>();
  for (const binding of snapshot.destinationBindings) {
    assert(!destinations.has(binding.destination) && snapshot.receivingAddresses.includes(binding.destination), 503, "SCANNER_DESTINATION", "Invalid verified destination binding.");
    destinations.add(binding.destination);
    const matches = new Set<string>();
    for (const receiver of binding.receivers) {
      const identity = `${receiver.pool}:${receiver.address}`;
      assert(!matches.has(identity) && snapshot.receivingAddresses.includes(receiver.address), 503, "SCANNER_DESTINATION", "Invalid verified receiver binding.");
      matches.add(identity);
    }
  }
  assert(destinations.has(destination), 503, "SCANNER_DESTINATION", "The seller destination has no official SDK ownership binding.");
  const txids = new Set<string>();
  for (const tx of snapshot.transactions) {
    assert(!txids.has(tx.txid.toLowerCase()), 503, "SCANNER_SCHEMA", "The viewing wallet repeated a transaction.");
    txids.add(tx.txid.toLowerCase());
    assert(tx.confirmations <= snapshot.scannedHeight, 503, "SCANNER_SCHEMA", "Invalid viewing wallet confirmation height.");
    if (tx.status === "mined") {
      assert(tx.confirmations > 0 && tx.blocktime !== undefined && /^[0-9a-f]{64}$/i.test(tx.blockhash || ""), 503, "SCANNER_SCHEMA", "A mined transaction is missing its verified block.");
    } else {
      assert(tx.confirmations === 0 && tx.blocktime === undefined && tx.blockhash === undefined, 503, "SCANNER_SCHEMA", "An unmined transaction has inconsistent block data.");
    }
    const outputs = new Set<string>();
    for (const output of tx.outputs) {
      const index = output.pool === "sapling" ? output.output : output.action;
      assert(output.pool !== "transparent" && index !== undefined && Number.isSafeInteger(index) && output.account_uuid === account && output.outgoing !== null && output.valueZat <= 2_100_000_000_000_000, 503, "SCANNER_SCHEMA", "Invalid received note account, amount or output identity.");
      const identity = `${output.pool}:${index}`;
      assert(!outputs.has(identity), 503, "SCANNER_SCHEMA", "The viewing wallet repeated a received note.");
      outputs.add(identity);
      // An incoming external note without a verified recipient could hide a duplicate
      // payment. Fail the entire scan rather than silently confirm a partial history.
      if (output.outgoing === false && !output.walletInternal) {
        assert(output.address && snapshot.receivingAddresses.includes(output.address), 503, "SCANNER_DESTINATION", "An incoming note has no verified recipient binding.");
      }
    }
  }
  return snapshot;
}

// Keep process output private, bounded and out of worker error messages. The exporter
// independently rejects spend-capable wallets before invoking the upstream binary.
export async function readDevtoolSnapshot(): Promise<DevtoolSnapshot> {
  let stdout: string;
  try {
    const result = await execute("python3", [exporter, "--binary", secret("ZCASH_WALLET_BINARY"), "--wallet", secret("ZCASH_VIEW_WALLET_PATH"),
      "--address-verifier", secret("ZCASH_ADDRESS_VERIFIER_BINARY"), "--destination", secret("SELLER_ZCASH_ADDRESS")], {
      encoding: "utf8", timeout: 780_000, maxBuffer: 16 * 1024 * 1024,
      // Three upstream calls have 240-second limits; the address proof has 30 seconds.
      // Do not pass application signing keys or database credentials to the child.
      env: { PATH: process.env.PATH, HOME: process.env.HOME, LANG: "C.UTF-8", NODE_ENV: "production" },
    });
    stdout = result.stdout;
  } catch {
    throw new ApiFault(503, "SCANNER_UNAVAILABLE", "The viewing wallet could not complete a scan.");
  }
  let raw: unknown;
  try { raw = JSON.parse(stdout); }
  catch { throw new ApiFault(503, "SCANNER_SCHEMA", "The viewing wallet returned an invalid snapshot."); }
  return validateDevtoolSnapshot(raw, secret("ZCASH_ACCOUNT_UUID"), secret("SELLER_ZCASH_ADDRESS"));
}
