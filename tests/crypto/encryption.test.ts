import test from "node:test";
import assert from "node:assert/strict";
import { ciphertextDigest, decryptInner, DRAND, encryptInner, evaluatorKeyHash, generateEvaluatorKeys, openTimeLock, parseCiphertext, randomNonce, roundAfterClose, timeForRound, validateOpening, type EncryptedBidOpening } from "../../src/lib/encryption";
const opening = (): EncryptedBidOpening => ({ version: 1, chainId: 84532, contract: "0x1111111111111111111111111111111111111111", auctionId: "1", rulesHash: `0x${"22".repeat(32)}`, bidder: "0x3333333333333333333333333333333333333333", amount: "500000000", nonce: randomNonce() });
const keys = generateEvaluatorKeys();
test("evaluator ciphertext hides bid; correct key decrypts, altered ciphertext rejects", async () => {
  const pair = await keys;
  const bid = opening();
  const ciphertext = await encryptInner(bid, pair.publicKey);
  assert.ok(!ciphertext.includes(bid.amount));
  assert.ok(!ciphertext.includes(bid.nonce));
  assert.deepEqual(await decryptInner(ciphertext, pair.privateKey), bid);
  const altered = JSON.parse(ciphertext);
  altered.data = (altered.data.startsWith("A") ? "B" : "A") + altered.data.slice(1);
  await assert.rejects(decryptInner(JSON.stringify(altered), pair.privateKey));
  const other = await generateEvaluatorKeys();
  await assert.rejects(decryptInner(ciphertext, other.privateKey));
  assert.equal(evaluatorKeyHash(pair.privateKey), evaluatorKeyHash(pair.publicKey));
  assert.notEqual(evaluatorKeyHash(other.publicKey), evaluatorKeyHash(pair.publicKey));
});
test("same bid encrypts differently and nonce has 256 bits", async () => {
  const pair = await keys;
  const bid = opening();
  const first = await encryptInner(bid, pair.publicKey);
  const second = await encryptInner(bid, pair.publicKey);
  assert.notEqual(ciphertextDigest(first), ciphertextDigest(second));
  assert.match(bid.nonce, /^0x[0-9a-f]{64}$/);
});
test("round is strictly after close and safety margin, including exact boundaries", () => {
  const close = DRAND.genesisTime + 30;
  assert.equal(timeForRound(roundAfterClose(close, 30)), close + 33);
  assert.throws(() => roundAfterClose(close, -1));
  assert.throws(() => timeForRound(NaN));
});
test("outer layer rejects alternate chains, wrong round, key substitution, oversized payloads and early opening", async () => {
  const pair = await keys;
  const round = roundAfterClose(Math.floor(Date.now() / 1000), 300);
  const envelope = {version:1, chainHash:DRAND.chainHash, round, evaluatorKeyHash:evaluatorKeyHash(pair.publicKey), ciphertext:"unused"};
  assert.throws(() => parseCiphertext(JSON.stringify({...envelope, chainHash:"testnet"})));
  assert.throws(() => parseCiphertext(" ".repeat(40_000)));
  await assert.rejects(openTimeLock(JSON.stringify(envelope), {round:round + 1}), /parameters/);
  await assert.rejects(openTimeLock(JSON.stringify(envelope), {evaluatorKeyHash:`0x${"ff".repeat(32)}`}), /parameters/);
  await assert.rejects(openTimeLock(JSON.stringify(envelope)), /not opened/);
});
test("opening rejects precision-loss amounts, overflow, invalid identities and malformed nonce", () => {
  const bid = opening();
  for (const amount of ["0", "-1", "1.2", "01", "18446744073709551616", "1e8"]) assert.throws(() => validateOpening({...bid, amount}));
  assert.throws(() => validateOpening({...bid, amount:500000000}));
  assert.throws(() => validateOpening({...bid, nonce:"0x1234"}));
  assert.throws(() => validateOpening({...bid, bidder:"garbage"}));
});
