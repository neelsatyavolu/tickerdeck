import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { createTestSql, type TestSql } from "@/test/pg";

const db = vi.hoisted(() => ({ sql: null as unknown as TestSql }));
vi.mock("../db", () => ({ sql: () => db.sql }));

import { addToWatchlist, createWatchlist, listWatchlists } from "./repo";

const ME = "user-me";
const OTHER = "user-other";

beforeAll(async () => {
  db.sql = await createTestSql();
});

beforeEach(async () => {
  await db.sql.query("delete from watchlists");
  db.sql.log.length = 0;
});

describe("listWatchlists", () => {
  it("reads an existing account in two queries without writing", async () => {
    await addToWatchlist(ME, "AAPL", "Apple");
    const custom = await createWatchlist(ME, "Funds");
    await addToWatchlist(ME, "VTI", null, custom);
    await addToWatchlist(OTHER, "MSFT", "Microsoft");
    db.sql.log.length = 0;

    const lists = await listWatchlists(ME);

    expect(lists).toMatchObject([
      { name: "Watchlist", is_primary: true, items: [{ symbol: "AAPL", name: "Apple" }] },
      { id: custom, name: "Funds", is_primary: false, items: [{ symbol: "VTI", name: null }] },
    ]);
    expect(lists.flatMap((list) => list.items)).toHaveLength(2);
    expect(lists[0].items[0].added_at).toEqual(expect.any(String));
    expect(db.sql.log).toHaveLength(2);
    expect(db.sql.log.every((query) => /^select\b/i.test(query))).toBe(true);
  });

  it("creates the primary on first use and skips creation on the next read", async () => {
    const first = await listWatchlists(ME);
    expect(first).toEqual([{ id: expect.any(String), name: "Watchlist", is_primary: true, items: [] }]);
    expect(db.sql.log.filter((query) => /^insert\b/i.test(query))).toHaveLength(1);

    db.sql.log.length = 0;
    expect(await listWatchlists(ME)).toEqual(first);
    expect(db.sql.log).toHaveLength(2);
    expect(db.sql.log.every((query) => /^select\b/i.test(query))).toBe(true);
  });

  it("adds a missing primary without losing custom lists", async () => {
    await db.sql`insert into watchlists (user_id, name, is_primary, position) values (${ME}, 'Custom', false, 1)`;
    const lists = await listWatchlists(ME);
    expect(lists).toMatchObject([
      { name: "Watchlist", is_primary: true, items: [] },
      { name: "Custom", is_primary: false, items: [] },
    ]);
  });

  it("keeps one primary when two first-use reads both miss it", async () => {
    const [first, second] = await Promise.all([listWatchlists(ME), listWatchlists(ME)]);
    expect(first).toEqual(second);
    expect(first).toHaveLength(1);
    expect(first[0]).toMatchObject({ is_primary: true, items: [] });
    expect(db.sql.log.filter((query) => /^insert\b/i.test(query))).toHaveLength(2);
    expect(await db.sql`select count(*)::int as count from watchlists where user_id = ${ME} and is_primary`).toEqual([{ count: 1 }]);
  });
});
