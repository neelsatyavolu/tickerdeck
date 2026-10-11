import { afterEach, describe, expect, it, vi } from "vitest";
import { required } from "./env";

afterEach(() => vi.unstubAllEnvs());

describe("required", () => {
  it("returns the value of a setting that is present", () => {
    vi.stubEnv("RESEND_API_KEY", "re_123");
    expect(required("RESEND_API_KEY")).toBe("re_123");
  });

  it("names the setting when it is missing or empty", () => {
    vi.stubEnv("RESEND_API_KEY", "");
    expect(() => required("RESEND_API_KEY")).toThrow("RESEND_API_KEY is not set");
    expect(() => required("TICKERQUILL_NEVER_SET")).toThrow("TICKERQUILL_NEVER_SET is not set");
  });
});
