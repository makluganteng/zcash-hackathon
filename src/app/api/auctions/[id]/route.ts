import { getAuction } from "@/server/auctions";
import { publicConfiguration } from "@/server/config";
import { endpoint,auctionId } from "@/server/http";
export const dynamic="force-dynamic";
export async function GET(_request:Request,context:{params:Promise<{id:string}>}){return endpoint(async()=>({auction:await getAuction(auctionId((await context.params).id)),config:await publicConfiguration()}));}
