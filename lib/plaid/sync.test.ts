import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { createTestSql, type TestSql } from "@/test/pg";

const db = vi.hoisted(() => ({ sql: null as unknown as TestSql }));
vi.mock("../db", () => ({ sql: () => db.sql }));

import { listPortfolios } from "../portfolio/repo";
import { PlaidError, type PlaidGateway } from "./client";
import type { PlaidHoldingsData } from "./map";
import { listItems } from "./repo";
import { isStale } from "./stale";
import { connectToken, linkBrokerage, reconnectToken, syncBrokerage, unlinkBrokerage } from "./sync";
import { openToken } from "./tokens";

const ME = "user-me";
const OTHER = "user-other";
const tokenKey = "k".repeat(32);

const holdings: PlaidHoldingsData = {
  accounts: [{ account_id: "acc-1", name: "Roth IRA", mask: "1234", type: "investment" }],
  securities: [
    { security_id: "s1", ticker_symbol: "AAPL", name: "Apple", type: "equity", is_cash_equivalent: false },
    { security_id: "s2", ticker_symbol: "CUR:USD", name: "US Dollar", type: "cash", is_cash_equivalent: true },
  ],
  holdings: [
    { account_id: "acc-1", security_id: "s1", quantity: 10, cost_basis: 1500 },
    { account_id: "acc-1", security_id: "s2", quantity: 250, cost_basis: 250 },
  ],
};

/** A stand-in for Plaid that records what it was asked. */
function fakePlaid(over: Partial<PlaidGateway> = {}) {
  const calls: string[] = [];
  const gateway: PlaidGateway = {
    createLinkToken: async (input) => (calls.push(`link:${input.accessToken ?? "new"}`), "link-token"),
    exchangePublicToken: async (publicToken) => (calls.push(`exchange:${publicToken}`), { accessToken: "access-1", itemId: "plaid-item-1" }),
    getHoldings: async (accessToken) => (calls.push(`holdings:${accessToken}`), holdings),
    removeItem: async (accessToken) => void calls.push(`remove:${accessToken}`),
    ...over,
  };
  return { gateway, calls };
}

const schwab = { publicToken: "public-1", institutionId: "ins_1", institutionName: "Schwab" };
const linked = async (plaid = fakePlaid()) => (await linkBrokerage({ gateway: plaid.gateway, tokenKey }, ME, schwab)).id;

beforeAll(async () => {
  db.sql = await createTestSql();
});

beforeEach(async () => {
  await db.sql.query("delete from portfolios");
  await db.sql.query("delete from plaid_items");
});

describe("linkBrokerage", () => {
  it("stores the link with an encrypted token and pulls the positions", async () => {
    const plaid = fakePlaid();
    const result = await linkBrokerage({ gateway: plaid.gateway, tokenKey }, ME, schwab);

    expect(result.sync).toEqual({ portfolios: 1, lots: 1, skipped: [{ name: "US Dollar", reason: "cash" }] });
    expect(result.error).toBeNull();
    const [row] = await db.sql.query("select item_id, access_token from plaid_items");
    expect(row.access_token).not.toContain("access-1");
    expect(openToken(tokenKey, ME, "plaid-item-1", row.access_token as string)).toBe("access-1");
    expect((await listPortfolios(ME)).map((p) => [p.name, p.holdings.map((h) => h.symbol)])).toEqual([["Schwab Roth IRA ··1234", ["AAPL"]]]);
  });

  it("refuses a brokerage that is already linked before spending another Plaid link", async () => {
    await linked();
    const plaid = fakePlaid();
    await expect(linkBrokerage({ gateway: plaid.gateway, tokenKey }, ME, schwab)).rejects.toThrow(/already linked/);
    expect(plaid.calls).toEqual([]);
  });

  it("explains a failed token exchange and stores nothing", async () => {
    const plaid = fakePlaid({ exchangePublicToken: async () => Promise.reject(new PlaidError("INVALID_PUBLIC_TOKEN", "expired")) });
    await expect(linkBrokerage({ gateway: plaid.gateway, tokenKey }, ME, schwab)).rejects.toThrow("Couldn't finish linking Schwab (INVALID_PUBLIC_TOKEN). Try again.");
    expect(await listItems(ME)).toEqual([]);
  });

  it("removes the link at Plaid again when it can't be stored", async () => {
    await linked();
    // Same Plaid item id under another institution: the insert fails after the exchange has happened.
    const plaid = fakePlaid();
    await expect(linkBrokerage({ gateway: plaid.gateway, tokenKey }, ME, { ...schwab, institutionId: "ins_2", institutionName: "Fidelity" })).rejects.toThrow();
    expect(plaid.calls).toEqual(["exchange:public-1", "remove:access-1"]);
    expect(await listItems(ME)).toHaveLength(1);
  });

  it("keeps the link when the first sync fails, and says why", async () => {
    const plaid = fakePlaid({ getHoldings: async () => Promise.reject(new PlaidError("PRODUCT_NOT_READY", "not ready")) });
    const result = await linkBrokerage({ gateway: plaid.gateway, tokenKey }, ME, schwab);
    expect(result.sync).toBeNull();
    expect(result.error).toMatch(/Schwab/);
    expect(await listItems(ME)).toHaveLength(1);
  });
});

