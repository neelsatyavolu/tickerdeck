import { afterEach, describe, expect, it, vi } from "vitest";

const session = vi.hoisted(() => ({ user: null as { id: string; email: string } | null }));
vi.mock("../auth/server", () => ({ currentUser: async () => session.user }));

import { redirectUri, withPlaid } from "./route";

const configured = { PLAID_CLIENT_ID: "client-id", PLAID_SECRET: "secret", PLAID_TOKEN_KEY: "k".repeat(32), PLAID_OWNER_USER_ID: "owner-1" };
const setEnv = (env: Record<string, string>) => Object.entries(env).forEach(([k, v]) => vi.stubEnv(k, v));
const signIn = (id: string | null) => (session.user = id ? { id, email: `${id}@tickerdeck.test` } : null);

afterEach(() => {
  vi.unstubAllEnvs();
  signIn(null);
});

describe("withPlaid", () => {
  it("runs for the owner", async () => {
    setEnv(configured);
    signIn("owner-1");
    const res = await withPlaid(async ({ user, plaid }) => Response.json({ id: user.id, sealed: plaid.tokenKey.length }));
    expect(await res.json()).toEqual({ id: "owner-1", sealed: 32 });
  });

  it("answers 404 to any other signed-in user without running the handler", async () => {
    setEnv(configured);
    signIn("someone-else");
    const handler = vi.fn(async () => Response.json({}));
    const res = await withPlaid(handler);
    expect(res.status).toBe(404);
    expect(handler).not.toHaveBeenCalled();
  });

  it("answers 404 when Plaid isn't set up, even to the owner", async () => {
    setEnv({ ...configured, PLAID_SECRET: "" });
    signIn("owner-1");
    expect((await withPlaid(async () => Response.json({}))).status).toBe(404);
  });

  it("answers 401 when signed out", async () => {
    setEnv(configured);
    expect((await withPlaid(async () => Response.json({}))).status).toBe(401);
  });
});

describe("redirectUri", () => {
  it("is the OAuth return page on the address the request came to", () => {
    expect(redirectUri(new Request("https://tickerdeck.test/api/plaid/link-token", { method: "POST" }))).toBe("https://tickerdeck.test/plaid/oauth");
  });
});
