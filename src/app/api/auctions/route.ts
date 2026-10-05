import { listAuctions, createAuction } from "@/server/auctions";
import { endpoint,jsonBody,requireOperator } from "@/server/http";
export const dynamic="force-dynamic";
export const maxDuration=60;
export async function GET(){return endpoint(listAuctions);}
export async function POST(request:Request){return endpoint(async()=>{requireOperator(request);return createAuction(await jsonBody(request,10000));});}
