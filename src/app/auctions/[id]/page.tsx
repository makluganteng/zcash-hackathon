import { AuctionDetail } from "@/components/auction-detail";
export default async function AuctionPage({params}:{params:Promise<{id:string}>}) {const {id}=await params;return <AuctionDetail id={id}/>;}
