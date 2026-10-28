import { describe, expect, it } from "vitest";
import { applySnapshot, applyTrade } from "./livePrice";

// Times in UTC; New York is UTC-4 in October.
const CLOSE = Date.parse("2026-10-28T20:00:00Z"); // Wed 4:00 PM ET
const AFTER = Date.parse("2026-10-28T20:05:00Z"); // 4:05 PM ET
const MIDDAY = Date.parse("2026-10-28T16:00:00Z"); // noon ET
const snapshot = { symbol: "GOOG", price: 321.89, prevClose: 316.83, time: CLOSE };

describe("applyTrade", () => {
  it("moves the regular price during the session", () => {
    expect(applyTrade(undefined, 320, MIDDAY)).toEqual({ price: 320, prevClose: 320, time: MIDDAY, fromTrade: true });
  });

  it("puts an after-hours print beside the regular price", () => {
    const cur = applySnapshot(undefined, snapshot);
    expect(applyTrade(cur, 299.67, AFTER)).toEqual({ ...cur, ext: { price: 299.67, time: AFTER } });
  });

  it("ignores an after-hours print that arrives before any regular price", () => {
    expect(applyTrade(undefined, 299.67, AFTER)).toBeUndefined();
  });
});

describe("applySnapshot", () => {
  it("keeps the closing price when an after-hours print came first", () => {
    const first = applyTrade(undefined, 299.67, AFTER);
    const merged = applyTrade(applySnapshot(first, snapshot), 298.76, AFTER + 60_000);
    expect(merged?.price).toBe(321.89);
    expect(merged?.prevClose).toBe(316.83);
    expect(merged?.ext).toEqual({ price: 298.76, time: AFTER + 60_000 });
  });

  it("keeps a fresher regular trade and takes the snapshot's previous close", () => {
    const cur = applyTrade(undefined, 320, CLOSE - 1000);
    expect(applySnapshot(cur, { ...snapshot, time: MIDDAY })).toEqual({ price: 320, prevClose: 316.83, time: CLOSE - 1000, fromTrade: true });
  });
});
