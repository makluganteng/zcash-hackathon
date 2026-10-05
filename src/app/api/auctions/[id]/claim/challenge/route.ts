import { createChallenge } from "@/server/claims";
import { endpoint,auctionId,jsonBody } from "@/server/http";
export const dynamic="force-dynamic";
export async function POST(request:Request,context:{params:Promise<{id:string}>}){return endpoint(async()=>createChallenge(auctionId((await context.params).id),await jsonBody(request,1000)));}
