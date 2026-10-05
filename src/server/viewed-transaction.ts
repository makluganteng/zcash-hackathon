import { z } from "zod";

// Schema follows Zallet's z_viewtransaction source. Unknown/new fields do not weaken checks.
// https://github.com/zcash/zallet/blob/main/zallet-core/src/components/json_rpc/methods/view_transaction.rs
export const viewedTransactionSchema = z.object({
  txid: z.string().regex(/^[0-9a-f]{64}$/i), confirmations: z.number().int().min(-1),
  status: z.enum(["mined","waiting","expiringsoon","expired"]), blockhash: z.string().optional(), blocktime: z.number().int().nonnegative().optional(),
  outputs: z.array(z.object({ pool:z.enum(["transparent","sapling","orchard","ironwood"]), output:z.number().int().nonnegative().optional(), action:z.number().int().nonnegative().optional(), account_uuid:z.string().optional(), address:z.string().optional(), outgoing:z.boolean().nullable(), walletInternal:z.boolean(), valueZat:z.number().int().safe().nonnegative(), memoStr:z.string().optional() })),
});
