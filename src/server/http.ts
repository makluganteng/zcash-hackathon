import { timingSafeEqual } from "node:crypto";
import { ZodError } from "zod";
import { ApiFault, assert } from "./errors";
import { secret } from "./config";
export const noStore = { "Cache-Control": "private, no-store, max-age=0", "X-Content-Type-Options": "nosniff" };
export function endpoint(run: () => Promise<unknown>) {
  return run().then(result => Response.json(result, { headers: noStore })).catch(error => {
    const fault = error instanceof ApiFault ? error : error instanceof ZodError ? new ApiFault(400, "INVALID_INPUT", "Check the request fields and try again.") : new ApiFault(503, "SERVICE_UNAVAILABLE", "The service could not complete this request. Please try again shortly.");
    return Response.json({ error: { code: fault.code, message: fault.message } }, { status: fault.status, headers: noStore });
  });
}
export async function jsonBody(request: Request, limit = 140000): Promise<unknown> {
  assert(request.headers.get("content-type")?.includes("application/json"), 415, "JSON_REQUIRED", "Send application/json.");
  const reader = request.body?.getReader(); assert(reader, 400, "EMPTY_BODY", "A JSON body is required.");
  const chunks: Uint8Array[] = []; let total = 0;
  for (;;) { const { value, done } = await reader.read(); if (done) break; total += value.length; if (total > limit) { await reader.cancel(); throw new ApiFault(413, "BODY_TOO_LARGE", "Request exceeds the upload limit."); } chunks.push(value); }
  try { return JSON.parse(Buffer.concat(chunks).toString("utf8")); } catch { throw new ApiFault(400, "INVALID_JSON", "Invalid JSON body."); }
}
export function requireOperator(request: Request) {
  const expected = Buffer.from(`Bearer ${secret("OPERATOR_TOKEN")}`);
  const supplied = Buffer.from(request.headers.get("authorization") || "");
  assert(supplied.length === expected.length && timingSafeEqual(supplied, expected), 401, "UNAUTHORIZED", "Operator authorization is required.");
}
export function auctionId(value: string) { assert(/^[1-9][0-9]{0,30}$/.test(value), 400, "INVALID_AUCTION", "Invalid auction ID."); return value; }
