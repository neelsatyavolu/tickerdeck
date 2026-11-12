import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { createTestSql, type TestSql } from "@/test/pg";

const db = vi.hoisted(() => ({ sql: null as unknown as TestSql }));
vi.mock("../db", () => ({ sql: () => db.sql }));

import { addHolding, deleteHolding, deletePortfolio, importHoldings, listPortfolios, updateHolding, updatePortfolio } from "../portfolio/repo";
import type { SyncedAccount } from "./map";
import { deleteItem, findItem, hasInstitution, insertItem, listItems, markItemFailed, replaceHoldings } from "./repo";

const ME = "user-me";
const OTHER = "user-other";
const LINKED = /synced from your brokerage/;

const newItem = (over: Partial<Parameters<typeof insertItem>[1]> = {}) => ({ itemId: "plaid-item-1", sealedToken: "v1.sealed", institutionId: "ins_1", institutionName: "Schwab", ...over });
const ira = (lots: SyncedAccount["lots"]): SyncedAccount => ({ accountId: "acc-ira", name: "Schwab Roth IRA ··1234", lots, skipped: [] });
const aapl = { symbol: "AAPL", shares: 10, cost_basis: 150, note: null };
const vti = { symbol: "VTI", shares: 3, cost_basis: 200.5, note: "Schwab did not report a cost basis." };

beforeAll(async () => {
  db.sql = await createTestSql();
});

beforeEach(async () => {
  await db.sql.query("delete from portfolios");
  await db.sql.query("delete from plaid_items");
});

describe("plaid items", () => {
  it("lists a user's links without the access token", async () => {
    const id = await insertItem(ME, newItem());
    await insertItem(OTHER, newItem({ itemId: "plaid-item-2" }));
    const items = await listItems(ME);
    expect(items).toEqual([{ id, institution: "Schwab", status: "ok", last_synced_at: null, last_error: null }]);
    expect(JSON.stringify(items)).not.toContain("sealed");
  });

  it("knows which institutions a user already linked", async () => {
    await insertItem(ME, newItem());
    expect(await hasInstitution(ME, "ins_1")).toBe(true);
    expect(await hasInstitution(ME, "ins_2")).toBe(false);
    expect(await hasInstitution(OTHER, "ins_1")).toBe(false);
  });

  it("refuses a second link to the same institution", async () => {
    await insertItem(ME, newItem());
    await expect(insertItem(ME, newItem({ itemId: "plaid-item-2" }))).rejects.toThrow(/already linked/);
  });

  it("hands the sealed token only to its owner", async () => {
    const id = await insertItem(ME, newItem());
    expect(await findItem(ME, id)).toEqual({ id, itemId: "plaid-item-1", sealedToken: "v1.sealed", institution: "Schwab" });
    expect(await findItem(OTHER, id)).toBeNull();
  });

  it("records a failed sync and whether the brokerage needs a new sign-in", async () => {
    const id = await insertItem(ME, newItem());
    await markItemFailed(ME, id, "login_required", "Sign in to Schwab again.");
    expect(await listItems(ME)).toMatchObject([{ status: "login_required", last_error: "Sign in to Schwab again." }]);
  });
});

