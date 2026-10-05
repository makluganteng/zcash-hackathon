import test from "node:test";
import assert from "node:assert/strict";
import { readDevtoolSnapshot, validateDevtoolSnapshot } from "../../src/server/devtool-scanner";
import { receivedNotes, classifyPayment, scanPayments } from "../../src/server/payments";
import type { InvoicePayload } from "../../src/lib/api-types";

const account = "bf6f2b12-22e1-4296-9231-2de3e76e2789";
const destination = "utest1-unit-test-not-payable";
const now = Date.parse("2026-10-06T12:00:00Z");
const hash = `0x${"01".repeat(32)}` as const;
const invoice: InvoicePayload = {
  version: 1, id: account, auctionId: "1", chainId: 84532,
  registry: "0x1111111111111111111111111111111111111111", rulesHash: hash,
  resultBlockHash: hash, resultBlockNumber: "4", winnerIdentity: "0x2222222222222222222222222222222222222222",
  destination, destinationHash: hash, network: "testnet", amount: "100000001",
  reference: "sealed:devtool-fixture", expiresAt: new Date(now + 60_000).toISOString(),
};
function fixture() {
  return {
    network: "test", accountUuid: account, scannedHeight: 4_467_000, serverTargetHeight: 4_467_000,
    observedAt: now / 1000, receivingAddresses: [destination],
    destinationBindings: [{destination, receivers: [{address: destination, pool: "orchard"}]}],
    transactions: [{
      txid: "ab".repeat(32), confirmations: 3, status: "mined", blockhash: "cd".repeat(32), blocktime: now / 1000 - 120,
      outputs: [{pool: "orchard", action: 7, account_uuid: account, address: destination,
        outgoing: false, walletInternal: false, valueZat: 100000001, memoStr: invoice.reference}],
    }],
  };
}
const validate = (value: unknown) => validateDevtoolSnapshot(value, account, destination, now);

