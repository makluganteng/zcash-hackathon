"use client";
import { useEffect, useRef, useState, type FormEvent } from "react";
import Link from "next/link";
import { type BidReceipt, type BidSubmission, type ClaimChallenge, type PrivateInvoice, type PublicAuction, type PublicConfig } from "@/lib/api-types";
import { ciphertextDigest, DRAND, encryptBid, evaluatorKeyHash, randomNonce, timeForRound } from "@/lib/encryption";
import { accountForIdentity, createIdentity, exportIdentity, identityScope, importIdentity, loadIdentity, saveIdentity, signBidEnvelope, type LocalIdentity } from "@/lib/identity";
import { bidCommitment } from "@/lib/protocol";
import { api, ApiRequestError, dateTime, downloadJson, short, validatePrivateInvoice, zatoshis, zec } from "@/lib/ui-utils";
import { Arrow, AuctionArt, ErrorNotice, Loading, Phase } from "./ui";
function localBid<T extends { bidder: string }>(kind: string, scope: string, bidder: string): T | null {
  const keyed = window.localStorage.getItem(`sealed:${kind}:${scope}:${bidder.toLowerCase()}`);
  const legacy = window.localStorage.getItem(`sealed:${kind}:${scope}`);
  const value = keyed || legacy;
  if (!value) return null;
  const parsed = JSON.parse(value) as T;
  return parsed.bidder.toLowerCase() === bidder.toLowerCase() ? parsed : null;
}
function persistBid(kind: string, scope: string, value: {bidder: string}) {
  window.localStorage.setItem(`sealed:${kind}:${scope}:${value.bidder.toLowerCase()}`, JSON.stringify(value));
}
export function AuctionDetail({id}:{id:string}) {
  const [auction,setAuction]=useState<PublicAuction|null>(null),[config,setConfig]=useState<PublicConfig|null>(null),[error,setError]=useState(""),[busy,setBusy]=useState("");
  const [identity,setIdentity]=useState<LocalIdentity|null>(null),[backup,setBackup]=useState(false),[amount,setAmount]=useState(""),[receipt,setReceipt]=useState<BidReceipt|null>(null),[submission,setSubmission]=useState<BidSubmission|null>(null);
  const [invoice,setInvoice]=useState<PrivateInvoice|null>(null),[claimToken,setClaimToken]=useState(""),[copied,setCopied]=useState("");
  const [paymentSafe,setPaymentSafe]=useState(false),[now,setNow]=useState(0);
  const file=useRef<HTMLInputElement>(null);
  useEffect(()=>{const timer=setInterval(()=>setNow(Date.now()),1000);return()=>clearInterval(timer);},[]);
  useEffect(()=>{
    let active=true;
    const refresh=async()=>{
      try {
        const value=await api<{auction:PublicAuction;config:PublicConfig}>(`/api/auctions/${id}`);
        if(!active)return;
        setAuction(value.auction);setConfig(value.config);setNow(Date.now());
        const scope=identityScope(value.auction.chainId,value.auction.registry,id);
        const local=loadIdentity(scope);setIdentity(local);
        if(!local){setReceipt(null);setSubmission(null);return;}
        const saved=localBid<BidSubmission>("submission",scope,local.address);
        const savedReceipt=localBid<BidReceipt>("receipt",scope,local.address);
        setSubmission(saved);
        const commitment=saved?.commitment??savedReceipt?.commitment;
        if(commitment){
          try {
            const r=await api<BidReceipt>(`/api/auctions/${id}/bids/${commitment}`);
            if(!active||loadIdentity(scope)?.address.toLowerCase()!==local.address.toLowerCase())return;
            if(r.bidder.toLowerCase()!==local.address.toLowerCase()||r.commitment!==commitment)throw new Error("Receipt does not match the local signed bid.");
            setReceipt(r);persistBid("receipt",scope,r);
          }catch(e){if(e instanceof ApiRequestError&&e.status===404){if(active)setReceipt(null);}else throw e;}
        }else setReceipt(null);
      }catch(e){if(active){setError((e as Error).message);setPaymentSafe(false);}}
    };
    void refresh();const timer=setInterval(()=>void refresh(),15000);
    return()=>{active=false;clearInterval(timer);};
  },[id]);
  const invoicePayload=invoice?.payload;
  const invoiceId=invoicePayload?.id;
  useEffect(()=>{
    if(!invoiceId||!claimToken||!config||!identity)return;
    let active=true;
    const refresh=async()=>{
      setPaymentSafe(false);
      try {
        const [value,current]=await Promise.all([
          api<{invoice:PrivateInvoice}>(`/api/invoices/${invoiceId}`,{headers:{Authorization:`Bearer ${claimToken}`}}),
          api<{auction:PublicAuction}>(`/api/auctions/${id}`),
        ]);
        await validatePrivateInvoice(value.invoice,current.auction,config,identity.address,invoicePayload);
        if(!active)return;
        setInvoice(value.invoice);setAuction(current.auction);setPaymentSafe(true);
      }catch(e){if(active){setPaymentSafe(false);setError((e as Error).message);}}
    };
    const timer=setInterval(()=>void refresh(),12000);
    return()=>{active=false;clearInterval(timer);};
  },[invoiceId,invoicePayload,claimToken,config,identity,id]);
  if(!auction||!config)return <main id="main" className="page-content"><Link href="/" className="text-link">← Back to auctions</Link>{error?<ErrorNotice message={error}/>:<Loading/>}</main>;
  const scope=identityScope(auction.chainId,auction.registry,id);
  const open=auction.phase==="open"&&Date.parse(auction.closesAt)>now&&auction.bidCount<auction.capacity;
  const winner=identity&&auction.result?.sale&&identity.address.toLowerCase()===auction.result.winnerIdentity.toLowerCase();
  function newIdentity(){try{const i=createIdentity(scope);saveIdentity(i);setIdentity(i);setBackup(false);setReceipt(null);setSubmission(null);setInvoice(null);setClaimToken("");setPaymentSafe(false);setError("");}catch(e){setError((e as Error).message);}}
  async function restore(f:File){try{const i=importIdentity(await f.text(),scope);saveIdentity(i);setIdentity(i);setBackup(true);setReceipt(localBid<BidReceipt>("receipt",scope,i.address));setSubmission(localBid<BidSubmission>("submission",scope,i.address));setInvoice(null);setClaimToken("");setPaymentSafe(false);setError("");}catch(e){setError((e as Error).message);}}
  async function submit(event:FormEvent){event.preventDefault();if(!identity||!auction||!config?.evaluatorPublicKey)return;setError("");setBusy("Encrypting your bid locally…");try{
    if(submission||localBid<BidSubmission>("submission",scope,identity.address))throw new Error("A signed bid already exists. Retry that submission instead of creating another bid.");
    const value=zatoshis(amount);if(BigInt(value)>BigInt(auction.maxAmount))throw new Error("Bid exceeds the auction amount limit.");
    if(evaluatorKeyHash(config.evaluatorPublicKey)!==auction.evaluatorKeyHash||`0x${DRAND.chainHash}`!==auction.drandChainHash)throw new Error("The encryption configuration does not match the immutable auction rules.");
    const nonce=randomNonce(),commitment=bidCommitment(auction.rulesHash,identity.address,BigInt(value),nonce);
    const ciphertext=await encryptBid({version:1,chainId:auction.chainId,contract:auction.registry,auctionId:id,rulesHash:auction.rulesHash,bidder:identity.address,amount:value,nonce},config.evaluatorPublicKey,Number(auction.drandRound));
    const ciphertextHash=ciphertextDigest(ciphertext),envelope={auctionId:BigInt(id),rulesHash:auction.rulesHash,bidder:identity.address,commitment,ciphertextHash};
    const signed={bidder:identity.address,commitment,ciphertextHash,ciphertext,signature:await signBidEnvelope(identity,auction.chainId,auction.registry,envelope)};
    setSubmission(signed);persistBid("submission",scope,signed);setAmount("");setBusy("Registering your commitment…");
    const result=await api<BidReceipt>(`/api/auctions/${id}/bids`,{method:"POST",body:JSON.stringify(signed)});setReceipt(result);persistBid("receipt",scope,result);
  }catch(e){setError((e as Error).message);}finally{setBusy("");}}
  async function retrySubmission(){if(!submission)return;setBusy("Resubmitting the same encrypted bid…");setError("");try{const result=await api<BidReceipt>(`/api/auctions/${id}/bids`,{method:"POST",body:JSON.stringify(submission)});setReceipt(result);persistBid("receipt",scope,result);}catch(e){setError((e as Error).message);}finally{setBusy("");}}
  async function claim(){if(!identity||!auction||!config)return;setError("");setBusy("Verifying your winning identity…");try{
    const challenge=await api<ClaimChallenge>(`/api/auctions/${id}/claim/challenge`,{method:"POST",body:JSON.stringify({bidder:identity.address})});
    const expected=["Sealed Auctions winner claim v1",`Origin: ${window.location.origin}`,`Chain: ${auction.chainId}`,`Registry: ${auction.registry.toLowerCase()}`,`Auction: ${id}`,`Rules: ${auction.rulesHash}`,`Bidder: ${identity.address.toLowerCase()}`,`Challenge: ${challenge.challengeId}`];
    const lines=challenge.message.split("\n");if(!expected.every((line,i)=>lines[i]===line)||lines.length!==10||!/^Nonce: [0-9a-f]{64}$/.test(lines[8])||lines[9]!==`Expires: ${challenge.expiresAt}`||Date.parse(challenge.expiresAt)<=Date.now())throw new Error("Claim challenge does not match this auction or origin.");
    const signature=await accountForIdentity(identity).signMessage({message:challenge.message});const claimed=await api<{invoice:PrivateInvoice;token:string}>(`/api/auctions/${id}/claim`,{method:"POST",body:JSON.stringify({challengeId:challenge.challengeId,signature})});
    await validatePrivateInvoice(claimed.invoice,auction,config,identity.address);
    if(loadIdentity(scope)?.address.toLowerCase()!==identity.address.toLowerCase())throw new Error("Local identity changed during claim. Try again with the winning identity.");
    setInvoice(claimed.invoice);setClaimToken(claimed.token);setPaymentSafe(true);
  }catch(e){setError((e as Error).message);}finally{setBusy("");}}
  async function copy(label:string,value:string){if(!paymentSafe)return;try{await navigator.clipboard.writeText(value);setCopied(label);setTimeout(()=>setCopied(""),2000);}catch{setError("Clipboard is unavailable. Select and copy the value directly.");}}
  const canPay=Boolean(paymentSafe&&config.paymentReady&&invoice&&Date.parse(invoice.payload.expiresAt)>now&&invoice.status==="awaiting-payment");
  const safePaymentUri=invoice&&canPay?`zcash:${invoice.payload.destination}?amount=${zec(invoice.payload.amount)}&memo=${btoa(invoice.payload.reference).replace(/\+/g,"-").replace(/\//g,"_").replace(/=+$/,"")}`:"";
  return <main id="main" className="page-content"><div className="breadcrumb"><Link href="/#auctions">The auction floor</Link><span>/</span><span>AUCTION {id.padStart(3,"0")}</span></div><div className="detail-layout"><div className="detail-main"><AuctionArt large/><div className="detail-heading"><span className="eyebrow muted">{auction.category} / FIRST-PRICE AUCTION</span><h1>{auction.title}</h1><p className="description">{auction.description}</p></div><section className="rules-panel"><div className="section-heading"><h3>Set in stone.</h3><span className="mono muted">IMMUTABLE RULES</span></div><dl className="rules-grid"><div><dt>Reserve price</dt><dd>{zec(auction.reserve)} ZEC</dd></div><div><dt>Bidding closes</dt><dd>{dateTime(auction.closesAt)}</dd></div><div><dt>Accepted bids</dt><dd>{auction.bidCount} / {auction.capacity}</dd></div><div><dt>Tie-break</dt><dd>First registered bid</dd></div><div><dt>Time lock opens</dt><dd>{dateTime(new Date(timeForRound(Number(auction.drandRound))*1000).toISOString())}</dd></div><div><dt>Payment window</dt><dd>{auction.paymentWindow/60} minutes</dd></div></dl><details className="technical-details"><summary>Inspect registry evidence</summary><dl><dt>Rules hash</dt><dd className="hash">{auction.rulesHash}</dd><dt>Registry</dt><dd className="hash">{auction.registry}</dd><dt>Finalized snapshot</dt><dd className="hash">Block {auction.snapshotBlock} / {auction.snapshotHash}</dd><dt>Destination commitment</dt><dd className="hash">{auction.destinationHash}</dd></dl><Link className="text-link" href={`/verify?auction=${id}`}>Independent verification <Arrow diagonal/></Link></details></section></div>
    <aside className="bid-panel"><div className="panel-top"><Phase phase={auction.phase}/><span className="mono muted">TESTNET</span></div>{auction.result?<><span className="eyebrow muted">{auction.result.sale?"VERIFIED WINNING PRICE":"VERIFIED OUTCOME"}</span><div className="big-price">{auction.result.sale?<>{zec(auction.result.price)}<span>ZEC</span></>:"No sale"}</div><p className="muted">{auction.result.sale?`Winning identity ${short(auction.result.winnerIdentity)}. Result recorded by the registry verifier.`:"No registered bid met the reserve."}</p><Link href={`/verify?auction=${id}`} className="text-link">Inspect proof evidence <Arrow diagonal/></Link></>:<><span className="eyebrow muted">RESERVE PRICE</span><div className="big-price">{zec(auction.reserve)}<span>ZEC</span></div><p className="muted">The highest eligible bid wins and pays its own bid. No running bid amounts are published.</p></>}
    <div className="panel-divider"/>{error&&<ErrorNotice message={error}/>}<input ref={file} hidden type="file" accept="application/json,.json" aria-label="Import identity backup" onChange={e=>{const f=e.target.files?.[0];if(f)void restore(f);e.target.value="";}}/>
    {!identity?<div className="identity-setup"><span className="eyebrow">YOUR PRIVATE IDENTITY</span><h3>A fresh key.<br/>Just for this auction.</h3><p>Your signing key stays in this browser. Save a backup so you can return to claim a winning bid.</p><button className="button button-primary full" onClick={newIdentity}>Create local identity <Arrow/></button><button className="button button-quiet full" onClick={()=>file.current?.click()}>Restore from a backup</button></div>:<><div className="identity-row"><div><span className="mono muted">LOCAL IDENTITY</span><strong className="mono">{short(identity.address,8)}</strong></div><span className="identity-dot"/></div><div className="inline-actions"><button onClick={()=>{downloadJson(`sealed-identity-${id}.json`,exportIdentity(identity));setBackup(true);}}>Export backup ↓</button><button onClick={()=>file.current?.click()}>Restore identity</button></div><p className="tiny muted">The backup contains your unencrypted signing key. Keep it private; never upload or share it.</p>
    {receipt?<div className="receipt"><span className="eyebrow">{receipt.status==="accepted"?"BID ACCEPTED":receipt.status==="rejected"?"BID NOT ACCEPTED":"REGISTRATION PENDING"}</span><h3>{receipt.status==="accepted"?"Your bid is on the record.":receipt.status==="rejected"?"Registration was rejected.":"Waiting for chain finality."}</h3><p>{receipt.status==="accepted"?`Registered at index ${receipt.insertionIndex}. This commitment is included in the auction.`:receipt.status==="rejected"?"The registry rejected this transaction. It is not an accepted bid.":"Submission is not yet accepted. This receipt updates as the registry reaches finality."}</p><p className="hash">{short(receipt.commitment,12)}</p><button className="button button-outline full" onClick={()=>downloadJson(`sealed-receipt-${id}.json`,{receipt,submission})}>Download receipt ↓</button></div>:submission?<div className="receipt"><span className="eyebrow">SIGNED BID SAVED</span><h3>Your submission needs a receipt.</h3><p>Your exact encrypted bid is preserved in this browser. Check its inclusion or retry the same signed envelope; do not create a replacement.</p><button className="button button-primary full" disabled={!!busy||!open} onClick={()=>void retrySubmission()}>{busy||"Retry saved submission"}</button><button className="button button-outline full" onClick={()=>downloadJson(`sealed-submission-${id}.json`,submission)}>Download signed envelope ↓</button>{!open&&<p className="tiny muted">Bidding is closed. A new registration is no longer possible; saved receipts will continue to check inclusion.</p>}</div>:open?<form onSubmit={submit} className="bid-form"><label htmlFor="bid-amount">Your sealed bid</label><div className="amount-input"><input id="bid-amount" inputMode="decimal" placeholder="0.00" value={amount} onChange={e=>setAmount(e.target.value)} required disabled={!!busy}/><span>ZEC</span></div><p className="tiny muted">Up to 8 decimals. Testnet funds only. One bid per identity; submitted bids cannot be edited.</p><label className="checkbox-row"><input type="checkbox" checked={backup} onChange={e=>setBackup(e.target.checked)}/>I saved my private identity backup.</label><button className="button button-primary full" disabled={!backup||!!busy||!amount} type="submit">{busy||"Encrypt & submit bid"}{!busy&&<Arrow/>}</button>{submission&&!receipt&&error&&<button type="button" className="button button-outline full" disabled={!!busy} onClick={()=>void retrySubmission()}>Retry the same encrypted submission</button>}<p className="tiny muted">Bids are encrypted here before upload. The evaluator can read them after the deadline.</p></form>:!auction.result?<div className="notice">{auction.phase==="blocked"?"Opening is blocked. A registered bid could not be processed. No bid will be silently excluded.":auction.phase==="expired"?"The finalization window ended without a verified result.":"Bidding has closed. The result appears only after successful contract verification."}</div>:null}
    {winner&&!invoice&&(auction.result&&Date.parse(auction.result.paymentDeadline)>now?<button className="button button-primary full claim-button" disabled={!!busy} onClick={()=>void claim()}>{busy||"Claim your private invoice"}<Arrow/></button>:<div className="notice">The payment window has expired. Contact the seller for manual review.</div>)}
    {identity&&auction.result?.sale&&!winner&&<div className="notice">This local identity is not the verified winner. Restore the winning identity backup to claim its invoice.</div>}</>}
    {invoice&&<section className="invoice"><span className="eyebrow">PRIVATE PAYMENT INVOICE</span><h3>{zec(invoice.payload.amount)} ZEC</h3><div className={`notice ${invoice.status==="receiver-confirmed"?"success":""}`}>{invoice.status.replace(/-/g," ")} · {invoice.confirmations} confirmations</div><p className="tiny">{paymentSafe?"Invoice signature, destination commitment, and amount match the displayed verified auction rules.":"Payment actions are paused until fresh invoice and registry checks succeed."}</p>{paymentSafe&&[["Address",invoice.payload.destination],["Amount",zec(invoice.payload.amount)],["Memo",invoice.payload.reference]].map(([label,value])=><div className="invoice-field" key={label}><span className="mono muted">{label}</span><code>{value}</code><button disabled={!canPay} onClick={()=>void copy(label,value)}>{copied===label?"Copied":"Copy"}</button></div>)}<p className="tiny muted">Pay before {dateTime(invoice.payload.expiresAt)}. Include the exact amount and memo. Payments settle directly to the seller.</p>{canPay?<a href={safePaymentUri} className="button button-primary full">Open Zcash wallet <Arrow diagonal/></a>:null}<button className="button button-outline full" disabled={!paymentSafe} onClick={()=>downloadJson(`sealed-invoice-${id}.json`,invoice)}>Download private invoice ↓</button>{!config.paymentReady&&<div className="notice">Receiver scanning is not configured. Payment actions are disabled until it is ready.</div>}<p className="tiny muted">Keep this invoice private. Payment status comes from the seller’s receiver scanner, separately from the auction proof.</p></section>}
    <div className="panel-footer mono">{auction.chainId===31337?"LOCAL EVM EVIDENCE":"BASE SEPOLIA EVIDENCE"} · SHIELDED ZEC TESTNET</div></aside></div></main>;
}
