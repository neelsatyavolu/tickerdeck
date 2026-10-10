import { afterEach, describe, expect, it, vi } from "vitest";
import { candlePages, parseCandles, parseStats, spacer } from "./coinbase";

describe("parseStats", () => {
  it("uses the last trade as the price and the 24-hour open as the previous close", () => {
    expect(parseStats("BTC-USD", { open: "82369.12", last: "82953.11" }, 1_000)).toEqual({ symbol: "BTC-USD", price: 82953.11, prevClose: 82369.12, time: 1_000 });
  });

  it("returns null when a figure is missing or not a positive number", () => {
    expect(parseStats("BTC-USD", { open: "82369.12" }, 1)).toBeNull();
    expect(parseStats("BTC-USD", { open: "0", last: "5" }, 1)).toBeNull();
    expect(parseStats("BTC-USD", { open: "abc", last: "5" }, 1)).toBeNull();
  });
});

describe("parseCandles", () => {
  it("turns newest-first [time, low, high, open, close, volume] rows into ascending closes", () => {
    const rows = [
      [1791590400, 82458.02, 83093.39, 82544.71, 82942.22, 1355.83],
      [1791504000, 81534.02, 83452.99, 81692.79, 82544.71, 4446.62],
    ];
    expect(parseCandles(rows)).toEqual([
      { t: 1791504000_000, close: 82544.71, volume: 4446.62 },
      { t: 1791590400_000, close: 82942.22, volume: 1355.83 },
    ]);
  });

  it("drops malformed rows and tolerates a non-array body", () => {
    expect(parseCandles([[1791590400, 1, 2, 3, 0, 5], ["x"], null, [1791504000, 1, 2, 3, 4, 5]])).toEqual([{ t: 1791504000_000, close: 4, volume: 5 }]);
    expect(parseCandles({ message: "NotFound" })).toEqual([]);
  });
});

describe("candlePages", () => {
  const DAY = 86_400_000;

  it("covers the span in windows of at most 300 daily candles, newest first", () => {
    const end = Date.UTC(2026, 9, 10);
    const pages = candlePages(end, 700);
    expect(pages).toHaveLength(3);
    expect(pages[0].end).toBe(end);
    for (const p of pages) expect((p.end - p.start) / DAY).toBeLessThanOrEqual(299);
    expect(pages[pages.length - 1].start).toBe(end - 700 * DAY);
    // No gaps: each window starts a day after the next-older one ends.
    for (let i = 1; i < pages.length; i++) expect(pages[i - 1].start - pages[i].end).toBe(DAY);
  });

  it("snaps a mid-day end to that day's UTC midnight, so no daily candle falls between windows", () => {
    const midnight = Date.UTC(2026, 9, 10);
    const pages = candlePages(midnight + 18.75 * 3_600_000, 700);
    expect(pages[0].end).toBe(midnight);
    for (const p of pages) expect(p.start % DAY).toBe(0);
    for (let i = 1; i < pages.length; i++) expect(pages[i - 1].start - pages[i].end).toBe(DAY);
  });
});

describe("spacer", () => {
  afterEach(() => vi.useRealTimers());

  it("starts calls at least the gap apart, in order, and passes results and errors through", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(0);
    const spaced = spacer(125);
    const started: number[] = [];
    const call = (value: string) => spaced(async () => { started.push(Date.now()); return value; });
    const results = Promise.all([call("a"), call("b"), call("c")]);
    const failing = spaced(() => Promise.reject(new Error("boom")));
    const failed = expect(failing).rejects.toThrow("boom");
    await vi.advanceTimersByTimeAsync(1000);
    expect(await results).toEqual(["a", "b", "c"]);
    expect(started).toEqual([0, 125, 250]);
    await failed;
  });

  it("doesn't delay a call made after the line has cleared", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(0);
    const spaced = spacer(125);
    await spaced(async () => 1);
    vi.setSystemTime(5000);
    let ran = false;
    const p = spaced(async () => { ran = true; });
    expect(ran).toBe(true);
    await p;
  });
});
