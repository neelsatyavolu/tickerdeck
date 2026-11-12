import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { createTestSql, type TestSql } from "@/test/pg";

const db = vi.hoisted(() => ({ sql: null as unknown as TestSql }));
vi.mock("../db", () => ({ sql: () => db.sql }));

import { captureLink, createHandoff, handoffIdIn, takeToken } from "./handoff";
import { attach, emailVerified, linkOf, userByEmail, userBySub } from "./repo";
import { buildSummary, countsFor, summaryFor } from "./summary";

// Neon Auth's tables, as far as these queries read them (the real ones live in neon_auth).
const NEON_AUTH = `
  create schema if not exists neon_auth;
  create table if not exists neon_auth."user" (id uuid primary key, name text not null, email text not null, "emailVerified" boolean not null);
  create table if not exists neon_auth.account (id uuid primary key default gen_random_uuid(), "accountId" text not null, "providerId" text not null, "userId" uuid not null, password text);
`;

const ADA = "00000000-0000-4000-8000-000000000001";
const BOB = "00000000-0000-4000-8000-000000000002";

async function addUser(id: string, email: string, opts: { verified?: boolean; password?: boolean } = {}) {
  await db.sql.query(`insert into neon_auth."user" (id, name, email, "emailVerified") values ($1, 'x', $2, $3)`, [id, email, opts.verified ?? true]);
  if (opts.password) await db.sql.query(`insert into neon_auth.account ("accountId", "providerId", "userId", password) values ($1::text, 'credential', $1::uuid, 'hash')`, [id]);
}

beforeAll(async () => {
  db.sql = await createTestSql();
  for (const statement of NEON_AUTH.split(";").map((x) => x.trim()).filter(Boolean)) await db.sql.query(statement);
});

beforeEach(async () => {
  for (const t of ["xanom_links", "xanom_handoffs", "portfolios", "watchlists", "dashboards", "plaid_items", "neon_auth.account", 'neon_auth."user"']) {
    await db.sql.query(`delete from ${t}`);
  }
});

describe("neon auth lookups", () => {
  it("finds a user by email without case, with whether it was verified and has a password", async () => {
    await addUser(ADA, "Ada@Example.com", { verified: false, password: true });
    expect(await userByEmail("ada@example.COM")).toEqual({ id: ADA, email: "Ada@Example.com", emailVerified: false, hasPassword: true });
    await addUser(BOB, "bob@example.com");
    expect(await userByEmail("bob@example.com")).toMatchObject({ emailVerified: true, hasPassword: false });
    expect(await userByEmail("nobody@example.com")).toBeNull();
    expect(await emailVerified(BOB)).toBe(true);
    expect(await emailVerified(ADA)).toBe(false);
  });
});

describe("xanom links", () => {
  it("attaches a sub and finds the user by it with their Neon Auth email", async () => {
    await addUser(ADA, "ada@work.example");
    await attach(ADA, "xa_ADA", "ada@example.com");
    expect(await userBySub("xa_ADA")).toEqual({ id: ADA, email: "ada@work.example" });
    expect(await linkOf(ADA)).toEqual({ sub: "xa_ADA", email: "ada@example.com" });
  });

  it("attaching the same pair again is fine; the sub on a second user, or a second sub, is refused", async () => {
    await addUser(ADA, "ada@example.com");
    await addUser(BOB, "bob@example.com");
    await attach(ADA, "xa_ADA", "ada@example.com");
    await attach(ADA, "xa_ADA", "ada@new.example");
    expect((await linkOf(ADA))?.email).toBe("ada@new.example");
    await expect(attach(BOB, "xa_ADA", "bob@example.com")).rejects.toThrow(/already linked/);
    await expect(attach(ADA, "xa_OTHER", "ada@example.com")).rejects.toThrow(/already linked/);
  });

  it("drops a link whose TickerQuill account was deleted", async () => {
    await attach(ADA, "xa_GONE", "gone@example.com");
    expect(await userBySub("xa_GONE")).toBeNull();
    expect(await linkOf(ADA)).toBeNull();
  });
});

