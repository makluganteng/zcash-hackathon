/** Independent observer verification: ignores server-supplied registry claims. */
import {readFileSync} from 'node:fs';
import {createPublicClient,http,keccak256,type Address,type Hex,parseAbi} from 'viem';
import {auctionAbi} from '../src/lib/contract';
const [manifestPath,bundlePath,id]=process.argv.slice(2);
if(!manifestPath||!bundlePath||!id)throw new Error('Usage: tsx scripts/proof-verify.ts reviewed-deployment.json bundle.json auction-id');
const manifest=JSON.parse(readFileSync(manifestPath,'utf8'));
const bundle=JSON.parse(readFileSync(bundlePath,'utf8'));
const client=createPublicClient({transport:http(process.env.VERIFY_RPC_URL??manifest.rpcUrl)});
if(await client.getChainId()!==manifest.chainId)throw new Error('Wrong chain');
for(const c of manifest.contracts){const code=await client.getCode({address:c.address});if(!code||keccak256(code)!==c.codeHash)throw new Error(`Unexpected runtime code: ${c.name}`);}
const registry=manifest.registry as Address;const auctionId=BigInt(id);
const verifier=await client.readContract({address:registry,abi:auctionAbi,functionName:'verifier'});
if(verifier.toLowerCase()!==manifest.verifier.toLowerCase())throw new Error('Wrong immutable verifier');
// Local fixtures use latest explicitly; public networks always use the finalized tag.
const block=await client.getBlock({blockTag:manifest.localOnly && manifest.chainId===31337?'latest':'finalized'});
const auction=await client.readContract({address:registry,abi:auctionAbi,functionName:'getAuction',args:[auctionId],blockNumber:block.number});
if(auction.status!==1 && auction.status!==2)throw new Error('No finalized verified result');
const result={sale:auction.status===1,winnerIndex:auction.winnerIndex,winnerIdentity:auction.winnerIdentity,price:auction.price};
const canonical=await client.readContract({address:registry,abi:auctionAbi,functionName:'publicInputs',args:[auctionId,result],blockNumber:block.number});
if(JSON.stringify(canonical).toLowerCase()!==JSON.stringify(bundle.publicInputs).toLowerCase())throw new Error('Proof does not match complete canonical registry/result');
const valid=await client.readContract({address:verifier,abi:parseAbi(['function verify(bytes proof,bytes32[] publicInputs) view returns(bool)']),functionName:'verify',args:[bundle.proof as Hex,[...canonical]],blockNumber:block.number});
if(!valid)throw new Error('Cryptographic proof invalid');
console.log(JSON.stringify({verified:true,chainId:manifest.chainId,registry,auctionId:id,blockNumber:block.number.toString(),blockHash:block.hash,winner:auction.winnerIdentity,price:auction.price.toString(),count:auction.count},null,2));
