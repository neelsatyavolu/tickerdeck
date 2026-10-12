import { describe, expect, it } from "vitest";
import { mergeSearch, settleDay } from "./sources";

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

describe("settleDay", () => {
  // New York is UTC-4 in October. Friday's close is stamped 20:00 UTC.
  const fridayNav = { symbol: "VTSAX", price: 185.93, prevClose: 184.77, time: Date.UTC(2026, 9, 9, 20) };

  it("shows no move once a new trading day has opened and the quote is still the last one's", () => {
    expect(settleDay(fridayNav, new Date("2026-10-12T17:00:00Z"))).toEqual({ ...fridayNav, prevClose: 185.93 }); // Mon 1:00 PM ET
    expect(settleDay(fridayNav, new Date("2026-10-12T21:30:00Z")).prevClose).toBe(185.93); // Mon 5:30 PM ET, NAV not posted
  });

  it("keeps the move for a quote from today", () => {
    const today = { symbol: "VGT", price: 126.51, prevClose: 127.98, time: Date.UTC(2026, 9, 12, 17) };
    expect(settleDay(today, new Date("2026-10-12T17:00:05Z"))).toBe(today);
    const mondayNav = { ...fridayNav, price: 186.5, prevClose: 185.93, time: Date.UTC(2026, 9, 12, 20) };
    expect(settleDay(mondayNav, new Date("2026-10-12T23:00:00Z"))).toBe(mondayNav); // Mon 7:00 PM ET
  });

  it("keeps the last move before the open and at weekends", () => {
    expect(settleDay(fridayNav, new Date("2026-10-12T13:00:00Z"))).toBe(fridayNav); // Mon 9:00 AM ET
    expect(settleDay(fridayNav, new Date("2026-10-10T17:00:00Z"))).toBe(fridayNav); // Saturday
  });
});
