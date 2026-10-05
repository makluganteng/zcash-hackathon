import { readFile } from "node:fs/promises";
import { db } from "../src/server/db";
for (const file of ["001-init.sql", "002-server-only.sql"]) {
  await db().query(await readFile(new URL(`../db/${file}`, import.meta.url), "utf8"));
}
console.log("Database schema ready.");
await db().end();
