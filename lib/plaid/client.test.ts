import { describe, expect, it } from "vitest";
import { toPlaidError } from "./client";

// The shape axios gives a failed Plaid call: the response carries Plaid's
// error, and the request config carries our secret and the access token.
const axiosError = Object.assign(new Error("Request failed with status code 400"), {
  response: { data: { error_code: "ITEM_LOGIN_REQUIRED", error_message: "the login details of this item have changed" } },
  config: { headers: { "PLAID-SECRET": "plaid-secret-value" }, data: '{"access_token":"access-production-abc"}' },
});

describe("toPlaidError", () => {
  it("keeps Plaid's error code and message", () => {
    const err = toPlaidError(axiosError);
    expect(err.code).toBe("ITEM_LOGIN_REQUIRED");
    expect(err.message).toBe("the login details of this item have changed");
  });

  it("drops the request, so secrets and tokens can't reach a log", () => {
    const err = toPlaidError(axiosError);
    const dumped = JSON.stringify({ ...err, message: err.message, stack: err.stack, cause: err.cause });
    expect(dumped).not.toContain("plaid-secret-value");
    expect(dumped).not.toContain("access-production-abc");
  });

  it("has no code for a failure that never reached Plaid", () => {
    const err = toPlaidError(new Error("getaddrinfo ENOTFOUND production.plaid.com"));
    expect(err.code).toBeNull();
    expect(err.message).toBe("Plaid could not be reached.");
  });
});
