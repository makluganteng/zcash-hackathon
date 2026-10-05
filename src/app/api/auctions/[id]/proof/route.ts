import { getAuction } from "@/server/auctions";
import { db } from "@/server/db";
import { assert } from "@/server/errors";
import { endpoint,auctionId } from "@/server/http";
import { chainClients } from "@/server/chain";
import { auctionAbi } from "@/lib/contract";
export const dynamic="force-dynamic";
export async function GET(_request:Request,context:{params:Promise<{id:string}>}){return endpoint(async()=>{
 const id=auctionId((await context.params).id);const auction=await getAuction(id);
 assert(auction.result,409,"NO_VERIFIED_RESULT","The auction has no finalized verified result.");
 const row=(await db().query("SELECT proof_bundle FROM auctions WHERE id=$1",[id])).rows[0];
 assert(row?.proof_bundle,404,"PROOF_UNAVAILABLE","Proof artifact has not been published by the worker.");
 assert(row.proof_bundle.rulesHash===auction.rulesHash && row.proof_bundle.result.price===auction.result.price && row.proof_bundle.result.winnerIdentity.toLowerCase()===auction.result.winnerIdentity.toLowerCase(),409,"STALE_PROOF","Proof artifact does not match the canonical result.");
 const {publicClient,address,chain}=chainClients();
 const inputs=await publicClient.readContract({address,abi:auctionAbi,functionName:"publicInputs",args:[BigInt(id),{sale:auction.result.sale,winnerIndex:auction.result.winnerIndex,winnerIdentity:auction.result.winnerIdentity,price:BigInt(auction.result.price)}],blockNumber:BigInt(auction.snapshotBlock)});
 assert(row.proof_bundle.chainId===chain.id && row.proof_bundle.registry.toLowerCase()===address.toLowerCase() && row.proof_bundle.auctionId===id && JSON.stringify(inputs)===JSON.stringify(row.proof_bundle.publicInputs),409,"STALE_PROOF","Proof inputs do not match the complete canonical registry.");
 return row.proof_bundle;
});}
