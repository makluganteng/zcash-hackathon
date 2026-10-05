/** Resumable testnet deployment. Signed transactions stay in a private local journal. */
import {readFileSync,writeFileSync,mkdirSync,renameSync,chmodSync,openSync,closeSync,fsyncSync,unlinkSync,existsSync} from 'node:fs';
import {pathToFileURL} from 'node:url';
import {dirname} from 'node:path';
import {setTimeout as delay} from 'node:timers/promises';
import {createPublicClient,createWalletClient,http,keccak256,encodeDeployData,getContractAddress,parseTransaction,recoverTransactionAddress,type Address,type Hex,type Chain,type Abi,type TransactionSerialized} from 'viem';
import {privateKeyToAccount} from 'viem/accounts';
import {foundry,baseSepolia} from 'viem/chains';

type DeploymentSettings={journalPath?:string;receiptTimeoutMs?:number};
type Artifact={abi:Abi;bytecode:{object:Hex;linkReferences?:Record<string,Record<string,{start:number;length:number}[]>>}};
type DeploymentEntry={artifactHash:Hex;dataHash:Hex;nonce:number;transactionHash:Hex;rawTransaction:TransactionSerialized;address?:Address;codeHash?:Hex;blockHash?:Hex;blockNumber?:string};
type DeploymentJournal={version:1;chainId:31337|84532;deployer:Address;sourceHash:Hex;artifacts:Record<string,Hex>;entries:Record<string,DeploymentEntry>};
const LOCAL_KEY='0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80';
export async function deployLocal(rpc='http://127.0.0.1:8545',manifestPath='.data/local-deployment.json',settings:DeploymentSettings={}){return deploy({rpc,chainId:31337,manifestPath,...settings});}
export async function deployBaseSepolia(rpc:string,privateKey:Hex,settings:DeploymentSettings={}){return deploy({rpc,chainId:84532,privateKey,...settings});}

