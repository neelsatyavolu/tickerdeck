import { describe, expect, it } from "vitest";
import { normalizeListingSymbol, toListings } from "./listings";

describe("listings", () => {
  it("normalizes share classes and skips odd symbols", () => {
    expect(normalizeListingSymbol("BRK/A")).toBe("BRK.A");
    expect(normalizeListingSymbol("BAC^K")).toBeNull();
  });

  it("merges stocks and ETFs, cleaning names", () => {
    const l = toListings(
      [{ symbol: "NKE", name: "Nike, Inc. Common Stock", marketCap: "110000000000.00" }, { symbol: "BRK/A", name: "Berkshire Hathaway Inc.", marketCap: "1" }],
      [{ symbol: "SPY", companyName: "SPDR S&P 500 ETF Trust" }, { symbol: "NKE", companyName: "dupe" }],
    );
    expect(l).toEqual([
      ["NKE", "Nike, Inc.", "Stock", 110000000000],
      ["BRK.A", "Berkshire Hathaway Inc.", "Stock", 1],
      ["SPY", "SPDR S&P 500 ETF Trust", "ETF", 0],
    ]);
  });
});
