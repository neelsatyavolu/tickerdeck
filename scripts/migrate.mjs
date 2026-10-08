// Applies db/migrations/*.sql in order, once each. Runs before every Vercel
// build (`pnpm build`); locally: `pnpm migrate`.
import { readdir, readFile } from "node:fs/promises";
import { Pool } from "@neondatabase/serverless";

const url = process.env.DATABASE_URL_UNPOOLED ?? process.env.DATABASE_URL;
if (!url) {
  console.error("DATABASE_URL is not set");
  process.exit(1);
}

const dir = new URL("../db/migrations/", import.meta.url);
const pool = new Pool({ connectionString: url });
const db = await pool.connect();
try {
  await db.query("create table if not exists _migrations (name text primary key, applied_at timestamptz not null default now())");
  const done = new Set((await db.query("select name from _migrations")).rows.map((r) => r.name));
  for (const file of (await readdir(dir)).filter((f) => f.endsWith(".sql")).sort()) {
    if (done.has(file)) continue;
    await db.query("begin");
    try {
      await db.query(await readFile(new URL(file, dir), "utf8"));
      await db.query("insert into _migrations (name) values ($1)", [file]);
      await db.query("commit");
      console.log(`applied ${file}`);
    } catch (err) {
      await db.query("rollback");
      throw err;
    }
  }
  console.log("migrations up to date");
} finally {
  db.release();
  await pool.end();
}