describe("handoffs", () => {
  const link = (id: string, type = "sign-in", base = "https://ep.neonauth.example/neondb/auth/magic-link/verify?token=tok_1") =>
    `${base}&callbackURL=${encodeURIComponent(`https://tickerquill.example/${type === "sign-in" ? "" : "login/reset"}?xh=${id}`)}`;

  it("finds the handoff id in the callbackURL", () => {
    expect(handoffIdIn(link("abcdefghijklmnopqrstuvwx"))).toBe("abcdefghijklmnopqrstuvwx");
    expect(handoffIdIn("https://ep.example/verify?token=t&callbackURL=%2F")).toBeNull();
    expect(handoffIdIn("https://ep.example/verify?token=t&callbackURL=%2F%3Fxh%3Dshort")).toBeNull();
    expect(handoffIdIn("not a url")).toBeNull();
  });

  it("keeps the token of a pending handoff once, for the same email and purpose only", async () => {
    const id = await createHandoff("Ada@Example.com", "sign-in");
    expect(await captureLink({ linkType: "sign-in", linkUrl: link(id), token: "tok_1", email: "bob@example.com" })).toBe(false);
    expect(await captureLink({ linkType: "forget-password", linkUrl: link(id, "forget-password"), token: "tok_1", email: "ada@example.com" })).toBe(false);
    expect(await captureLink({ linkType: "email-verification", linkUrl: link(id), token: "tok_1", email: "ada@example.com" })).toBe(false);
    expect(await captureLink({ linkType: "sign-in", linkUrl: link(id), token: "tok_1", email: "ada@example.com" })).toBe(true);
    // A second link for the same handoff is emailed as usual.
    expect(await captureLink({ linkType: "sign-in", linkUrl: link(id), token: "tok_2", email: "ada@example.com" })).toBe(false);
    expect(await takeToken(id)).toBe("tok_1");
    expect(await takeToken(id)).toBeNull();
  });

  it("reads the token from the link when the event has none", async () => {
    const id = await createHandoff("ada@example.com", "forget-password");
    const url = `https://ep.neonauth.example/neondb/auth/reset-password/tok_path?callbackURL=${encodeURIComponent(`https://t.example/login/reset?xh=${id}`)}`;
    expect(await captureLink({ linkType: "forget-password", linkUrl: url, email: "ada@example.com" })).toBe(true);
    expect(await takeToken(id)).toBe("tok_path");
  });

  it("ignores links for unknown or expired handoffs", async () => {
    expect(await captureLink({ linkType: "sign-in", linkUrl: link("unknownunknownunknown1"), token: "t", email: "ada@example.com" })).toBe(false);
    const id = await createHandoff("ada@example.com", "sign-in");
    await db.sql.query("update xanom_handoffs set expires_at = now() - interval '1 second'");
    expect(await captureLink({ linkType: "sign-in", linkUrl: link(id), token: "t", email: "ada@example.com" })).toBe(false);
    expect(await takeToken(id)).toBeNull();
  });
});

describe("summary", () => {
  it("counts portfolios, watchlists, dashboards and brokerages for the linked user only", async () => {
    await addUser(ADA, "ada@example.com");
    await attach(ADA, "xa_ADA", "ada@example.com");
    await db.sql.query(`insert into portfolios (user_id, name, kind) values ($1, 'Main', 'holdings'), ($1, 'What if', 'paper'), ($1, 'Ideas', 'watchlist'), ($2, 'Theirs', 'holdings')`, [ADA, BOB]);
    await db.sql.query(`insert into watchlists (user_id, name, is_primary) values ($1, 'Watchlist', true)`, [ADA]);
    await db.sql.query(`insert into dashboards (user_id, name) values ($1, 'Wall')`, [ADA]);
    expect(await countsFor(ADA)).toEqual({ portfolios: 2, watchlists: 2, dashboards: 1, brokerages: 0 });

    const summary = await summaryFor("xa_ADA", "https://tickerquill.example/");
    expect(summary).toEqual({
      linked: true,
      headline: "2 portfolios · 2 watchlists",
      items: [{ label: "Portfolios", value: "2" }, { label: "Watchlists", value: "2" }, { label: "Dashboards", value: "1" }],
      recent: [],
      url: "https://tickerquill.example/",
    });
    // Counts only: no names of portfolios or lists.
    expect(JSON.stringify(summary)).not.toMatch(/Main|What if|Ideas|Wall/);
  });

  it("answers linked: false for an unknown sub", async () => {
    expect(await summaryFor("xa_NOBODY", "https://tickerquill.example/")).toEqual({ linked: false });
  });

  it("shows linked brokerages only when there are some, and says 1 portfolio", () => {
    const s = buildSummary({ portfolios: 1, watchlists: 0, dashboards: 0, brokerages: 2 }, "/");
    expect(s).toMatchObject({ headline: "1 portfolio · 0 watchlists" });
    expect(s.linked && s.items.at(-1)).toEqual({ label: "Linked brokerages", value: "2" });
  });
});
