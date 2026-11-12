import { describe, expect, it } from "vitest";
import { decide, type AppUser, type LinkLookups } from "./linking";
import type { XanomUser } from "./oidc";

const XANOM: XanomUser = { sub: "xa_ADA", email: "ada@example.com", name: "Ada Lovelace" };

type World = { links?: Record<string, string>; users?: AppUser[]; pendingGuards?: string[] };

/** Lookups over a small in-memory world: links are userId -> sub. */
function lookups({ links = {}, users = [], pendingGuards = [] }: World): LinkLookups {
  return {
    userBySub: async (sub) => {
      const id = Object.entries(links).find(([, s]) => s === sub)?.[0];
      const user = users.find((u) => u.id === id);
      return id ? { id, email: user?.email ?? "?" } : null;
    },
    subOfUser: async (id) => links[id] ?? null,
    userByEmail: async (email) => users.find((u) => u.email === email.toLowerCase()) ?? null,
    guardPending: async (id) => pendingGuards.includes(id),
  };
}

const user = (id: string, email: string, over: Partial<AppUser> = {}): AppUser => ({ id, email, emailVerified: true, hasPassword: true, ...over });

describe("rule 1: a user already has this xanom_sub", () => {
  it("signs in as them, whatever their email is now", async () => {
    const db = lookups({ links: { u1: "xa_ADA" }, users: [user("u1", "old@example.com")] });
    expect(await decide(XANOM, "signin", null, db)).toEqual({ kind: "sign-in", userId: "u1", email: "old@example.com" });
  });

  it("wins over a different account with the same email", async () => {
    const db = lookups({ links: { u1: "xa_ADA" }, users: [user("u1", "old@example.com"), user("u2", "ada@example.com")] });
    expect(await decide(XANOM, "signin", null, db)).toMatchObject({ kind: "sign-in", userId: "u1" });
  });

  it("linking again from the same account changes nothing", async () => {
    const db = lookups({ links: { u1: "xa_ADA" }, users: [user("u1", "ada@example.com")] });
    expect(await decide(XANOM, "link", { id: "u1", email: "ada@example.com" }, db)).toEqual({ kind: "attach-current", userId: "u1" });
  });
});

describe("rule 2: link or convert while signed in", () => {
  const me = { id: "u1", email: "ada@example.com" };

  it("attaches the sub to the signed-in user", async () => {
    const db = lookups({ users: [user("u1", "ada@example.com")] });
    expect(await decide(XANOM, "convert", me, db)).toEqual({ kind: "attach-current", userId: "u1" });
    expect(await decide(XANOM, "link", me, db)).toEqual({ kind: "attach-current", userId: "u1" });
  });

  it("link allows a Xanom account under another email", async () => {
    const db = lookups({ users: [user("u1", "work@example.com")] });
    expect(await decide(XANOM, "link", { id: "u1", email: "work@example.com" }, db)).toEqual({ kind: "attach-current", userId: "u1" });
  });

  it("convert requires the same email", async () => {
    const db = lookups({ users: [user("u1", "work@example.com")] });
    expect(await decide(XANOM, "convert", { id: "u1", email: "work@example.com" }, db)).toEqual({ kind: "refuse", code: "email_mismatch" });
  });

  it("convert compares emails without case", async () => {
    const db = lookups({ users: [user("u1", "Ada@Example.com")] });
    expect(await decide(XANOM, "convert", { id: "u1", email: "Ada@Example.com" }, db)).toEqual({ kind: "attach-current", userId: "u1" });
  });

  it("refuses when the sub is already on another user, and never switches accounts", async () => {
    const db = lookups({ links: { u2: "xa_ADA" }, users: [user("u1", "ada@example.com"), user("u2", "x@example.com")] });
    expect(await decide(XANOM, "link", me, db)).toEqual({ kind: "refuse", code: "sub_taken" });
    expect(await decide(XANOM, "convert", me, db)).toEqual({ kind: "refuse", code: "sub_taken" });
  });

  it("refuses when the signed-in user is linked to a different Xanom account", async () => {
    const db = lookups({ links: { u1: "xa_OTHER" }, users: [user("u1", "ada@example.com")] });
    expect(await decide(XANOM, "link", me, db)).toEqual({ kind: "refuse", code: "already_linked" });
  });

  it("falls through to the other rules when nobody is signed in", async () => {
    const db = lookups({ users: [user("u9", "ada@example.com")] });
    expect(await decide(XANOM, "link", null, db)).toMatchObject({ kind: "attach-and-sign-in", userId: "u9" });
  });
});

describe("rule 3: an account with the same email", () => {
  it("attaches and signs in, without the guard when the email was verified", async () => {
    const db = lookups({ users: [user("u1", "ada@example.com", { emailVerified: true, hasPassword: true })] });
    expect(await decide(XANOM, "signin", null, db)).toEqual({ kind: "attach-and-sign-in", userId: "u1", email: "ada@example.com", guard: false });
  });

  it("guard: an unverified email with a password gets its password and sessions revoked", async () => {
    const db = lookups({ users: [user("u1", "ada@example.com", { emailVerified: false, hasPassword: true })] });
    expect(await decide(XANOM, "signin", null, db)).toEqual({ kind: "attach-and-sign-in", userId: "u1", email: "ada@example.com", guard: true });
  });

  it("guard: one that failed halfway runs again even though the email now looks verified", async () => {
    const db = lookups({ users: [user("u1", "ada@example.com", { emailVerified: true, hasPassword: true })], pendingGuards: ["u1"] });
    expect(await decide(XANOM, "signin", null, db)).toMatchObject({ kind: "attach-and-sign-in", guard: true });
  });

  it("no guard for an unverified account without a password", async () => {
    const db = lookups({ users: [user("u1", "ada@example.com", { emailVerified: false, hasPassword: false })] });
    expect(await decide(XANOM, "signin", null, db)).toMatchObject({ guard: false });
  });

  it("refuses when that account is linked to a different Xanom account", async () => {
    const db = lookups({ links: { u1: "xa_OTHER" }, users: [user("u1", "ada@example.com")] });
    expect(await decide(XANOM, "signin", null, db)).toEqual({ kind: "refuse", code: "email_linked_elsewhere" });
  });
});

describe("rule 4: nobody matches", () => {
  it("creates a user with the Xanom email and name", async () => {
    expect(await decide(XANOM, "signin", null, lookups({}))).toEqual({ kind: "create", email: "ada@example.com", name: "Ada Lovelace" });
  });

  it("falls back to the email's local part for a blank name", async () => {
    expect(await decide({ ...XANOM, name: "  " }, "signin", null, lookups({}))).toMatchObject({ kind: "create", name: "ada" });
  });

  it("ignores a signed-in user on a plain sign-in", async () => {
    const db = lookups({ users: [user("u1", "someone@example.com")] });
    expect(await decide(XANOM, "signin", { id: "u1", email: "someone@example.com" }, db)).toMatchObject({ kind: "create" });
  });
});
