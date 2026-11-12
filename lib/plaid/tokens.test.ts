import { describe, expect, it } from "vitest";
import { openToken, sealToken } from "./tokens";

const key = "k".repeat(32);

describe("Plaid access token sealing", () => {
  it("round-trips without storing the token in the clear", () => {
    const sealed = sealToken(key, "user-1", "item-1", "access-production-abc");
    expect(sealed).not.toContain("access-production-abc");
    expect(openToken(key, "user-1", "item-1", sealed)).toBe("access-production-abc");
  });

  it("can't be opened for another user, another item or with another key", () => {
    const sealed = sealToken(key, "user-1", "item-1", "access-production-abc");
    expect(openToken(key, "user-2", "item-1", sealed)).toBeNull();
    expect(openToken(key, "user-1", "item-2", sealed)).toBeNull();
    expect(openToken("z".repeat(32), "user-1", "item-1", sealed)).toBeNull();
  });
});
