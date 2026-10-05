import test from "node:test";
import assert from "node:assert/strict";
import { classifyPayment, receivedNotes, type NoteObservation } from "../../src/server/payments";
import { invoiceMessage, type InvoicePayload } from "../../src/lib/api-types";
import { privateKeyToAccount } from "viem/accounts";
import { verifyMessage } from "viem";
import { paymentUri } from "../../src/server/claims";
const hash=`0x${"01".repeat(32)}` as const;
const invoice:InvoicePayload={version:1,id:"da609490-bf9e-4d6c-8ef0-71183c82759e",auctionId:"1",chainId:84532,registry:"0x1111111111111111111111111111111111111111",rulesHash:hash,resultBlockHash:hash,resultBlockNumber:"4",winnerIdentity:"0x2222222222222222222222222222222222222222",destination:"ztestsapling1-test-fixture-not-payable",destinationHash:hash,network:"testnet",amount:"500000000",reference:"sealed:unit-test",expiresAt:"2026-10-05T12:00:00.000Z"};
const now=Date.parse("2026-10-05T11:00:00.000Z");
const note:NoteObservation={txid:"aa".repeat(32),outputId:"sapling:1",amount:"500000000",confirmations:3,blockTime:now/1000,active:true};
const transaction={txid:note.txid,confirmations:3,status:"mined",blockhash:"bb".repeat(32),blocktime:now/1000,outputs:[{pool:"sapling",output:1,account_uuid:"seller-account",address:invoice.destination,outgoing:false,walletInternal:false,valueZat:500000000,memoStr:invoice.reference}]};
test("a receiver-observed exact shielded note confirms; a txid alone cannot",()=>{
  assert.equal(classifyPayment(invoice,receivedNotes(transaction,invoice,"seller-account"),3,now).status,"receiver-confirmed");
  assert.throws(()=>receivedNotes({txid:note.txid},invoice,"seller-account"));
});
test("wrong destination, memo, account and outgoing/internal outputs cannot pay",()=>{
  for(const change of [{address:"another-address"},{memoStr:"another-invoice"},{account_uuid:"other-account"},{outgoing:true},{walletInternal:true},{pool:"transparent"}]) {
    assert.equal(receivedNotes({...transaction,outputs:[{...transaction.outputs[0],...change}]},invoice,"seller-account").length,0);
  }
});
test("two distinct notes in one transaction remain separate and require review",()=>{
  const notes=receivedNotes({...transaction,outputs:[transaction.outputs[0],{...transaction.outputs[0],output:2}]},invoice,"seller-account");
  assert.deepEqual(notes.map(n=>n.outputId),["sapling:1","sapling:2"]);
  assert.equal(classifyPayment(invoice,notes,3,now).status,"needs-review");
});
test("unified receiver aliases match only explicitly resolved shielded destinations",()=>{
  const ua={...invoice,destination:"utest1-test-only-unified-fixture"};
  assert.equal(receivedNotes(transaction,ua,"seller-account").length,0);
  assert.equal(receivedNotes(transaction,ua,"seller-account",[ua.destination,invoice.destination]).length,1);
});
test("partial and excess amounts never count as normal payment",()=>{
  for(const amount of ["499999999","500000001"]) assert.equal(classifyPayment(invoice,[{...note,amount}],3,now).status,"needs-review");
});
test("confirmation decreases and disappearance revoke confirmation",()=>{
  assert.equal(classifyPayment(invoice,[{...note,confirmations:1}],3,now).status,"confirming");
  assert.equal(classifyPayment(invoice,[{...note,confirmations:0,blockTime:null}],3,now).status,"detected");
  assert.equal(classifyPayment(invoice,[{...note,active:false}],3,now).status,"awaiting-payment");
});
test("late and ambiguously timed payments require review; unpaid invoices expire",()=>{
  const after=Date.parse(invoice.expiresAt)+1000;
  assert.equal(classifyPayment(invoice,[{...note,blockTime:after/1000}],3,after).status,"needs-review");
  assert.equal(classifyPayment(invoice,[{...note,confirmations:0,blockTime:null}],3,after).status,"needs-review");
  assert.equal(classifyPayment(invoice,[{...note,blockTime:null}],3,now).status,"needs-review");
  assert.equal(classifyPayment(invoice,[],3,after).status,"expired");
});
test("malformed amount precision or missing note index fails closed",()=>{
  assert.throws(()=>receivedNotes({...transaction,outputs:[{...transaction.outputs[0],valueZat:Number.MAX_SAFE_INTEGER+1}]},invoice,"seller-account"));
  assert.throws(()=>receivedNotes({...transaction,outputs:[{...transaction.outputs[0],output:undefined}]},invoice,"seller-account"));
});
test("invoice signature binds destination, result block, amount, network and expiry",async()=>{
  const account=privateKeyToAccount(`0x${"31".repeat(32)}`);const signature=await account.signMessage({message:invoiceMessage(invoice)});
  assert.equal(await verifyMessage({address:account.address,message:invoiceMessage(invoice),signature}),true);
  for(const change of [{destination:"other"},{amount:"1"},{resultBlockNumber:"5"},{expiresAt:"2026-10-06T12:00:00.000Z"}]) assert.equal(await verifyMessage({address:account.address,message:invoiceMessage({...invoice,...change}),signature}),false);
});
test("ZIP321 preserves exact integer amounts and memo bytes",()=>{
  const uri=paymentUri({...invoice,amount:"100000001"});
  assert.match(uri,/amount=1\.00000001/);
  const memo=new URLSearchParams(uri.split("?")[1]).get("memo")!;
  assert.equal(Buffer.from(memo,"base64url").toString(),invoice.reference);
});