function privateWrite(path:string,value:unknown){
 const temporary=`${path}.${process.pid}.tmp`;
 writeFileSync(temporary,JSON.stringify(value,null,2),{mode:0o600});chmodSync(temporary,0o600);
 const descriptor=openSync(temporary,'r');try{fsyncSync(descriptor);}finally{closeSync(descriptor);}
 renameSync(temporary,path);chmodSync(path,0o600);
}
function deploymentLock(path:string){
 try { const fd=openSync(path,'wx',0o600);writeFileSync(fd,String(process.pid));closeSync(fd); }
 catch(error){
  if((error as NodeJS.ErrnoException).code!=='EEXIST')throw error;
  const owner=Number(readFileSync(path,'utf8'));
  if(!Number.isSafeInteger(owner)||owner<=0)throw new Error('Deployment lock is invalid; inspect it before retrying');
  try{process.kill(owner,0);}catch(check){
   if((check as NodeJS.ErrnoException).code==='ESRCH'){unlinkSync(path);return deploymentLock(path);}
   throw new Error('Cannot determine whether another deployment is running');
  }
  throw new Error('Another deployment owns this journal; wait for it to finish');
 }
 return ()=>unlinkSync(path);
}
async function deploy(options:{rpc:string;chainId:31337|84532;privateKey?:Hex;manifestPath?:string}&DeploymentSettings){
 const {rpc,chainId}=options;const chain:Chain=chainId===31337?foundry:baseSepolia;
 const client=createPublicClient({chain,transport:http(rpc)});
 if(await client.getChainId()!==chainId)throw new Error('RPC chain differs from explicitly selected test network');
 if(chainId===84532&&!options.privateKey)throw new Error('Base Sepolia requires an explicit funded deployer key');
 const account=privateKeyToAccount(options.privateKey??LOCAL_KEY);
 const wallet=createWalletClient({chain,transport:http(rpc),account});
 const manifestPath=options.manifestPath??'.data/base-sepolia-deployment.json';
 const journalPath=options.journalPath??manifestPath.replace(/\.json$/, '')+'.journal.json';
 if(journalPath===manifestPath)throw new Error('Private journal must not overwrite the public manifest');
 if(chainId===84532&&existsSync(manifestPath)&&!existsSync(journalPath))throw new Error('An existing public deployment manifest has no recovery journal; refusing duplicate deployment');
 mkdirSync(dirname(journalPath),{recursive:true});
 const unlock=deploymentLock(`${journalPath}.lock`);
 try {
  // Read every dependency before spending, so a changed source/build cannot partly resume.
  const artifacts=new Map<string,Artifact>();const artifactHashes:Record<string,Hex>={};
  function load(file:string,name:string){
   const key=`${file}:${name}`;if(artifacts.has(key))return;
   const raw=readFileSync(`contracts/out/${file}/${name}.json`);const artifact=JSON.parse(raw.toString()) as Artifact;
   artifacts.set(key,artifact);artifactHashes[key]=keccak256(`0x${raw.toString('hex')}`);
   for(const[source,libraries]of Object.entries(artifact.bytecode.linkReferences??{}))for(const library of Object.keys(libraries))load(source.split('/').pop()!,library);
  }
  load('AuctionVerifier.sol','HonkVerifier');load('PrivateAuction.sol','PrivateAuction');
  const sourceHash=keccak256(`0x${Buffer.concat(['circuits/auction/src/main.nr','contracts/src/AuctionVerifier.sol','contracts/src/PrivateAuction.sol'].map(p=>readFileSync(p))).toString('hex')}`);
  const journal:DeploymentJournal=existsSync(journalPath)?JSON.parse(readFileSync(journalPath,'utf8')):{version:1,chainId,deployer:account.address,sourceHash,artifacts:artifactHashes,entries:{}};
  if(journal.version!==1||journal.chainId!==chainId||journal.deployer.toLowerCase()!==account.address.toLowerCase()||journal.sourceHash!==sourceHash||JSON.stringify(journal.artifacts)!==JSON.stringify(artifactHashes))throw new Error('Deployment journal differs in chain, deployer, source, or build artifacts; refusing reuse');
  privateWrite(journalPath,journal);
  const deployed=new Map<string,Address>();
  async function deployContract(file:string,name:string,args:readonly unknown[]=[]):Promise<Address>{
   const key=`${file}:${name}`;if(deployed.has(key))return deployed.get(key)!;
   const artifact=artifacts.get(key)!;let code=artifact.bytecode.object as string;
   for(const[source,libraries]of Object.entries(artifact.bytecode.linkReferences??{}))for(const[library,refs]of Object.entries(libraries)){
    const address=await deployContract(source.split('/').pop()!,library);
    for(const ref of refs){const start=2+ref.start*2;code=code.slice(0,start)+address.slice(2)+code.slice(start+ref.length*2);}
   }
   const data=encodeDeployData({abi:artifact.abi,bytecode:code as Hex,args});const dataHash=keccak256(data);
   let entry=journal.entries[key];
   if(!entry){
    const balance=await client.getBalance({address:account.address});if(balance===0n)throw new Error('Deployer has zero test ETH; no transaction was broadcast');
    const latestNonce=await client.getTransactionCount({address:account.address,blockTag:'latest'});
    const pendingNonce=await client.getTransactionCount({address:account.address,blockTag:'pending'});
    if(latestNonce!==pendingNonce)throw new Error('Deployer has an unrelated pending nonce; refusing a new deployment transaction');
    const request=await wallet.prepareTransactionRequest({account,data,nonce:pendingNonce});
    const required=request.gas*(request.maxFeePerGas??request.gasPrice??0n);
    if(required>balance)throw new Error('Insufficient test ETH for the estimated transaction fee; no transaction was broadcast');
    const raw=await wallet.signTransaction(request);
    entry={artifactHash:artifactHashes[key],dataHash,nonce:pendingNonce,transactionHash:keccak256(raw),rawTransaction:raw};
    journal.entries[key]=entry;
    // Durable journal precedes broadcast. Retry always uses these exact signed bytes and nonce.
    privateWrite(journalPath,journal);
   }
   const parsed=parseTransaction(entry.rawTransaction);
   if(entry.artifactHash!==artifactHashes[key]||entry.dataHash!==dataHash||keccak256(entry.rawTransaction)!==entry.transactionHash||parsed.chainId!==chainId||parsed.nonce!==entry.nonce||parsed.to||parsed.data?.toLowerCase()!==data.toLowerCase()||(await recoverTransactionAddress({serializedTransaction:entry.rawTransaction})).toLowerCase()!==account.address.toLowerCase())throw new Error(`Journal transaction does not match the expected deployment: ${key}`);
   let receipt;
   try{receipt=await client.getTransactionReceipt({hash:entry.transactionHash});}
   catch(error){if((error as Error).name!=='TransactionReceiptNotFoundError')throw new Error(`Cannot resolve recorded transaction for ${key}; retry with the same journal`);}
   if(!receipt){
    const latestNonce=await client.getTransactionCount({address:account.address,blockTag:'latest'});
    if(latestNonce>entry.nonce)throw new Error(`Recorded nonce was consumed but its receipt is unavailable for ${key}; refusing a replacement nonce`);
    if(await client.getBalance({address:account.address})===0n)throw new Error('Deployer has zero test ETH; recorded transaction remains pending without broadcast');
    try{await client.sendRawTransaction({serializedTransaction:entry.rawTransaction});}
    catch{/* Already known or ambiguous RPC response: only the recorded hash can resolve this step. */}
    try{receipt=await client.waitForTransactionReceipt({hash:entry.transactionHash,timeout:options.receiptTimeoutMs??120000,pollingInterval:500});}
    catch{throw new Error(`Deployment pending or RPC unavailable for ${key}; rerun with the same journal (no new nonce allocated)`);}
   }
   if(receipt.status!=='success'||!receipt.contractAddress)throw new Error(`Recorded deployment reverted for ${key}; refusing automatic retry at a new nonce`);
   const expected=getContractAddress({from:account.address,nonce:BigInt(entry.nonce)});
   // Some public RPC backends expose a receipt before their block index catches up.
   // Retry only a missing block; a present but different hash must fail immediately below.
   let canonicalBlock:Awaited<ReturnType<typeof client.getBlock>>|undefined;
   for(let attempt=0;attempt<6;attempt++){
    try{canonicalBlock=await client.getBlock({blockNumber:receipt.blockNumber});break;}
    catch(error){
     if((error as Error).name!=='BlockNotFoundError')throw new Error(`Cannot check the canonical deployment block for ${key}; retry with the same journal`);
     if(attempt===5)throw new Error(`Receipt block ${receipt.blockNumber} remains unavailable after 6 checks for ${key}; rerun with the same journal (no new nonce allocated)`);
     await delay(500*2**attempt);
    }
   }
   if(!canonicalBlock)throw new Error(`Canonical deployment block is unresolved for ${key}; retry with the same journal`);
   const transaction=await client.getTransaction({hash:entry.transactionHash});
   if(receipt.contractAddress.toLowerCase()!==expected.toLowerCase()||transaction.from.toLowerCase()!==account.address.toLowerCase()||transaction.to||transaction.input.toLowerCase()!==data.toLowerCase()||canonicalBlock.hash!==receipt.blockHash)throw new Error(`Deployment receipt is not canonical or does not match ${key}`);
   const runtime=await client.getCode({address:expected});
   if(!runtime||runtime==='0x')throw new Error(`Deployment runtime is missing for ${key}; refusing reuse`);
   const codeHash=keccak256(runtime);
   if((entry.address&&entry.address.toLowerCase()!==expected.toLowerCase())||(entry.codeHash&&entry.codeHash!==codeHash))throw new Error(`Deployment runtime changed for ${key}; refusing reuse`);
   Object.assign(entry,{address:expected,codeHash,blockHash:receipt.blockHash,blockNumber:receipt.blockNumber.toString()});privateWrite(journalPath,journal);
   deployed.set(key,expected);return expected;
  }
  const verifier=await deployContract('AuctionVerifier.sol','HonkVerifier');const registry=await deployContract('PrivateAuction.sol','PrivateAuction',[verifier]);
  const contracts=[...deployed].map(([name,address])=>({name,address,codeHash:journal.entries[name].codeHash!}));
  const manifest={chainId,deployer:account.address,rpcUrl:chainId===31337?rpc:'https://sepolia.base.org',registry,verifier,contracts,circuitSourceHash:keccak256(`0x${readFileSync('circuits/auction/src/main.nr').toString('hex')}`),sourceHash,artifacts:artifactHashes,noir:'1.0.0-beta.22',barretenberg:'5.0.0-nightly.20260522',localOnly:chainId===31337};
  mkdirSync(dirname(manifestPath),{recursive:true});writeFileSync(manifestPath,JSON.stringify(manifest,null,2));return manifest;
 } finally {unlock();}
}
if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href)console.log(await deployLocal(process.env.LOCAL_RPC_URL));
