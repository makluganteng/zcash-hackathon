import { resupplyCiphertext } from "@/server/auctions";
import { endpoint,auctionId,jsonBody } from "@/server/http";
export const dynamic="force-dynamic";
export async function POST(request:Request,context:{params:Promise<{id:string}>}){return endpoint(async()=>resupplyCiphertext(auctionId((await context.params).id),await jsonBody(request)));}
