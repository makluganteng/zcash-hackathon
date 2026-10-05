import { db } from "@/server/db";
import { endpoint, requireOperator } from "@/server/http";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Authenticated deployment check: exposes neither rows nor connection credentials. */
export async function GET(request: Request) {
  return endpoint(async () => {
    requireOperator(request);
    const result = await db().query<{ relname: string; relrowsecurity: boolean }>(
      "SELECT relname,relrowsecurity FROM pg_class JOIN pg_namespace n ON n.oid=relnamespace WHERE n.nspname='public' AND relkind='r' AND relname=ANY($1::text[])",
      [["auctions", "creation_requests", "bid_blobs", "bid_submissions", "claim_challenges", "invoices", "claim_sessions", "payment_observations", "worker_health"]],
    );
    return { databaseConnected: true, schemaReady: result.rows.length === 9,
      rowLevelSecurityEnabled: result.rows.length === 9 && result.rows.every(row => row.relrowsecurity) };
  });
}
