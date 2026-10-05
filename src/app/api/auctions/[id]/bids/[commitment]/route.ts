import { getBidReceipt } from "@/server/auctions";
import { endpoint,auctionId } from "@/server/http";
export const dynamic="force-dynamic";
export async function GET(_request:Request,context:{params:Promise<{id:string;commitment:string}>}){return endpoint(async()=>{const p=await context.params;return getBidReceipt(auctionId(p.id),p.commitment);});}
