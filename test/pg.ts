import { readdir, readFile } from "node:fs/promises";
import { PGlite } from "@electric-sql/pglite";

// An in-memory Postgres with every migration applied, behind the call shapes
// the Neon client offers (tagged template, .query and .transaction), so repo
// tests run their real SQL. It has one connection, so it can't show what two
// overlapping requests would do.

type Rows = Record<string, unknown>[];
/** Like Neon's queries: nothing runs until it is awaited or handed to transaction(). */
type Query = PromiseLike<Rows> & { text: string; params: unknown[] };

export type TestSql = ((strings: TemplateStringsArray, ...values: unknown[]) => Query) & {
  query: (text: string, params?: unknown[]) => Query;
  transaction: (queries: Query[]) => Promise<Rows[]>;
  /** Every statement run so far, in order. */
  log: string[];
};

const migrations = new URL("../db/migrations/", import.meta.url);

export async function createTestSql(): Promise<TestSql> {
  const pg = new PGlite();
  for (const file of (await readdir(migrations)).filter((f) => f.endsWith(".sql")).sort()) {
    await pg.exec(await readFile(new URL(file, migrations), "utf8"));
  }
  const log: string[] = [];

  const run = async (text: string, params: unknown[], on: Pick<PGlite, "query"> = pg): Promise<Rows> => {
    log.push(text);
    return (await on.query<Record<string, unknown>>(text, params)).rows;
  };
  const query = (text: string, params: unknown[] = []): Query => ({ text, params, then: (resolve, reject) => run(text, params).then(resolve, reject) });
  const tagged = (strings: TemplateStringsArray, ...values: unknown[]) =>
    query(strings.reduce((text, part, i) => text + part + (i < values.length ? `$${i + 1}` : ""), ""), values);

  const transaction = (queries: Query[]) =>
    pg.transaction(async (tx) => {
      log.push("begin");
      const results: Rows[] = [];
      for (const q of queries) results.push(await run(q.text, q.params, tx));
      log.push("commit");
      return results;
    });

  return Object.assign(tagged, { query, transaction, log });
}
