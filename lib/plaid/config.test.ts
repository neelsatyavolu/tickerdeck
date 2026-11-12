import { describe, expect, it } from "vitest";
import { plaidConfigFor, readPlaidConfig } from "./config";

const env = {
  PLAID_CLIENT_ID: "client-id",
  PLAID_SECRET: "secret",
  PLAID_TOKEN_KEY: "k".repeat(32),
  PLAID_OWNER_USER_ID: "owner-1",
};

describe("readPlaidConfig", () => {
  it("is off until every variable is set", () => {
    expect(readPlaidConfig({})).toBeNull();
    for (const missing of Object.keys(env)) expect(readPlaidConfig({ ...env, [missing]: "" })).toBeNull();
  });

  it("defaults to the sandbox, so production links are only spent on purpose", () => {
    expect(readPlaidConfig(env)).toEqual({ clientId: "client-id", secret: "secret", tokenKey: "k".repeat(32), ownerUserId: "owner-1", env: "sandbox" });
    expect(readPlaidConfig({ ...env, PLAID_ENV: "production" })?.env).toBe("production");
  });

  it("refuses a misspelt environment or a weak token key", () => {
    expect(() => readPlaidConfig({ ...env, PLAID_ENV: "prod" })).toThrow(/PLAID_ENV/);
    expect(() => readPlaidConfig({ ...env, PLAID_TOKEN_KEY: "short" })).toThrow(/PLAID_TOKEN_KEY/);
  });
});

describe("plaidConfigFor", () => {
  it("is only on for the owner", () => {
    expect(plaidConfigFor("owner-1", env)?.clientId).toBe("client-id");
    expect(plaidConfigFor("someone-else", env)).toBeNull();
    expect(plaidConfigFor("owner-1", {})).toBeNull();
  });
});