test("a fresh complete viewing-wallet snapshot preserves exact note identity and amount", () => {
  const snapshot = validate(fixture());
  const notes = snapshot.transactions.flatMap(tx => receivedNotes(tx, invoice, account));
  assert.deepEqual(notes.map(n => [n.outputId, n.amount]), [["orchard:7", "100000001"]]);
  assert.equal(classifyPayment(invoice, notes, 3, now).status, "receiver-confirmed");
  const absent = validate({...fixture(), transactions: []});
  assert.equal(classifyPayment(invoice, absent.transactions.flatMap(tx => receivedNotes(tx, invoice, account)), 3, now).status, "awaiting-payment");
});
test("metadata cannot establish readiness without current testnet/account/height/ownership evidence", () => {
  for (const change of [
    {network: "main"}, {accountUuid: "b93741cc-5754-4298-a09b-8b622a5f21f4"},
    {scannedHeight: 4_466_999}, {serverTargetHeight: 4_465_025},
    {observedAt: now / 1000 - 31}, {observedAt: now / 1000 + 6},
    {receivingAddresses: []}, {receivingAddresses: undefined}, {receivingAddresses: ["utest1-other-fixture"]},
    {receivingAddresses: ["t1-transparent-fixture"]},
    {destinationBindings: undefined}, {destinationBindings: []},
    {destinationBindings: [{destination: "utest1-other", receivers: []}]},
  ]) assert.throws(() => validate({...fixture(), ...change}));
  assert.doesNotThrow(() => validate({...fixture(), transactions: []}));
});
test("duplicate transaction or output records cannot double-count payments", () => {
  const snapshot = fixture();
  assert.throws(() => validate({...snapshot, transactions: [...snapshot.transactions, snapshot.transactions[0]]}));
  snapshot.transactions[0].outputs.push({...snapshot.transactions[0].outputs[0]});
  assert.throws(() => validate(snapshot));
});
test("malformed notes and unknown incoming recipients fail the entire snapshot", () => {
  for (const change of [
    {action: undefined}, {pool: "transparent"}, {account_uuid: "wrong-account"},
    {address: undefined}, {address: "utest1-not-owned"}, {valueZat: Number.MAX_SAFE_INTEGER + 1},
    {outgoing: null}, {valueZat: 2_100_000_000_000_001},
  ]) {
    const snapshot = fixture();
    Object.assign(snapshot.transactions[0].outputs[0], change);
    assert.throws(() => validate(snapshot));
  }
});
test("mined and unmined records must have consistent block evidence", () => {
  for (const change of [
    {confirmations: 0}, {confirmations: 4_467_001}, {blockhash: undefined}, {blockhash: "bad"},
    {blocktime: undefined}, {status: "waiting"}, {status: "expired"},
  ]) {
    const snapshot = fixture();
    Object.assign(snapshot.transactions[0], change);
    assert.throws(() => validate(snapshot));
  }
  const snapshot = fixture();
  Object.assign(snapshot.transactions[0], {status: "waiting", confirmations: 0, blockhash: undefined, blocktime: undefined});
  assert.doesNotThrow(() => validate(snapshot));
});
test("another owned address is not an alias for the invoice destination", () => {
  const snapshot = fixture();
  snapshot.receivingAddresses.push("utest1-other-owned-fixture");
  snapshot.transactions[0].outputs[0].address = snapshot.receivingAddresses[1];
  assert.equal(receivedNotes(validate(snapshot).transactions[0], invoice, account).length, 0);
});
test("R2 testnet UAs remain exact destinations and never become legacy aliases", () => {
  for (const prefix of ["zutest1", "tutest1"]) {
    const snapshot = fixture();
    const revisionTwo = `${prefix}-unit-test-not-payable`;
    snapshot.receivingAddresses = [revisionTwo];
    snapshot.destinationBindings = [{destination: revisionTwo, receivers: [{address: revisionTwo, pool: "orchard"}]}];
    snapshot.transactions[0].outputs[0].address = revisionTwo;
    const parsed = validateDevtoolSnapshot(snapshot, account, revisionTwo, now);
    const r2Invoice = {...invoice, destination: revisionTwo};
    assert.equal(receivedNotes(parsed.transactions[0], r2Invoice, account).length, 1);
    assert.equal(receivedNotes(parsed.transactions[0], invoice, account).length, 0);
    assert.throws(() => validate(snapshot), /seller destination is not verified/);
  }
  for (const address of ["zu1-mainnet", "tu1-mainnet", "zutest-invalid-separator", "tutest-invalid-separator"]) {
    assert.throws(() => validate({...fixture(), receivingAddresses: [destination, address]}));
  }
});
test("SDK bindings authorize only matching output pools, not every receiver in a stored UA", () => {
  const snapshot = fixture();
  const stored = "zutest1-mixed-receivers-fixture";
  snapshot.receivingAddresses.push(stored);
  snapshot.destinationBindings[0].receivers = [{address: stored, pool: "orchard"}, {address: stored, pool: "ironwood"}];
  snapshot.transactions[0].outputs[0].address = stored;
  const parsed = validate(snapshot);
  const receivers = parsed.destinationBindings[0].receivers;
  assert.equal(receivedNotes(parsed.transactions[0], invoice, account, receivers).length, 1);
  const sapling = {...parsed.transactions[0], outputs: [{...parsed.transactions[0].outputs[0], pool: "sapling", output: 7, action: undefined}]};
  assert.equal(receivedNotes(sapling, invoice, account, receivers).length, 0);
  const ironwood = {...parsed.transactions[0], outputs: [{...parsed.transactions[0].outputs[0], pool: "ironwood"}]};
  assert.equal(receivedNotes(ironwood, invoice, account, receivers).length, 1);
  const differentAddress = {...parsed.transactions[0], outputs: [{...parsed.transactions[0].outputs[0], address: "zutest1-another-owned-fixture"}]};
  assert.equal(receivedNotes(differentAddress, invoice, account, receivers).length, 0);
});
test("ambiguous, unsupported and unowned SDK binding records fail closed", () => {
  const snapshot = fixture();
  for (const destinationBindings of [
    [{destination, receivers: []}],
    [snapshot.destinationBindings[0], snapshot.destinationBindings[0]],
    [{destination, receivers: [{address: destination, pool: "transparent"}]}],
    [{destination, receivers: [{address: "zutest1-unowned", pool: "orchard"}]}],
    [{destination, receivers: [snapshot.destinationBindings[0].receivers[0], snapshot.destinationBindings[0].receivers[0]]}],
  ]) assert.throws(() => validate({...snapshot, destinationBindings}));
});
test("devtool selection fails closed when unconfigured and rejects unknown backends", async t => {
  const keys = ["ZCASH_SCANNER_BACKEND", "ZCASH_VIEW_WALLET_PATH", "ZCASH_WALLET_BINARY", "ZCASH_ADDRESS_VERIFIER_BINARY", "ZCASH_ACCOUNT_UUID", "SELLER_ZCASH_ADDRESS"];
  const saved = keys.map(key => process.env[key]);
  t.after(() => keys.forEach((key, index) => { if (saved[index] === undefined) delete process.env[key]; else process.env[key] = saved[index]; }));
  keys.forEach(key => delete process.env[key]);
  process.env.ZCASH_SCANNER_BACKEND = "devtool";
  assert.equal(await scanPayments(), false);
  process.env.ZCASH_SCANNER_BACKEND = "unsupported";
  await assert.rejects(scanPayments(), /Unknown receiver scanner backend/);
});
test("exporter execution failures expose no wallet paths or process output", async t => {
  const keys = ["ZCASH_WALLET_BINARY", "ZCASH_VIEW_WALLET_PATH", "ZCASH_ADDRESS_VERIFIER_BINARY", "SELLER_ZCASH_ADDRESS"];
  const saved = keys.map(key => process.env[key]);
  t.after(() => keys.forEach((key, index) => { if (saved[index] === undefined) delete process.env[key]; else process.env[key] = saved[index]; }));
  process.env.ZCASH_WALLET_BINARY = "/nonexistent/sealed-scanner-test/binary";
  process.env.ZCASH_VIEW_WALLET_PATH = "/nonexistent/sealed-scanner-test/view-wallet";
  process.env.ZCASH_ADDRESS_VERIFIER_BINARY = "/nonexistent/sealed-scanner-test/verifier";
  process.env.SELLER_ZCASH_ADDRESS = destination;
  await assert.rejects(readDevtoolSnapshot(), error => {
    assert.ok(error instanceof Error);
    assert.equal(error.message, "The viewing wallet could not complete a scan.");
    return true;
  });
});
