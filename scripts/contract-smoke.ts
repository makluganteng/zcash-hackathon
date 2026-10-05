/** End-to-end local EVM test with actual encrypted-opening commitments and a real ZK proof. */
import {readFileSync,writeFileSync,mkdirSync} from 'node:fs';
import {execFileSync} from 'node:child_process';
import {createPublicClient,createWalletClient,http,type Hex} from 'viem';
import {privateKeyToAccount} from 'viem/accounts';
import {foundry} from 'viem/chains';
import {deployLocal} from './contract-deploy';
import {auctionAbi} from '../src/lib/contract';
import {bidCommitment,bidTypedData,hashRules,buildPublicInputs,type AuctionRules} from '../src/lib/protocol';
const rpc=process.env.LOCAL_RPC_URL??'http://127.0.0.1:8545';
const publicClient=createPublicClient({chain:foundry,transport:http(rpc)});
if(await publicClient.getChainId()!==31337) throw new Error('Smoke must use a local chain');
const account=privateKeyToAccount('0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80');
const wallet=createWalletClient({chain:foundry,transport:http(rpc),account});
const {registry,verifier}=await deployLocal(rpc,'.local/smoke/deployment.json');
const block=await publicClient.getBlock();
const rules:AuctionRules={seller:account.address,itemHash:`0x${'11'.repeat(32)}`,destinationHash:`0x${'22'.repeat(32)}`,reserve:100000000n,maxAmount:2100000000000000n,closesAt:block.timestamp+600n,finalizationWindow:86400,paymentWindow:3600,evaluatorKeyHash:`0x${'33'.repeat(32)}`,drandChainHash:`0x${'44'.repeat(32)}`,drandRound:100n};
async function write(functionName:string,args:unknown[]){ const hash=await wallet.writeContract({address:registry,abi:auctionAbi,functionName,args} as never); const receipt=await publicClient.waitForTransactionReceipt({hash});if(receipt.status!=='success')throw new Error('Transaction reverted');return receipt; }
const auctionId=await publicClient.readContract({address:registry,abi:auctionAbi,functionName:'nextAuctionId'});
await write('createAuction',[rules]); const rulesHash=hashRules(31337n,registry,auctionId,rules);
const registered=await publicClient.readContract({address:registry,abi:auctionAbi,functionName:'getAuction',args:[auctionId]});
if(registered.rulesHash!==rulesHash) throw new Error('Rules hash mismatch');
const amounts=process.env.SMOKE_BIDS==='16'?Array.from({length:16},(_,i)=>BigInt(i+1)*100000000n):[200000000n,500000000n,300000000n];
const bids=[];
for(const [i,amount] of amounts.entries()){
 const signer=privateKeyToAccount(`0x${(i+1).toString(16).padStart(64,'0')}`);
 const nonce=`0x${(i+1).toString(16).padStart(2,'0').repeat(32)}` as Hex;
 const commitment=bidCommitment(rulesHash,signer.address,amount,nonce);
 const ciphertextHash=`0x${(i+10).toString(16).padStart(2,'0').repeat(32)}` as Hex;
 const envelope={auctionId,rulesHash,bidder:signer.address,commitment,ciphertextHash};
 const signature=await signer.signTypedData(bidTypedData(31337,registry,envelope));
 await write('registerBid',[auctionId,signer.address,commitment,ciphertextHash,signature]);
 bids.push({...envelope,amount:amount.toString(),nonce});
}
mkdirSync('.local/smoke',{recursive:true});
writeFileSync('.local/smoke/private-input.json',JSON.stringify({rulesHash,reserve:rules.reserve.toString(),maxAmount:rules.maxAmount.toString(),bids},(_,v)=>typeof v==='bigint'?v.toString():v),{mode:0o600});
execFileSync('python3',['scripts/proof-run.py','.local/smoke/private-input.json','.local/smoke/proof'],{stdio:'inherit'});
const bundle=JSON.parse(readFileSync('.local/smoke/proof/bundle.json','utf8'));
const result={...bundle.result,price:BigInt(bundle.result.price)};
const expected=buildPublicInputs(rulesHash,rules,bids,result);
if(JSON.stringify(expected)!==JSON.stringify(bundle.publicInputs))throw new Error('Public input layout mismatch');
await publicClient.request({method:'evm_setNextBlockTimestamp' as never,params:[Number(rules.closesAt)] as never});
await publicClient.request({method:'evm_mine' as never});
let rejected=false;
try{await publicClient.simulateContract({address:registry,abi:auctionAbi,functionName:'finalizeAuction',args:[auctionId,bundle.proof,{...result,price:result.price-1n}],account});}catch{rejected=true;}
if(!rejected)throw new Error('Wrong winning price accepted');
const receipt=await write('finalizeAuction',[auctionId,bundle.proof,result]);
const final=await publicClient.readContract({address:registry,abi:auctionAbi,functionName:'getAuction',args:[auctionId]});
const expectedPrice=amounts.reduce((a,b)=>a>b?a:b);
if(final.status!==1 || final.price!==expectedPrice || final.winnerIndex!==amounts.indexOf(expectedPrice))throw new Error('Unexpected auction result');
const summary={chainId:31337,registry,verifier,auctionId:auctionId.toString(),winner:final.winnerIdentity,price:final.price.toString(),finalizationGas:receipt.gasUsed.toString(),proofBytes:(bundle.proof.length-2)/2,provingSeconds:bundle.provingSeconds};
writeFileSync('.local/smoke/result.json',JSON.stringify(summary,null,2));console.log(summary);