describe("replaceHoldings", () => {
  it("creates one holdings portfolio per account and marks the link synced", async () => {
    const id = await insertItem(ME, newItem());
    await replaceHoldings(ME, id, [ira([aapl, vti]), { accountId: "acc-taxable", name: "Schwab Brokerage", lots: [aapl], skipped: [] }]);

    const portfolios = await listPortfolios(ME);
    expect(portfolios.map((p) => [p.name, p.kind, p.holdings.length])).toEqual(expect.arrayContaining([["Schwab Roth IRA ··1234", "holdings", 2], ["Schwab Brokerage", "holdings", 1]]));
    const [roth] = portfolios.filter((p) => p.name.includes("Roth"));
    expect(roth.holdings.map(({ symbol, shares, cost_basis, bought_at, note }) => ({ symbol, shares, cost_basis, bought_at, note }))).toEqual(
      expect.arrayContaining([{ ...aapl, bought_at: null }, { ...vti, bought_at: null }]),
    );
    expect(roth.link).toMatchObject({ item_id: id, institution: "Schwab", status: "ok" });
    expect(roth.link?.last_synced_at).toEqual(expect.any(String));
  });

  it("replaces the lots on the next sync and keeps the same portfolio", async () => {
    const id = await insertItem(ME, newItem());
    await replaceHoldings(ME, id, [ira([aapl, vti])]);
    const [before] = await listPortfolios(ME);
    await replaceHoldings(ME, id, [ira([{ ...aapl, shares: 12 }])]);
    const after = await listPortfolios(ME);
    expect(after).toHaveLength(1);
    expect(after[0].id).toBe(before.id);
    expect(after[0].holdings.map((h) => [h.symbol, h.shares])).toEqual([["AAPL", 12]]);
  });

  it("empties an account that no longer holds anything", async () => {
    const id = await insertItem(ME, newItem());
    await replaceHoldings(ME, id, [ira([aapl])]);
    await replaceHoldings(ME, id, [ira([])]);
    expect((await listPortfolios(ME))[0].holdings).toEqual([]);
  });

  it("releases the portfolio of an account the brokerage no longer reports, so it can be edited or deleted", async () => {
    const id = await insertItem(ME, newItem());
    const taxable: SyncedAccount = { accountId: "acc-taxable", name: "Schwab Brokerage", lots: [vti], skipped: [] };
    await replaceHoldings(ME, id, [ira([aapl]), taxable]);
    await replaceHoldings(ME, id, [ira([aapl])]);

    const portfolios = await listPortfolios(ME);
    const closed = portfolios.find((p) => p.name === "Schwab Brokerage");
    expect(closed).toMatchObject({ link: null, holdings: [{ symbol: "VTI" }] });
    expect(portfolios.find((p) => p.name.includes("Roth"))?.link).toMatchObject({ item_id: id });
    await deletePortfolio(ME, closed!.id);
  });

  it("releases nothing when the brokerage reports no accounts at all", async () => {
    const id = await insertItem(ME, newItem());
    await replaceHoldings(ME, id, [ira([aapl])]);
    await replaceHoldings(ME, id, []);
    expect(await listPortfolios(ME)).toMatchObject([{ link: { item_id: id }, holdings: [{ symbol: "AAPL" }] }]);
  });

  it("takes the link's row lock before replacing, so two syncs at once can't both add their lots", async () => {
    const id = await insertItem(ME, newItem());
    db.sql.log.length = 0;
    await replaceHoldings(ME, id, [ira([aapl])]);
    const log = db.sql.log.map((q) => q.replace(/\s+/g, " ").trim());
    expect(log).toHaveLength(4);
    expect([log[0], log[3]]).toEqual(["begin", "commit"]);
    expect(log[1]).toMatch(/^select id from plaid_items where .* for update$/);
    expect(log[2]).toMatch(/^with item as/);
  });

  it("keeps the old lots when a sync can't be saved", async () => {
    const id = await insertItem(ME, newItem());
    await replaceHoldings(ME, id, [ira([aapl])]);
    await expect(replaceHoldings(ME, id, [ira([{ ...vti, symbol: "not a ticker" }])])).rejects.toThrow();
    expect((await listPortfolios(ME))[0].holdings.map((h) => h.symbol)).toEqual(["AAPL"]);
  });

  it("clears an earlier failure", async () => {
    const id = await insertItem(ME, newItem());
    await markItemFailed(ME, id, "login_required", "Sign in to Schwab again.");
    await replaceHoldings(ME, id, [ira([aapl])]);
    expect(await listItems(ME)).toMatchObject([{ status: "ok", last_error: null }]);
  });

  it("won't write through someone else's link", async () => {
    const id = await insertItem(ME, newItem());
    await expect(replaceHoldings(OTHER, id, [ira([aapl])])).rejects.toThrow(/not found/);
    expect(await listPortfolios(OTHER)).toEqual([]);
    expect(await listPortfolios(ME)).toEqual([]);
  });
});

describe("a synced portfolio", () => {
  const linked = async () => {
    const id = await insertItem(ME, newItem());
    await replaceHoldings(ME, id, [ira([aapl])]);
    const [portfolio] = await listPortfolios(ME);
    return { itemId: id, portfolio, holding: portfolio.holdings[0] };
  };

  it("can't be edited by hand", async () => {
    const { portfolio, holding } = await linked();
    await expect(addHolding(ME, portfolio.id, aapl)).rejects.toThrow(LINKED);
    await expect(updateHolding(ME, holding.id, { ...aapl, shares: 99 })).rejects.toThrow(LINKED);
    await expect(deleteHolding(ME, holding.id)).rejects.toThrow(LINKED);
    await expect(importHoldings(ME, { portfolioId: portfolio.id }, [aapl])).rejects.toThrow(LINKED);
    await expect(updatePortfolio(ME, portfolio.id, { name: "Mine now", kind: "paper" })).rejects.toThrow(LINKED);
    await expect(deletePortfolio(ME, portfolio.id)).rejects.toThrow(LINKED);
    expect((await listPortfolios(ME))[0]).toMatchObject({ name: "Schwab Roth IRA ··1234", kind: "holdings", holdings: [{ symbol: "AAPL", shares: 10 }] });
  });

  it("becomes an ordinary editable portfolio once its link is removed", async () => {
    const { itemId, portfolio } = await linked();
    await deleteItem(ME, itemId);
    expect(await listItems(ME)).toEqual([]);
    const [kept] = await listPortfolios(ME);
    expect(kept).toMatchObject({ id: portfolio.id, link: null, holdings: [{ symbol: "AAPL" }] });
    await addHolding(ME, kept.id, vti);
    expect((await listPortfolios(ME))[0].holdings).toHaveLength(2);
  });

  it("can't be unlinked by another user", async () => {
    const { itemId } = await linked();
    await expect(deleteItem(OTHER, itemId)).rejects.toThrow(/not found/);
    expect(await listItems(ME)).toHaveLength(1);
  });
});

describe("an ordinary portfolio", () => {
  it("still accepts edits and reports no link", async () => {
    const id = await importHoldings(ME, { portfolio: { name: "Manual", kind: "holdings" } }, [aapl]);
    await addHolding(ME, id, vti);
    await updatePortfolio(ME, id, { name: "Renamed", kind: "holdings" });
    const [portfolio] = await listPortfolios(ME);
    expect(portfolio).toMatchObject({ name: "Renamed", link: null });
    await updateHolding(ME, portfolio.holdings[0].id, { ...aapl, shares: 1 });
    await deleteHolding(ME, portfolio.holdings[1].id);
    await expect(updateHolding(ME, "00000000-0000-0000-0000-000000000000", aapl)).rejects.toThrow("Holding not found.");
    await deletePortfolio(ME, id);
    expect(await listPortfolios(ME)).toEqual([]);
  });
});
