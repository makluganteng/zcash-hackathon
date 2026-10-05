import test from "node:test";
import assert from "node:assert/strict";
import { keccak256, toHex, type Address, type Hex } from "viem";
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";
import { invoiceMessage, type InvoicePayload, type PrivateInvoice, type PublicAuction, type PublicConfig } from "../../src/lib/api-types";
import { validatePrivateInvoice, zatoshis, zec } from "../../src/lib/ui-utils";
const signer=privateKeyToAccount(generatePrivateKey());
const hash=`0x${"11".repeat(32)}` as Hex;
const bidder="0x2222222222222222222222222222222222222222" as Address;
const registry="0x3333333333333333333333333333333333333333" as Address;
const destination="utest1unit-test-destination";
const payload:InvoicePayload={version:1,id:"00000000-0000-4000-8000-000000000001",auctionId:"1",chainId:84532,registry,rulesHash:hash,resultBlockHash:hash,resultBlockNumber:"10",winnerIdentity:bidder,destination,destinationHash:keccak256(toHex(destination)),network:"testnet",amount:"500000000",reference:`sealed:${"ab".repeat(24)}`,expiresAt:"2026-10-05T12:00:00.000Z"};
const auction:PublicAuction={id:"1",title:"Auction",description:"Test auction",category:"Test",phase:"verified-sale",chainId:84532,registry,rulesHash:hash,reserve:"100000000",maxAmount:"1000000000",closesAt:"2026-10-05T09:00:00.000Z",finalizationWindow:86400,paymentWindow:3600,seller:registry,destinationHash:payload.destinationHash,evaluatorKeyHash:hash,drandChainHash:hash,drandRound:"1",bidCount:3,capacity:16,snapshotBlock:"10",snapshotHash:hash,result:{sale:true,winnerIndex:1,winnerIdentity:bidder,price:payload.amount,finalizedAt:"2026-10-05T11:00:00.000Z",paymentDeadline:payload.expiresAt},proofAvailable:true};
const config:PublicConfig={ready:true,missing:[],chainId:84532,registry,evaluatorPublicKey:null,invoiceSigner:signer.address,zcashNetwork:"testnet",finality:"finalized",paymentConfirmations:3,paymentReady:true};
async function invoice(p=payload):Promise<PrivateInvoice>{return{payload:p,signature:await signer.signMessage({message:invoiceMessage(p)}),signer:signer.address,paymentUri:"zcash:ignored-untrusted-uri",status:"awaiting-payment",confirmations:0};}
test("valid invoice checks against auction rules and pinned signer",async()=>{await validatePrivateInvoice(await invoice(),auction,config,bidder);});
test("claim and poll reject substituted fields, signer, stale result, and changed reference",async()=>{
  const original=await invoice();
  for(const changed of [{amount:"500000001"},{destination:"utest1attacker"},{reference:`sealed:${"cd".repeat(24)}`},{auctionId:"2"}])await assert.rejects(validatePrivateInvoice({...original,payload:{...payload,...changed}},auction,config,bidder));
  await assert.rejects(validatePrivateInvoice({...original,signer:registry},auction,config,bidder));
  await assert.rejects(validatePrivateInvoice(original,{...auction,phase:"expired"},config,bidder));
  const reissued=await invoice({...payload,reference:`sealed:${"cd".repeat(24)}`});
  await assert.rejects(validatePrivateInvoice(reissued,auction,config,bidder,payload),/changed after issuance/);
});
test("ZEC form conversions preserve exact zatoshis and reject unsupported numeric forms",()=>{
  assert.equal(zatoshis("0.00000001"),"1");assert.equal(zec("100000001"),"1.00000001");
  assert.equal(zatoshis(zec("2100000000000000")),"2100000000000000");
  for(const value of ["0","-1","1e8","1.000000001","00.1","21000000.00000001"])assert.throws(()=>zatoshis(value));
});
