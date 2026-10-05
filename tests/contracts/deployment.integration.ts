/** Run with an isolated Anvil on port18548: npx tsx tests/contracts/deployment.integration.ts */
import assert from 'node:assert/strict';
import {mkdtempSync,readFileSync,writeFileSync,statSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createServer} from 'node:http';
import {once} from 'node:events';
import {createPublicClient,http,parseEther} from 'viem';
import {deployLocal,deployBaseSepolia} from '../../scripts/contract-deploy';
const rpc='http://127.0.0.1:18548';const client=createPublicClient({transport:http(rpc)});
const deployer='0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266';
const folder=mkdtempSync(join(tmpdir(),'sealed-deployment-recovery-'));
const manifest=join(folder,'deployment.json');const journalPath=join(folder,'deployment.journal.json');
const journal=()=>JSON.parse(readFileSync(journalPath,'utf8'));
const nonce=()=>client.getTransactionCount({address:deployer,blockTag:'latest'});
async function request(method:string,params:unknown[]=[]){return client.request({method,params} as never);}
let missingBlocks=0;let missingResponses=0;let wrongBlockHash=false;
const proxy=createServer(async(req,res)=>{
 const chunks:Buffer[]=[];for await(const chunk of req)chunks.push(Buffer.from(chunk));
 const body=Buffer.concat(chunks).toString();const payload=JSON.parse(body);
 const numberedBlock=payload.method==='eth_getBlockByNumber'&&/^0x[0-9a-f]+$/i.test(payload.params[0]);
 res.setHeader('Content-Type','application/json');
 if(numberedBlock&&missingBlocks>0){missingBlocks--;missingResponses++;res.end(JSON.stringify({jsonrpc:'2.0',id:payload.id,result:null}));return;}
 const upstream=await fetch(rpc,{method:'POST',headers:{'Content-Type':'application/json'},body});const response=await upstream.json();
 if(numberedBlock&&wrongBlockHash&&response.result)response.result.hash=`0x${'00'.repeat(32)}`;
 res.end(JSON.stringify(response));
});
proxy.listen(0,'127.0.0.1');await once(proxy,'listening');
const proxyAddress=proxy.address();assert.ok(proxyAddress&&typeof proxyAddress==='object');const laggingRpc=`http://127.0.0.1:${proxyAddress.port}`;
const snapshot=await request('evm_snapshot');
try {
assert.equal(await nonce(),0,'Use a fresh isolated Anvil for this integration test');
await request('anvil_setBalance',[deployer,'0x0']);
await assert.rejects(deployLocal(rpc,manifest),/zero test ETH/);
assert.equal(await nonce(),0);assert.equal(Object.keys(journal().entries).length,0);
console.log('PASS zero balance allocates/broadcasts no transaction');
await request('anvil_setBalance',[deployer,`0x${parseEther('100').toString(16)}`]);
await request('evm_setAutomine',[false]);
await assert.rejects(deployLocal(rpc,manifest,{receiptTimeoutMs:250}),/same journal/);
const pending=journal();assert.equal(Object.keys(pending.entries).length,1);
const first=Object.values(pending.entries)[0] as {transactionHash:string;rawTransaction:string;nonce:number;address?:string};
assert.equal(first.nonce,0);assert.equal(first.address,undefined);assert.ok(first.rawTransaction.startsWith('0x'));
assert.equal(statSync(journalPath).mode&0o777,0o600);
console.log('PASS timeout preserves signed transaction and nonce in mode600 journal');
await assert.rejects(deployLocal(rpc,manifest,{receiptTimeoutMs:250}),/same journal/);
assert.equal(Object.keys(journal().entries).length,1);assert.equal((Object.values(journal().entries)[0] as typeof first).transactionHash,first.transactionHash);
console.log('PASS unmined retry rebroadcasts identical transaction without allocating another nonce');
await request('evm_mine');await request('evm_setAutomine',[true]);
missingBlocks=3;
const result=await deployLocal(laggingRpc,manifest);
assert.equal(missingResponses,3);
console.log('PASS receipt ahead of block index recovers after three missing-block responses');
assert.equal(await nonce(),4);assert.equal(result.contracts.length,4);
const recovered=Object.values(journal().entries)[0] as typeof first;
assert.equal(recovered.transactionHash,first.transactionHash);assert.equal(recovered.rawTransaction,first.rawTransaction);assert.ok(recovered.address);
assert.equal(readFileSync(manifest,'utf8').includes('rawTransaction'),false);
assert.equal(readFileSync(manifest,'utf8').includes('privateKey'),false);
console.log('PASS mined-before-restart transaction reused; four contracts total, no duplicate nonce');
await request('anvil_setBalance',[deployer,'0x0']);
const reused=await deployLocal(rpc,manifest);assert.equal(reused.registry,result.registry);assert.equal(await nonce(),4);
console.log('PASS completed deployment can be verified/reused without spending');
missingBlocks=10;const missingBefore=missingResponses;
await assert.rejects(deployLocal(laggingRpc,manifest),/unavailable after 6 checks/);
assert.equal(missingResponses-missingBefore,6);assert.equal(await nonce(),4);missingBlocks=0;
console.log('PASS persistent block lag stops after six checks without allocating a new nonce');
wrongBlockHash=true;
await assert.rejects(deployLocal(laggingRpc,manifest),/not canonical/);assert.equal(await nonce(),4);wrongBlockHash=false;
console.log('PASS present but mismatched block hash fails immediately');
const pristine=journal();
for(const [field,value]of [['chainId',84532],['deployer','0x0000000000000000000000000000000000000001'],['sourceHash',`0x${'00'.repeat(32)}`]]){
 writeFileSync(journalPath,JSON.stringify({...pristine,[field]:value}));
 await assert.rejects(deployLocal(rpc,manifest),/journal differs/);assert.equal(await nonce(),4);
}
writeFileSync(journalPath,JSON.stringify(pristine));
console.log('PASS wrong chain, signer and sources fail closed');
await assert.rejects(deployBaseSepolia(rpc,'0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80'),/RPC chain differs/);
console.log('PASS Base deployment refuses local RPC before any broadcast');
await request('anvil_setCode',[result.verifier,'0x00']);
await assert.rejects(deployLocal(rpc,manifest),/runtime changed/);assert.equal(await nonce(),4);
console.log('PASS changed deployed runtime prevents reuse');
console.log(`Local-only recovery artifacts: ${folder}`);

} finally { await request('evm_setAutomine',[true]); await request('evm_revert',[snapshot]);proxy.closeAllConnections();await new Promise<void>(resolve=>proxy.close(()=>resolve())); }
