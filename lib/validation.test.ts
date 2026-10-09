import { describe, expect, it } from "vitest";
import { holdingInputSchema, symbolSchema } from "./validation";

describe("symbolSchema", () => {
  it("accepts tickers and known indexes", () => {
    expect(symbolSchema.parse(" brk.b ")).toBe("BRK.B");
    expect(symbolSchema.parse("^gspc")).toBe("^GSPC");
    expect(symbolSchema.safeParse("^NOPE").success).toBe(false);
    expect(symbolSchema.safeParse("1ABC").success).toBe(false);
  });
});

describe("holdingInputSchema", () => {
  it("rejects indexes with a helpful message", () => {
    const r = holdingInputSchema.safeParse({ symbol: "^GSPC", shares: 1, cost_basis: 1 });
    expect(r.success).toBe(false);
    expect(r.error?.issues[0].message).toMatch(/watchlist/);
    expect(holdingInputSchema.parse({ symbol: "vtsax", shares: "2", cost_basis: "100" }).symbol).toBe("VTSAX");
  });
});
