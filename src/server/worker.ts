import { mkdtemp, writeFile, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { z } from "zod";
import { keccak256, toHex, type Hex } from "viem";
import { auctionAbi } from "../lib/contract";
import { bidCommitment, buildPublicInputs, type AuctionResult } from "../lib/protocol";
import { ciphertextDigest, decryptBid, DRAND, timeForRound } from "../lib/encryption";
import { db, transaction } from "./db";
import { requireConfiguration, secret } from "./config";
import { readSnapshot, relayClient } from "./chain";
import { assert } from "./errors";
import { scanPayments } from "./payments";
import { recoverCreation,recoverPendingBids } from "./auctions";
const execute=promisify(execFile);
const bundleSchema=z.object({protocol:z.literal("private-auction-v1"),proof:z.string().regex(/^0x[0-9a-f]+$/i),publicInputs:z.array(z.string().regex(/^0x[0-9a-f]{64}$/i)).length(57),result:z.object({sale:z.boolean(),winnerIndex:z.number().int().nonnegative(),winnerIdentity:z.string().regex(/^0x[0-9a-f]{40}$/i),price:z.string().regex(/^\d+$/)}),vkHash:z.string(),provingSeconds:z.number()});
export async function evaluateAuction(id:string) {
  const {auction,bids,block}=await readSnapshot(id); const {address,chain,publicClient,walletClient}=relayClient();
  if(auction.status!==0) {
    await db().query("UPDATE auctions SET worker_status=$2,worker_error=null WHERE id=$1",[id,auction.status===3?"expired":"finalized"]);
    return;
  }
  if(block.timestamp<auction.rules.closesAt) {
    await db().query("UPDATE auctions SET worker_status='waiting',worker_error=null WHERE id=$1 AND (worker_status<>'waiting' OR worker_error IS NOT NULL)",[id]);
    return;
  }
  // A mined result may still be outside the finalized snapshot. It is not yet a
  // publishable result, but re-proving/re-broadcasting would waste gas on reverts.
  // If the transaction is reorged out, a later tick sees status 0 and retries.
  const latest=await publicClient.readContract({address,abi:auctionAbi,functionName:"getAuction",args:[BigInt(id)]});
  if(latest.status!==0) {
    await db().query("UPDATE auctions SET worker_status='submitted',worker_error=null WHERE id=$1",[id]);
    return;
  }
  if(block.timestamp>=auction.rules.closesAt+BigInt(auction.rules.finalizationWindow)) { await transaction(async client=>{await client.query("SELECT pg_advisory_xact_lock(914023)");const hash=await walletClient.writeContract({address,abi:auctionAbi,functionName:"expireAuction",args:[BigInt(id)]}); await publicClient.waitForTransactionReceipt({hash});});return; }
  assert(auction.rules.drandChainHash===`0x${DRAND.chainHash}`,409,"UNSUPPORTED_BEACON","Auction uses an unsupported beacon.");
  if(Date.now()<timeForRound(Number(auction.rules.drandRound))*1000) return;
  const key=JSON.parse(await readFile(secret("EVALUATOR_PRIVATE_JWK_PATH"),"utf8")) as JsonWebKey;
  const openings=[];
  for(const bid of bids) {
    const blob=(await db().query("SELECT ciphertext FROM bid_blobs WHERE ciphertext_hash=$1",[bid.ciphertextHash.toLowerCase()])).rows[0];
    assert(blob && ciphertextDigest(blob.ciphertext)===bid.ciphertextHash,409,"MISSING_CIPHERTEXT","A registered bid has unavailable ciphertext. Finalization is blocked.");
    const opened=await decryptBid(blob.ciphertext,key,{round:Number(auction.rules.drandRound),evaluatorKeyHash:auction.rules.evaluatorKeyHash});
    assert(opened.chainId===chain.id && opened.contract.toLowerCase()===address.toLowerCase() && opened.auctionId===id && opened.rulesHash===auction.rulesHash && opened.bidder.toLowerCase()===bid.bidder.toLowerCase(),409,"OPENING_MISMATCH","A bid does not match the registry context.");
    assert(bidCommitment(auction.rulesHash,bid.bidder,BigInt(opened.amount),opened.nonce)===bid.commitment,409,"OPENING_MISMATCH","A registered commitment does not open correctly.");
    openings.push({bidder:bid.bidder,commitment:bid.commitment,amount:opened.amount,nonce:opened.nonce});
  }
  const directory=await mkdtemp(join(tmpdir(),"sealed-proof-"));
  try {
    await db().query("UPDATE auctions SET worker_status='proving',worker_error=null WHERE id=$1",[id]);
    const input=join(directory,"input.json");
    await writeFile(input,JSON.stringify({rulesHash:auction.rulesHash,reserve:auction.rules.reserve.toString(),maxAmount:auction.rules.maxAmount.toString(),bids:openings}),{mode:0o600});
    await execute("python3",[resolve("scripts/proof-run.py"),input,join(directory,"output")],{timeout:30*60*1000,maxBuffer:1024*1024});
    const bundle=bundleSchema.parse(JSON.parse(await readFile(join(directory,"output/bundle.json"),"utf8")));
    const result:AuctionResult={...bundle.result,winnerIdentity:bundle.result.winnerIdentity as Hex,price:BigInt(bundle.result.price)};
    assert(JSON.stringify(buildPublicInputs(auction.rulesHash,auction.rules,bids,result))===JSON.stringify(bundle.publicInputs),409,"PROOF_INPUT_MISMATCH","Prover output does not match the complete registry.");
    // Re-read after proving: never broadcast a stale registry/result.
    const current=await readSnapshot(id);
    assert(current.auction.status===0 && current.auction.rulesHash===auction.rulesHash && JSON.stringify(current.bids)===JSON.stringify(bids),409,"STALE_SNAPSHOT","Registry changed while proving.");
    const published={...bundle,chainId:chain.id,registry:address,auctionId:id,rulesHash:auction.rulesHash,snapshotBlock:block.number.toString(),snapshotHash:block.hash};
    // Only public proof data is durable; make it recoverable before on-chain finalization.
    await db().query("UPDATE auctions SET proof_bundle=$2 WHERE id=$1",[id,published]);
    const hash=await transaction(async client=>{
      await client.query("SELECT pg_advisory_xact_lock(914023)");
      const hash=await walletClient.writeContract({address,abi:auctionAbi,functionName:"finalizeAuction",args:[BigInt(id),bundle.proof as Hex,result]});
      const receipt=await publicClient.waitForTransactionReceipt({hash});
      assert(receipt.status==="success",409,"PROOF_REJECTED","The registry rejected the proof.");return hash;
    });
    await db().query("UPDATE auctions SET proof_bundle=$2,worker_status='submitted',worker_error=null WHERE id=$1",[id,{...published,transactionHash:hash}]);
  } finally { await rm(directory,{recursive:true,force:true}); }
}
export async function workerTick() {
  requireConfiguration();
  const client=await db().connect();
  try {
    // Session advisory lease releases on process termination; multiple workers cannot double-prove.
    const lock=(await client.query("SELECT pg_try_advisory_lock(914024) AS acquired")).rows[0].acquired;
    if(!lock) return;
    try {
      for(const row of (await client.query("SELECT id FROM creation_requests WHERE auction_id IS NULL AND NOT failed ORDER BY created_at")).rows) {
        await client.query("SELECT pg_advisory_lock(914023)");
        try { await recoverCreation(row.id); } catch { /* Persisted raw transaction remains retryable. */ }
        finally { await client.query("SELECT pg_advisory_unlock(914023)"); }
      }
      await client.query("SELECT pg_advisory_lock(914023)");
      try {await recoverPendingBids();} finally {await client.query("SELECT pg_advisory_unlock(914023)");}
      for(const row of (await client.query("SELECT id FROM auctions WHERE creation_tx IS NOT NULL ORDER BY created_at")).rows) {
        try { await evaluateAuction(row.id); }
        catch { await client.query("UPDATE auctions SET worker_status='blocked',worker_error='An opening, provider, or proof step failed. No bid was skipped.' WHERE id=$1",[row.id]); }
      }
      const paymentReady = await scanPayments();
      const destinationHash = paymentReady ? keccak256(toHex(secret("SELLER_ZCASH_ADDRESS"))) : null;
      await client.query("INSERT INTO worker_health(singleton,checked_at,status,payment_ready,payment_destination_hash) VALUES(true,now(),'ok',$1,$2) ON CONFLICT(singleton) DO UPDATE SET checked_at=now(),status='ok',payment_ready=EXCLUDED.payment_ready,payment_destination_hash=EXCLUDED.payment_destination_hash", [paymentReady,destinationHash]);
    } catch (error) {
      // Revoke a previously healthy receiver immediately on scan/provider errors.
      await client.query("INSERT INTO worker_health(singleton,checked_at,status,payment_ready) VALUES(true,now(),'error',false) ON CONFLICT(singleton) DO UPDATE SET checked_at=now(),status='error',payment_ready=false,payment_destination_hash=null");
      throw error;
    } finally { await client.query("SELECT pg_advisory_unlock(914024)"); }
  } finally { client.release(); }
}
