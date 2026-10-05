import { z } from "zod";
import type { InvoicePayload, PaymentStatus } from "../lib/api-types";
import { configuration, secret } from "./config";
import { db, transaction } from "./db";
import { assert } from "./errors";
import { invoiceCanonical } from "./claims";

import { viewedTransactionSchema } from "./viewed-transaction";
import { readDevtoolSnapshot } from "./devtool-scanner";
export { viewedTransactionSchema } from "./viewed-transaction";

export type NoteObservation = { txid:string; outputId:string; amount:string; confirmations:number; blockTime:number|null; active:boolean };
export type ReceiverMatch = string | { address: string; pool: "sapling" | "orchard" | "ironwood" };
export function receivedNotes(raw:unknown, invoice:InvoicePayload, account:string, receiverAddresses:readonly ReceiverMatch[]=[invoice.destination]):NoteObservation[] {
  const tx = viewedTransactionSchema.parse(raw);
  return tx.outputs.flatMap(output => {
    const receiverMatches = receiverAddresses.some(receiver => typeof receiver === "string" ? receiver === output.address : receiver.address === output.address && receiver.pool === output.pool);
    if (output.pool === "transparent" || output.outgoing !== false || output.walletInternal || output.account_uuid !== account || !output.address || !receiverMatches || output.memoStr !== invoice.reference) return [];
    const index = output.pool === "sapling" ? output.output : output.action;
    assert(index !== undefined, 503, "SCANNER_SCHEMA", "A received note is missing its output identity.");
    return [{txid:tx.txid,outputId:`${output.pool}:${index}`,amount:String(output.valueZat),confirmations:tx.confirmations,blockTime:tx.blocktime ?? null,active:tx.confirmations >= 0 && tx.status !== "expired"}];
  });
}
export function classifyPayment(invoice:InvoicePayload, notes:NoteObservation[], required:number, now=Date.now()):{status:PaymentStatus;confirmations:number} {
  const active = notes.filter(note=>note.active);
  if (active.length === 0) return {status:Date.parse(invoice.expiresAt)<=now?"expired":"awaiting-payment",confirmations:0};
  if (active.length !== 1 || active[0].amount !== invoice.amount) return {status:"needs-review",confirmations:0};
  const note=active[0];
  if (note.blockTime !== null && note.blockTime*1000 >= Date.parse(invoice.expiresAt)) return {status:"needs-review",confirmations:note.confirmations};
  if (note.blockTime === null && Date.parse(invoice.expiresAt)<=now) return {status:"needs-review",confirmations:note.confirmations};
  if (note.confirmations === 0) return {status:"detected",confirmations:0};
  if (note.blockTime === null) return {status:"needs-review",confirmations:note.confirmations};
  return {status:note.confirmations>=required?"receiver-confirmed":"confirming",confirmations:note.confirmations};
}
async function rpc(url:string, method:string, params:unknown[], authorization?:string):Promise<unknown> {
  const response = await fetch(url,{method:"POST",headers:{"Content-Type":"application/json",...(authorization?{Authorization:authorization}:{})},body:JSON.stringify({jsonrpc:"2.0",id:1,method,params}),signal:AbortSignal.timeout(15000),cache:"no-store"});
  assert(response.ok,503,"SCANNER_UNAVAILABLE","The receiver scanner is unavailable.");
  const body=await response.json(); assert(!body.error && "result" in body,503,"SCANNER_UNAVAILABLE","The receiver scanner rejected the request."); return body.result;
}
export async function scanPayments(): Promise<boolean> {
  const backend = process.env.ZCASH_SCANNER_BACKEND || "zallet";
  assert(backend === "zallet" || backend === "devtool", 503, "SCANNER_BACKEND", "Unknown receiver scanner backend.");
  if (backend === "devtool") {
    if (!["ZCASH_VIEW_WALLET_PATH", "ZCASH_WALLET_BINARY", "ZCASH_ADDRESS_VERIFIER_BINARY", "ZCASH_ACCOUNT_UUID", "SELLER_ZCASH_ADDRESS"].every(key => process.env[key])) return false;
    const snapshot = await readDevtoolSnapshot();
    const invoices = (await db().query("SELECT * FROM invoices")).rows;
    await reconcilePayments(invoices, snapshot.transactions, snapshot.accountUuid, async destination => {
      // The fixed exporter obtains these per-pool matches from official SDK receiver
      // equality and external UFVK derivation, never from operator-supplied aliases.
      const binding = snapshot.destinationBindings.find(item => item.destination === destination);
      assert(binding, 503, "SCANNER_DESTINATION", "Invoice destination is not verified by this viewing wallet.");
      return binding.receivers;
    });
    return true;
  }
  if (!["ZALLET_RPC_URL", "ZCASH_NODE_RPC_URL", "SELLER_ZCASH_ADDRESS", "ZALLET_ACCOUNT_UUID"].every(key => process.env[key])) return false;
  const info=z.object({chain:z.literal("test")}).parse(await rpc(secret("ZCASH_NODE_RPC_URL"),"getblockchaininfo",[],process.env.ZCASH_NODE_RPC_AUTH));
  assert(info.chain==="test",503,"NETWORK_MISMATCH","Zcash scanner must use testnet.");
  const account=secret("ZALLET_ACCOUNT_UUID"); const url=secret("ZALLET_RPC_URL"); const auth=process.env.ZALLET_RPC_AUTH;
  const invoices=(await db().query("SELECT * FROM invoices")).rows;
  // Full account history with bounded pages: spent notes remain visible, unlike z_listunspent.
  const txids=new Set<string>(); let offset=0;
  for (;;) {
    const rows=z.array(z.object({txid:z.string().regex(/^[0-9a-f]{64}$/i)})).parse(await rpc(url,"z_listtransactions",[account,null,null,offset,100],auth));
    rows.forEach(row=>txids.add(row.txid)); offset+=rows.length;
    if(rows.length<100) break;
    assert(offset<10000,503,"SCANNER_HISTORY_LIMIT","Scanner history exceeds the MVP limit; no payment status was updated.");
  }
  // An empty invoice table must still validate the configured wallet account.
  if(invoices.length===0) return true;
  for(const row of (await db().query("SELECT DISTINCT txid FROM payment_observations")).rows) txids.add(row.txid);
  const transactions:unknown[]=[];
  // Do not persist a partial scan if any RPC/schema check fails.
  for(const txid of txids) transactions.push(viewedTransactionSchema.parse(await rpc(url,"z_viewtransaction",[txid],auth)));
  await reconcilePayments(invoices, transactions, account, async destination => {
    let receivers = [destination];
    if (destination.startsWith("utest1")) {
      // Resolve only actual shielded receivers; never accept its transparent receiver.
      const decoded=z.object({sapling:z.string().optional(),orchard:z.string().optional()}).parse(await rpc(url,"z_listunifiedreceivers",[destination],auth));
      assert(decoded.sapling || decoded.orchard,503,"NO_SHIELDED_RECEIVER","Invoice UA has no supported shielded receiver.");
      receivers=[...receivers,...[decoded.sapling,decoded.orchard].filter((value):value is string=>Boolean(value))];
    }
    return receivers;
  });
  return true;
}
async function reconcilePayments(invoices: { id: string; payload: InvoicePayload; suspended: boolean }[], transactions: unknown[], account: string, resolveReceivers: (destination: string) => Promise<ReceiverMatch[]>) {
  const config = configuration();
  for (const invoice of invoices) {
    const payload = invoice.payload;
    if(!await invoiceCanonical(payload)) { await db().query("UPDATE invoices SET suspended=true,status='needs-review' WHERE id=$1",[invoice.id]);continue; }
    if(invoice.suspended) continue;
    const receivers = await resolveReceivers(payload.destination);
    const notes=transactions.flatMap(tx=>receivedNotes(tx,payload,account,receivers));
    const state=classifyPayment(payload,notes,config.paymentConfirmations);
    await transaction(async client=>{
      await client.query("UPDATE payment_observations SET active=false,confirmations=0 WHERE invoice_id=$1",[invoice.id]);
      for(const note of notes) await client.query("INSERT INTO payment_observations(txid,output_id,invoice_id,amount,confirmations,active) VALUES($1,$2,$3,$4,$5,$6) ON CONFLICT(txid,output_id) DO UPDATE SET confirmations=EXCLUDED.confirmations,active=EXCLUDED.active WHERE payment_observations.invoice_id=EXCLUDED.invoice_id",[note.txid,note.outputId,invoice.id,note.amount,note.confirmations,note.active]);
      await client.query("UPDATE invoices SET status=$2,confirmations=$3 WHERE id=$1",[invoice.id,state.status,state.confirmations]);
    });
  }
}
