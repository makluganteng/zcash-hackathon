import { publicConfiguration } from "@/server/config";
import { endpoint } from "@/server/http";
export const dynamic="force-dynamic";
export async function GET(){return endpoint(publicConfiguration);}
