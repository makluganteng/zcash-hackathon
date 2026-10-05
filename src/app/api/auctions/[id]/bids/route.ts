import { submitBid } from "@/server/auctions";
import { endpoint,auctionId,jsonBody } from "@/server/http";
export const dynamic="force-dynamic";
export const maxDuration=60;
export async function POST(request:Request,context:{params:Promise<{id:string}>}){return endpoint(async()=>submitBid(auctionId((await context.params).id),await jsonBody(request)));}
