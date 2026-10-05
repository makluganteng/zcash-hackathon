/** Opt-in, isolated PostgreSQL + Anvil regression. All addresses/funds are local fixtures. */
import test from 'node:test';
import assert from 'node:assert/strict';
import {spawn,execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {readFile,mkdtemp,writeFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {Pool} from 'pg';
import {createPublicClient,createWalletClient,http,keccak256,toHex,type Hex} from 'viem';
import {privateKeyToAccount} from 'viem/accounts';
import {foundry} from 'viem/chains';
import {deployLocal} from '../../scripts/contract-deploy';
import {auctionAbi} from '../../src/lib/contract';
import {bidCommitment,bidTypedData,hashRules,type AuctionRules} from '../../src/lib/protocol';
import {createChallenge,claimInvoice,getInvoice} from '../../src/server/claims';
import {getAuction,createAuction,submitBid,getBidReceipt} from '../../src/server/auctions';
import {db} from '../../src/server/db';
import {evaluateAuction} from '../../src/server/worker';
import {generateEvaluatorKeys} from '../../src/lib/encryption';
const execute=promisify(execFile);

test('real local proof + PostgreSQL: winner-only claims, atomic replay protection, idempotent invoices and stale-chain suspension', {skip:process.env.RUN_SERVER_INTEGRATION!=='1',timeout:240000}, async()=>{
 const dir=await mkdtemp(join(tmpdir(),'sealed-service-test-'));
 const database=`sealed_auction_test_${process.pid}`;
 const admin=new Pool({connectionString:'postgresql://auction_dev@127.0.0.1:55432/postgres'});
 const anvil=spawn('anvil',['--port','18547','--silent'],{stdio:'ignore'});
 try {
  await admin.query(`CREATE DATABASE ${database}`);
  const evaluator=await generateEvaluatorKeys();
  Object.assign(process.env,{DATABASE_URL:`postgresql://auction_dev@127.0.0.1:55432/${database}`,BASE_CHAIN_ID:'31337',BASE_RPC_URL:'http://127.0.0.1:18547',APP_ORIGIN:'http://localhost:3000',OPERATOR_TOKEN:'unit-test-only-operator',RELAY_PRIVATE_KEY:'0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80',INVOICE_PRIVATE_KEY:`0x${'45'.repeat(32)}`,SELLER_ZCASH_ADDRESS:'ztestsapling1-explicit-test-fixture-not-payable',EVALUATOR_PUBLIC_JWK:JSON.stringify(evaluator.publicKey)});
  const client=createPublicClient({chain:foundry,transport:http(process.env.BASE_RPC_URL)});
  for(let i=0;i<50;i++){try{await client.getChainId();break;}catch{await new Promise(r=>setTimeout(r,100));}}
  const deployed=await deployLocal(process.env.BASE_RPC_URL,join(dir,'deployment.json'));
  process.env.REGISTRY_ADDRESS=deployed.registry;process.env.EXPECTED_VERIFIER_ADDRESS=deployed.verifier;
  await db().query(await readFile('db/001-init.sql','utf8'));
  await db().query(await readFile('db/002-server-only.sql','utf8'));
  const owner=privateKeyToAccount(process.env.RELAY_PRIVATE_KEY as Hex);const winner=privateKeyToAccount(`0x${'01'.repeat(32)}`);const other=privateKeyToAccount(`0x${'02'.repeat(32)}`);
  const wallet=createWalletClient({chain:foundry,transport:http(process.env.BASE_RPC_URL),account:owner});
  const title='Local fixture auction',description='Explicit isolated server test, never payable.',category='Test';
  const block=await client.getBlock();
  const rules:AuctionRules={seller:owner.address,itemHash:keccak256(toHex(JSON.stringify({title,description,category}))),destinationHash:keccak256(toHex(process.env.SELLER_ZCASH_ADDRESS!)),reserve:100000000n,maxAmount:2100000000000000n,closesAt:block.timestamp+600n,finalizationWindow:86400,paymentWindow:3600,evaluatorKeyHash:`0x${'33'.repeat(32)}`,drandChainHash:`0x${'44'.repeat(32)}`,drandRound:100n};
  async function write(functionName:string,args:unknown[]){const hash=await wallet.writeContract({address:deployed.registry,abi:auctionAbi,functionName,args} as never);const receipt=await client.waitForTransactionReceipt({hash});assert.equal(receipt.status,'success');return hash;}
  const creationHash=await write('createAuction',[rules]);
  await db().query('INSERT INTO auctions(id,title,description,category,item_hash,creation_tx) VALUES($1,$2,$3,$4,$5,$6)',['1',title,description,category,rules.itemHash,creationHash]);
  const rulesHash=hashRules(31337n,deployed.registry,1n,rules);const amount=500000000n;const nonce=`0x${'55'.repeat(32)}` as Hex;
  const commitment=bidCommitment(rulesHash,winner.address,amount,nonce);const ciphertextHash=`0x${'66'.repeat(32)}` as Hex;
  const signature=await winner.signTypedData(bidTypedData(31337,deployed.registry,{auctionId:1n,rulesHash,bidder:winner.address,commitment,ciphertextHash}));
  await write('registerBid',[1n,winner.address,commitment,ciphertextHash,signature]);
  const input=join(dir,'private.json');await writeFile(input,JSON.stringify({rulesHash,reserve:String(rules.reserve),maxAmount:String(rules.maxAmount),bids:[{bidder:winner.address,commitment,amount:String(amount),nonce}]}),{mode:0o600});
  await execute('python3',['scripts/proof-run.py',input,join(dir,'proof')],{timeout:180000,maxBuffer:1024*1024});
  const bundle=JSON.parse(await readFile(join(dir,'proof/bundle.json'),'utf8'));
  await client.request({method:'evm_setNextBlockTimestamp' as never,params:[Number(rules.closesAt)] as never});await client.request({method:'evm_mine' as never});
  await client.request({method:'anvil_mine' as never,params:['0x41','0x0'] as never});
  await write('finalizeAuction',[1n,bundle.proof,{...bundle.result,price:BigInt(bundle.result.price)}]);
  const nonceBefore=await client.getTransactionCount({address:owner.address});
  await evaluateAuction('1');
  assert.equal((await db().query("SELECT worker_status FROM auctions WHERE id='1'")).rows[0].worker_status,'submitted');
  assert.equal(await client.getTransactionCount({address:owner.address}),nonceBefore,'worker must not rebroadcast a mined result awaiting finality');
  await client.request({method:'anvil_mine' as never,params:['0x45'] as never});
  assert.equal((await getAuction('1')).phase,'verified-sale');
  await evaluateAuction('1');
  assert.equal((await db().query("SELECT worker_status FROM auctions WHERE id='1'")).rows[0].worker_status,'finalized');
  await assert.rejects(createChallenge('1',{bidder:other.address}),/winning identity/);
  const wrong=await createChallenge('1',{bidder:winner.address});
  await assert.rejects(claimInvoice('1',{challengeId:wrong.challengeId,signature:await other.signMessage({message:wrong.message})}),/signature is invalid/);
  const c=await createChallenge('1',{bidder:winner.address});const claim={challengeId:c.challengeId,signature:await winner.signMessage({message:c.message})};
  const concurrent=await Promise.allSettled([claimInvoice('1',claim),claimInvoice('1',claim)]);
  assert.equal(concurrent.filter(r=>r.status==='fulfilled').length,1);assert.equal(concurrent.filter(r=>r.status==='rejected').length,1);
  const result=concurrent.find(r=>r.status==='fulfilled')!;assert.equal(result.status,'fulfilled');if(result.status!=='fulfilled')throw Error('No claim');
  assert.equal(result.value.invoice.status,'awaiting-payment');
  assert.equal((await db().query('SELECT count(*) FROM invoices')).rows[0].count,'1');
  const again=await createChallenge('1',{bidder:winner.address});const second=await claimInvoice('1',{challengeId:again.challengeId,signature:await winner.signMessage({message:again.message})});assert.equal(second.invoice.payload.id,result.value.invoice.payload.id);
  const expired=await createChallenge('1',{bidder:winner.address});await db().query("UPDATE claim_challenges SET expires_at=now()-interval '1 second' WHERE id=$1",[expired.challengeId]);
  await assert.rejects(claimInvoice('1',{challengeId:expired.challengeId,signature:await winner.signMessage({message:expired.message})}),/expired/);
  await assert.rejects(getInvoice(second.invoice.payload.id,'Bearer '+ '0'.repeat(64)),/authorization/);
  await db().query("UPDATE auctions SET title='Tampered description' WHERE id='1'");await assert.rejects(getAuction('1'),/immutable auction commitment/);await db().query('UPDATE auctions SET title=$1 WHERE id=$2',[title,'1']);
  const savedNow=Date.now;Date.now=()=>Date.parse(second.invoice.payload.expiresAt)+1;
  try {await assert.rejects(createChallenge('1',{bidder:winner.address}),/expired/);}finally{Date.now=savedNow;}
  // Simulate a stale recorded block reference. The live chain remains canonical.
  await db().query("UPDATE invoices SET payload=jsonb_set(payload,'{resultBlockHash}',to_jsonb($2::text)) WHERE id=$1",[second.invoice.payload.id,`0x${'00'.repeat(32)}`]);
  assert.equal((await getInvoice(second.invoice.payload.id,`Bearer ${second.token}`)).invoice.status,'needs-review');
  // Exercise the real API service creation/relay path. Recipient stays test-only.
  const request={requestId:'1a7d6645-4cce-4be0-8056-39b0e4291c45',title:'Relay recovery fixture',description:'Nonpayable integration fixture for durable relay transactions.',category:'Test',reserve:'100000000',closesAt:new Date(savedNow()+7200000).toISOString()};
  const created=await createAuction(request);const repeated=await createAuction(request);assert.equal(created.id,repeated.id);
  await assert.rejects(createAuction({...request,title:'Changed request'}),/different rules/);
  await assert.rejects(getAuction(created.id),/finalized/);
  await client.request({method:'anvil_mine' as never,params:['0x45'] as never});
  const active=await getAuction(created.id);
  const ciphertext=JSON.stringify({version:1,chainHash:active.drandChainHash.slice(2),round:Number(active.drandRound),evaluatorKeyHash:active.evaluatorKeyHash,ciphertext:'explicit malformed ciphertext fixture; admission does not prove consistency'});
  const cHash=keccak256(toHex(ciphertext));const bidCommit=bidCommitment(active.rulesHash,winner.address,amount,nonce);
  const envelope={auctionId:BigInt(created.id),rulesHash:active.rulesHash,bidder:winner.address,commitment:bidCommit,ciphertextHash:cHash};
  const bid={bidder:winner.address,commitment:bidCommit,ciphertextHash:cHash,ciphertext,signature:await winner.signTypedData(bidTypedData(31337,deployed.registry,envelope))};
  const submitted=await submitBid(created.id,bid);assert.equal(submitted.status,'pending');
  assert.equal((await submitBid(created.id,bid)).transactionHash,submitted.transactionHash);
  const changedCiphertext=ciphertext+' ';const changedHash=keccak256(toHex(changedCiphertext));
  await assert.rejects(submitBid(created.id,{...bid,ciphertext:changedCiphertext,ciphertextHash:changedHash,signature:await winner.signTypedData(bidTypedData(31337,deployed.registry,{...envelope,ciphertextHash:changedHash}))}),/different bid envelope/);
  await client.request({method:'anvil_mine' as never,params:['0x45'] as never});
  const accepted=await getBidReceipt(created.id,bidCommit);assert.equal(accepted.status,'accepted');assert.equal(accepted.insertionIndex,0);
  assert.equal((await db().query('SELECT count(*) FROM creation_requests')).rows[0].count,'1');
  assert.equal((await db().query('SELECT count(*) FROM bid_submissions WHERE raw_transaction IS NOT NULL')).rows[0].count,'1');
 } finally {
  await db().end();anvil.kill('SIGTERM');
  await admin.query(`DROP DATABASE IF EXISTS ${database} WITH (FORCE)`);await admin.end();await rm(dir,{recursive:true,force:true});
 }
});
