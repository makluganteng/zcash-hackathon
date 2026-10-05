import type { Metadata } from "next";
import { Footer, Nav } from "@/components/ui";
import "./globals.css";
export const metadata: Metadata = { title:"Sealed — Private auctions. Provable outcomes.", description:"Sealed bids, independently verifiable winners, and shielded Zcash testnet settlement." };
export default function RootLayout({children}:{children:React.ReactNode}) {return <html lang="en"><body><a href="#main" className="skip-link">Skip to content</a><div className="site-shell"><Nav/>{children}<Footer/></div></body></html>;}
