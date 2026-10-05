import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { Pool } from "pg";

test("server-only migration is idempotent, preserves owner access and denies non-owner reads/writes", {
  skip: process.env.RUN_SERVER_INTEGRATION !== "1", timeout: 30000,
}, async () => {
  // This opt-in check is deliberately restricted to the existing local test cluster.
  const name = `sealed_rls_test_${process.pid}`;
  const role = `sealed_rls_probe_${process.pid}`;
  const admin = new Pool({ connectionString: "postgresql://auction_dev@127.0.0.1:55432/postgres", max: 2 });
  let pool: Pool | undefined;
  try {
    await admin.query(`CREATE DATABASE ${name}`);
    pool = new Pool({ connectionString: `postgresql://auction_dev@127.0.0.1:55432/${name}`, max: 2 });
    const schema = await readFile("db/001-init.sql", "utf8");
    const privacy = await readFile("db/002-server-only.sql", "utf8");
    await pool.query(schema);
    await pool.query(privacy);
    await pool.query(privacy);
    await pool.query("INSERT INTO auctions(id,title,description,item_hash) VALUES ('1','test-only','RLS fixture','test-only')");
    assert.equal((await pool.query("SELECT count(*) FROM auctions")).rows[0].count, "1");
    const protectedTables = await pool.query("SELECT relname FROM pg_class JOIN pg_namespace n ON n.oid=relnamespace WHERE n.nspname='public' AND relkind='r' AND relrowsecurity");
    assert.equal(protectedTables.rowCount, 9);
    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      await client.query(`CREATE ROLE ${role} NOLOGIN`);
      await client.query(`GRANT USAGE ON SCHEMA public TO ${role}`);
      await client.query(`GRANT SELECT,INSERT ON auctions TO ${role}`);
      await client.query(`SET LOCAL ROLE ${role}`);
      assert.equal((await client.query("SELECT count(*) FROM auctions")).rows[0].count, "0");
      await assert.rejects(client.query("INSERT INTO auctions(id,title,description,item_hash) VALUES ('2','forbidden','forbidden','forbidden')"), (error: { code?: string }) => error.code === "42501");
    } finally {
      await client.query("ROLLBACK"); // Also removes the temporary role and grants.
      client.release();
    }
  } finally {
    await pool?.end();
    await admin.query(`DROP DATABASE IF EXISTS ${name} WITH (FORCE)`);
    await admin.end();
  }
});
