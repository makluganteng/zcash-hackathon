import test from "node:test";
import assert from "node:assert/strict";
import { databaseOptions } from "../../src/server/db";

test("Supabase session/direct connections preserve the advisory-lock connection model", () => {
  for (const connection of [
    "postgresql://postgres.ref:example@aws-0-test.pooler.supabase.com:5432/postgres?sslmode=verify-full",
    "postgresql://postgres:example@db.ref.supabase.co:5432/postgres?sslmode=verify-full",
    "postgresql://auction_dev@127.0.0.1:55432/sealed_auctions",
  ]) {
    assert.deepEqual(databaseOptions(connection, "2"), { connectionString: connection, max: 2, connectionTimeoutMillis: 5000 });
  }
});

test("Supabase transaction pooling and single-connection nested work are rejected", () => {
  for (const hostname of ["aws-0-test.pooler.supabase.com", "db.ref.supabase.co"]) {
    assert.throws(() => databaseOptions(`postgresql://postgres:example@${hostname}:6543/postgres`), /Session pooler/);
  }
  for (const size of ["1", "0", "2.5", "NaN", "21"]) {
    assert.throws(() => databaseOptions("postgresql://localhost/db", size), /DATABASE_POOL_MAX/);
  }
});

test("invalid database configuration errors never echo a credential", () => {
  assert.throws(() => databaseOptions("not-a-url-with-private-value"), error => {
    assert(error instanceof Error);
    assert.doesNotMatch(error.message, /private-value/);
    return true;
  });
});

test("custom database CA retains certificate and hostname verification", () => {
  const ca = "-----BEGIN CERTIFICATE-----\nfixture\n-----END CERTIFICATE-----";
  const result = databaseOptions("postgresql://postgres:example@db.ref.supabase.co:5432/postgres?sslmode=verify-full", "2", ca);
  assert.deepEqual(result.ssl, { ca, rejectUnauthorized: true });
  assert.equal(new URL(result.connectionString).searchParams.has("sslmode"), false);
  assert.throws(() => databaseOptions("postgresql://localhost/db?sslmode=disable", "2", ca), /verified TLS/);
  assert.throws(() => databaseOptions("postgresql://localhost/db?sslrootcert=other", "2", ca), /conflicting/);
  assert.throws(() => databaseOptions("postgresql://localhost/db", "2", "invalid"), /PEM certificate/);
});
