import { getInvoice } from "@/server/claims";
import { endpoint } from "@/server/http";
export const dynamic="force-dynamic";
export async function GET(request:Request,context:{params:Promise<{id:string}>}){return endpoint(async()=>getInvoice((await context.params).id,request.headers.get("authorization")));}