describe("syncBrokerage", () => {
  it("replaces the positions with what the brokerage reports now", async () => {
    const id = await linked();
    const sold: PlaidHoldingsData = { ...holdings, holdings: [{ account_id: "acc-1", security_id: "s1", quantity: 4, cost_basis: 600 }] };
    const result = await syncBrokerage({ gateway: fakePlaid({ getHoldings: async () => sold }).gateway, tokenKey }, ME, id);
    expect(result).toEqual({ portfolios: 1, lots: 1, skipped: [] });
    expect((await listPortfolios(ME))[0].holdings.map((h) => [h.symbol, h.shares, h.cost_basis])).toEqual([["AAPL", 4, 150]]);
  });

  it("asks for a new sign-in when the brokerage has logged Plaid out, and keeps the last positions", async () => {
    const id = await linked();
    const plaid = fakePlaid({ getHoldings: async () => Promise.reject(new PlaidError("ITEM_LOGIN_REQUIRED", "login required")) });
    await expect(syncBrokerage({ gateway: plaid.gateway, tokenKey }, ME, id)).rejects.toThrow("Sign in to Schwab again to keep it in sync.");
    expect(await listItems(ME)).toMatchObject([{ status: "login_required", last_error: "Sign in to Schwab again to keep it in sync." }]);
    expect((await listPortfolios(ME))[0].holdings).toHaveLength(1);
  });

  it("records other Plaid failures without marking the link as logged out", async () => {
    const id = await linked();
    const plaid = fakePlaid({ getHoldings: async () => Promise.reject(new PlaidError("INSTITUTION_DOWN", "down")) });
    await expect(syncBrokerage({ gateway: plaid.gateway, tokenKey }, ME, id)).rejects.toThrow("Couldn't sync Schwab (INSTITUTION_DOWN). Try again later.");
    expect(await listItems(ME)).toMatchObject([{ status: "ok", last_error: "Couldn't sync Schwab (INSTITUTION_DOWN). Try again later." }]);
  });

  it("treats a brokerage that reports no investment accounts as a failed sync and keeps the last positions", async () => {
    const id = await linked();
    const plaid = fakePlaid({ getHoldings: async () => ({ accounts: [], holdings: [], securities: [] }) });
    await expect(syncBrokerage({ gateway: plaid.gateway, tokenKey }, ME, id)).rejects.toThrow("Schwab reported no investment accounts.");
    expect(await listItems(ME)).toMatchObject([{ status: "ok", last_error: "Schwab reported no investment accounts." }]);
    expect((await listPortfolios(ME))[0]).toMatchObject({ link: { item_id: id }, holdings: [{ symbol: "AAPL" }] });
  });

  it("records a sync that couldn't be saved, without leaking the database error", async () => {
    const id = await linked();
    await db.sql.query("alter table holdings add constraint test_reject check (symbol <> 'AAPL') not valid");
    try {
      await expect(syncBrokerage({ gateway: fakePlaid().gateway, tokenKey }, ME, id)).rejects.toThrow("Couldn't save the Schwab positions. Try again later.");
    } finally {
      await db.sql.query("alter table holdings drop constraint test_reject");
    }
    expect(await listItems(ME)).toMatchObject([{ status: "ok", last_error: "Couldn't save the Schwab positions. Try again later." }]);
    expect((await listPortfolios(ME))[0].holdings).toHaveLength(1);
  });

  it("won't sync someone else's link", async () => {
    const id = await linked();
    const plaid = fakePlaid();
    await expect(syncBrokerage({ gateway: plaid.gateway, tokenKey }, OTHER, id)).rejects.toThrow(/not found/);
    expect(plaid.calls).toEqual([]);
  });

  it("says the link must be redone when its token can no longer be decrypted", async () => {
    const id = await linked();
    const plaid = fakePlaid();
    await expect(syncBrokerage({ gateway: plaid.gateway, tokenKey: "z".repeat(32) }, ME, id)).rejects.toThrow(/Unlink it and connect again/);
    expect(plaid.calls).toEqual([]);
  });
});

