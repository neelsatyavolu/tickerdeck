import { describe, expect, it } from "vitest";
import {
  errorOf,
  LOGIN_AFTER_RESET,
  NETWORK_MESSAGE,
  passwordChangedNotice,
  RATE_LIMIT_MESSAGE,
  readResetToken,
  requestFailure,
  resetFailure,
  resetRedirect,
} from "./passwordReset";

const params = (query: string) => new URLSearchParams(query);

/** What the Neon Auth client throws for a refused call: an Error carrying the HTTP status and its own code. */
const refused = (status: number, code: string, message = "refused") => Object.assign(new Error(message), { status, code });
/** What `fetch` throws when the request never got an answer. */
const offline = () => new TypeError("Failed to fetch");

describe("resetRedirect", () => {
  it("points the emailed link back at this site's reset page", () => {
    expect(resetRedirect("https://tickerquill.n3el.dev")).toBe("https://tickerquill.n3el.dev/login/reset");
    expect(resetRedirect("http://localhost:3000")).toBe("http://localhost:3000/login/reset");
  });
});

describe("errorOf", () => {
  it("is null when the call succeeds", async () => {
    expect(await errorOf(async () => ({ data: { status: true }, error: null }))).toBeNull();
  });

  it("returns the error whether the client reports it or throws it", async () => {
    const reported = { status: 429, message: "Too many requests" };
    expect(await errorOf(async () => ({ data: null, error: reported }))).toBe(reported);
    const thrown = refused(429, "over_request_rate_limit");
    expect(await errorOf(async () => { throw thrown; })).toBe(thrown);
  });

  it("never mistakes a thrown empty value for success", async () => {
    expect(await errorOf(async () => { throw undefined; })).toBeInstanceOf(Error);
  });
});

describe("requestFailure", () => {
  it("is silent on success", () => {
    expect(requestFailure(null)).toBeNull();
  });

  it("is silent on every answer that could depend on whether the account exists", () => {
    for (const error of [
      refused(404, "user_not_found", "User not found"),
      refused(400, "validation_failed"),
      refused(422, "email_not_confirmed"),
      refused(500, "unexpected_failure", "Webhook delivery failed"),
      refused(502, "unexpected_failure"),
      { status: 400, code: "USER_NOT_FOUND", message: "User not found" },
    ]) expect(requestFailure(error)).toBeNull();
  });

  it("reports rate limiting", () => {
    expect(requestFailure(refused(429, "over_request_rate_limit", "Too many requests"))).toBe(RATE_LIMIT_MESSAGE);
    expect(requestFailure({ status: 429 })).toBe(RATE_LIMIT_MESSAGE);
  });

  it("reports a request that got no answer at all", () => {
    expect(requestFailure(offline())).toBe(NETWORK_MESSAGE);
    expect(requestFailure("boom")).toBe(NETWORK_MESSAGE);
  });
});

describe("readResetToken", () => {
  it("returns the token from the link", () => {
    expect(readResetToken(params("token=abc123"))).toBe("abc123");
  });

  it("returns null when the token is missing or empty", () => {
    expect(readResetToken(params(""))).toBeNull();
    expect(readResetToken(params("token="))).toBeNull();
  });

  it("returns null when the sign-in service rejected the link", () => {
    expect(readResetToken(params("error=INVALID_TOKEN"))).toBeNull();
    expect(readResetToken(params("error=INVALID_TOKEN&token=abc123"))).toBeNull();
  });
});

describe("resetFailure", () => {
  it("treats a rejected token as an expired link, however the client words it", () => {
    expect(resetFailure(refused(401, "bad_jwt", "Invalid or expired session token"))).toEqual({ expired: true });
    expect(resetFailure(refused(400, "validation_failed", "Invalid token"))).toEqual({ expired: true });
    expect(resetFailure({ status: 400, code: "INVALID_TOKEN", message: "Invalid token" })).toEqual({ expired: true });
  });

  it("reports rate limiting and a request that got no answer", () => {
    expect(resetFailure(refused(429, "over_request_rate_limit"))).toEqual({ expired: false, message: RATE_LIMIT_MESSAGE });
    expect(resetFailure(offline())).toEqual({ expired: false, message: NETWORK_MESSAGE });
  });

  it("passes on the service's own message, such as a password rule", () => {
    const weak = refused(400, "weak_password", "Password does not meet security requirements");
    expect(resetFailure(weak)).toEqual({ expired: false, message: "Password does not meet security requirements" });
  });

  it("falls back to a plain message", () => {
    expect(resetFailure({ status: 500 })).toEqual({ expired: false, message: "Could not change the password. Try again." });
    expect(resetFailure(refused(500, "unexpected_failure", ""))).toEqual({ expired: false, message: "Could not change the password. Try again." });
  });
});

describe("passwordChangedNotice", () => {
  it("is shown on the login page right after a reset", () => {
    const query = LOGIN_AFTER_RESET.split("?")[1];
    expect(LOGIN_AFTER_RESET.startsWith("/login?")).toBe(true);
    expect(passwordChangedNotice(params(query))).toBe("Password changed. Sign in with the new one.");
  });

  it("is absent otherwise", () => {
    expect(passwordChangedNotice(params(""))).toBeNull();
    expect(passwordChangedNotice(params("next=/p/1"))).toBeNull();
    expect(passwordChangedNotice(params("reset=nope"))).toBeNull();
  });
});
