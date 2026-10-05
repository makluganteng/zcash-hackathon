import { Pool, type PoolClient } from "pg";
import { secret } from "./config";
const globalDb = globalThis as unknown as { auctionPool?: Pool };
export function databaseOptions(connectionString: string, poolSize = process.env.DATABASE_POOL_MAX, certificate = process.env.DATABASE_SSL_CA) {
  let url: URL;
  try { url = new URL(connectionString); }
  catch { throw new Error("DATABASE_URL must be a valid PostgreSQL connection string."); }
  if (!['postgres:', 'postgresql:'].includes(url.protocol)) throw new Error("DATABASE_URL must use PostgreSQL.");
  const supabase = url.hostname.endsWith('.pooler.supabase.com') || url.hostname.endsWith('.supabase.co');
  if (supabase && url.port === '6543') {
    throw new Error("Use Supabase Session pooler (port 5432) or a direct connection. Transaction pooling cannot preserve the application's session advisory locks.");
  }
  const max = Number(poolSize ?? 2);
  if (!Number.isInteger(max) || max < 2 || max > 20) throw new Error("DATABASE_POOL_MAX must be an integer from 2 to 20; nested database work requires at least two connections.");
  if (certificate) {
    if (!certificate.includes("-----BEGIN CERTIFICATE-----")) throw new Error("DATABASE_SSL_CA must contain a PEM certificate.");
    const mode = url.searchParams.get('sslmode');
    if ((mode && !['require', 'verify-ca', 'verify-full'].includes(mode)) ||
        ['sslcert', 'sslkey', 'sslrootcert', 'uselibpqcompat'].some(key => url.searchParams.has(key))) {
      throw new Error("DATABASE_SSL_CA requires verified TLS without conflicting connection-string SSL options.");
    }
    // node-postgres replaces explicit SSL configuration when sslmode appears in
    // the URL. Keep the downloaded CA and hostname verification authoritative.
    url.searchParams.delete('sslmode');
    return { connectionString: url.toString(), max, connectionTimeoutMillis: 5000,
      ssl: { ca: certificate, rejectUnauthorized: true } };
  }
  return { connectionString, max, connectionTimeoutMillis: 5000 };
}
export function db(): Pool {
  return globalDb.auctionPool ??= new Pool(databaseOptions(secret("DATABASE_URL")));
}
export async function transaction<T>(run: (client: PoolClient) => Promise<T>): Promise<T> {
  const client = await db().connect();
  try { await client.query("BEGIN"); const result = await run(client); await client.query("COMMIT"); return result; }
  catch (error) { await client.query("ROLLBACK"); throw error; }
  finally { client.release(); }
}
