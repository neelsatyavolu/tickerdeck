import { describe, expect, it } from "vitest";
import { mergeSearch } from "./sources";

const m = (symbol: string, name: string, type = "Stock") => ({ symbol, name, type });

describe("mergeSearch", () => {
  it("dedupes, puts the exact ticker first, and drops Nasdaq noise", () => {
    const out = mergeSearch(
      "DHT",
      [m("DHT", "DHT HOLDINGS INC"), m("DHT", "DHT Holdings Inc")],
      [m("DHT", "DHT Holdings, Inc."), m("DHTAX", "Diamond Hill All Cap Select Fund", "Mutual fund"), m("BMDHTXX", "BMO notes", "Mutual fund")],
    );
    expect(out.map((r) => r.symbol)).toEqual(["DHT", "DHTAX"]);
  });

  it("finds mutual funds Finnhub doesn't know", () => {
    expect(mergeSearch("vtsax", [], [m("VTSAX", "Vanguard Total Stock Market Index Fund Admiral Shares", "Mutual fund")])[0].symbol).toBe("VTSAX");
  });

  it("keeps name matches for company-name searches", () => {
    expect(mergeSearch("vanguard total", [], [m("BND", "Vanguard Total Bond Market ETF", "ETF")]).map((r) => r.symbol)).toEqual(["BND"]);
  });
});