describe("connectToken", () => {
  it("starts a link for a new brokerage", async () => {
    const plaid = fakePlaid();
    expect(await connectToken({ gateway: plaid.gateway, tokenKey }, ME, "https://tickerdeck.test/plaid/oauth")).toBe("link-token");
    expect(plaid.calls).toEqual(["link:new"]);
  });

  it("passes on Plaid's reason when it refuses, such as an unregistered redirect address", async () => {
    const plaid = fakePlaid({ createLinkToken: async () => Promise.reject(new PlaidError("INVALID_FIELD", "redirect_uri must be configured in the developer dashboard")) });
    await expect(connectToken({ gateway: plaid.gateway, tokenKey }, ME, "https://tickerdeck.test/plaid/oauth")).rejects.toThrow(
      "Plaid couldn't start the link: redirect_uri must be configured in the developer dashboard",
    );
  });
});

describe("reconnectToken", () => {
  it("asks Plaid to re-authenticate the existing link instead of creating a new one", async () => {
    const id = await linked();
    const plaid = fakePlaid();
    expect(await reconnectToken({ gateway: plaid.gateway, tokenKey }, ME, id, "https://tickerdeck.test/plaid/oauth")).toBe("link-token");
    expect(plaid.calls).toEqual(["link:access-1"]);
  });
});

describe("reconnectToken for a link that can't be used", () => {
  it("refuses another user's link and an undecryptable one without calling Plaid", async () => {
    const id = await linked();
    const plaid = fakePlaid();
    await expect(reconnectToken({ gateway: plaid.gateway, tokenKey }, OTHER, id, "https://tickerdeck.test/plaid/oauth")).rejects.toThrow(/not found/);
    await expect(reconnectToken({ gateway: plaid.gateway, tokenKey: "z".repeat(32) }, ME, id, "https://tickerdeck.test/plaid/oauth")).rejects.toThrow(/Unlink it and connect again/);
    expect(plaid.calls).toEqual([]);
  });
});

describe("unlinkBrokerage", () => {
  it("removes the link at Plaid and here, and keeps the portfolio", async () => {
    const id = await linked();
    const plaid = fakePlaid();
    await unlinkBrokerage({ gateway: plaid.gateway, tokenKey }, ME, id);
    expect(plaid.calls).toEqual(["remove:access-1"]);
    expect(await listItems(ME)).toEqual([]);
    expect(await listPortfolios(ME)).toMatchObject([{ link: null, holdings: [{ symbol: "AAPL" }] }]);
  });

  it("still unlinks here when Plaid has already forgotten the link", async () => {
    const id = await linked();
    const plaid = fakePlaid({ removeItem: async () => Promise.reject(new PlaidError("ITEM_NOT_FOUND", "gone")) });
    await unlinkBrokerage({ gateway: plaid.gateway, tokenKey }, ME, id);
    expect(await listItems(ME)).toEqual([]);
  });

  it("unlinks here without calling Plaid when the token can no longer be decrypted", async () => {
    const id = await linked();
    const plaid = fakePlaid();
    await unlinkBrokerage({ gateway: plaid.gateway, tokenKey: "z".repeat(32) }, ME, id);
    expect(plaid.calls).toEqual([]);
    expect(await listItems(ME)).toEqual([]);
  });

  it("keeps the link when Plaid can't be reached, so it isn't left active there", async () => {
    const id = await linked();
    const plaid = fakePlaid({ removeItem: async () => Promise.reject(new PlaidError(null, "network")) });
    await expect(unlinkBrokerage({ gateway: plaid.gateway, tokenKey }, ME, id)).rejects.toThrow(/Couldn't unlink/);
    expect(await listItems(ME)).toHaveLength(1);
  });
});

describe("isStale", () => {
  const now = Date.parse("2026-10-10T20:00:00Z");
  it("is true for a link that never synced or last synced over 12 hours ago", () => {
    expect(isStale(null, now)).toBe(true);
    expect(isStale("2026-10-10T07:59:00Z", now)).toBe(true);
    expect(isStale("2026-10-10T08:01:00Z", now)).toBe(false);
  });
});
