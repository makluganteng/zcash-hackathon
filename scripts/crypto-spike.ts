/** Live-network feasibility check. Prints public round/timing only; never bid data or keys. */
import assert from "node:assert/strict";
import { mkdir, writeFile } from "node:fs/promises";
import { Buffer, timelockDecrypt } from "tlock-js";
import { fetchBeacon } from "drand-client";
import { decryptBid, decryptInner, drandClient, DRAND, encryptBid, evaluatorKeyHash, generateEvaluatorKeys, openTimeLock, parseCiphertext, randomNonce, roundAfterClose, timeForRound, type EncryptedBidOpening } from "../src/lib/encryption";
const keys = await generateEvaluatorKeys();
const startedAt = new Date().toISOString();
const round = roundAfterClose(Math.floor(Date.now() / 1000), 12);
const opening: EncryptedBidOpening = {version:1,chainId:84532,contract:"0x1111111111111111111111111111111111111111",auctionId:"1",rulesHash:`0x${"22".repeat(32)}`,bidder:"0x3333333333333333333333333333333333333333",amount:"987654321",nonce:randomNonce()};
const ciphertext = await encryptBid(opening,keys.publicKey,round);
const envelope = parseCiphertext(ciphertext);
// Exercise both library opening and a direct request for the unavailable future beacon.
await assert.rejects(timelockDecrypt(envelope.ciphertext,drandClient()));
await assert.rejects(fetchBeacon(drandClient(),round));
console.log(`Live quicknet round ${round}: actual early decryption rejected. Waiting for beacon.`);
await new Promise(resolve => setTimeout(resolve,Math.max(0,timeForRound(round) * 1000 - Date.now()) + 3000));
let inner: string | undefined;
for (let i=0;i<6;i++) {
  try { inner = await openTimeLock(ciphertext,{round,evaluatorKeyHash:evaluatorKeyHash(keys.publicKey)}); break; }
  catch { if(i===5) throw new Error("Beacon still unavailable; no downgrade attempted"); await new Promise(resolve=>setTimeout(resolve,3000)); }
}
assert.ok(inner);
assert.equal(inner.includes(opening.amount),false);
assert.equal(inner.includes(opening.nonce),false);
assert.equal(Buffer.from(inner).includes(Buffer.from(opening.amount)),false);
const wrongKeys=await generateEvaluatorKeys();
await assert.rejects(decryptInner(inner,wrongKeys.privateKey));
assert.deepEqual(await decryptBid(ciphertext,keys.privateKey,{round}),opening);
const evidence={startedAt,completedAt:new Date().toISOString(),chainHash:DRAND.chainHash,round,unlockAt:new Date(timeForRound(round)*1000).toISOString(),beaconVerification:true,earlyActualDecryptionRejected:true,futureBeaconUnavailable:true,outerReleasesCiphertextOnly:true,wrongEvaluatorRejected:true,evaluatorRoundTrip:true};
await mkdir(".omx/evidence",{recursive:true});
await writeFile(".omx/evidence/crypto-spike.json",JSON.stringify(evidence,null,2));
console.log("PASS: verified beacon opened outer layer; inner stayed encrypted; only evaluator recovered bid. Evidence: .omx/evidence/crypto-spike.json");
