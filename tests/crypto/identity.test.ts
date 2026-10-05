import test from "node:test";
import assert from "node:assert/strict";
import { verifyTypedData } from "viem";
import { bidTypedData, type BidEnvelope } from "../../src/lib/protocol";
import { createIdentity, exportIdentity, identityScope, importIdentity, loadIdentity, saveIdentity, signBidEnvelope } from "../../src/lib/identity";
const contract = "0x1111111111111111111111111111111111111111" as const;
const scope = identityScope(84532, contract, "1");
test("local backup restores signer and rejects wrong scope/address/version", () => {
  const identity = createIdentity(scope);
  assert.deepEqual(importIdentity(exportIdentity(identity), scope), identity);
  assert.notEqual(createIdentity(scope).address, identity.address);
  assert.throws(() => importIdentity(exportIdentity(identity), "another-auction"));
  assert.throws(() => importIdentity(JSON.stringify({...identity,address:contract}), scope));
  assert.throws(() => importIdentity(JSON.stringify({...identity,version:2}), scope));
});
test("browser storage is inaccessible from worker/server", () => {
  assert.throws(() => loadIdentity(scope), /browser-only/);
  assert.throws(() => saveIdentity(createIdentity(scope)), /browser-only/);
});
test("bid signing binds contract/chain/auction and refuses another identity", async () => {
  const identity = createIdentity(scope);
  const envelope: BidEnvelope = {auctionId:1n,rulesHash:`0x${"11".repeat(32)}`,bidder:identity.address,commitment:`0x${"22".repeat(32)}`,ciphertextHash:`0x${"33".repeat(32)}`};
  const signature = await signBidEnvelope(identity,84532,contract,envelope);
  assert.ok(await verifyTypedData({...bidTypedData(84532,contract,envelope),address:identity.address,signature}));
  assert.equal(await verifyTypedData({...bidTypedData(84533,contract,envelope),address:identity.address,signature}),false);
  await assert.rejects(signBidEnvelope(identity,84532,contract,{...envelope,auctionId:2n}), /scope/);
  await assert.rejects(signBidEnvelope(identity,84532,contract,{...envelope,bidder:contract}), /scope/);
});
