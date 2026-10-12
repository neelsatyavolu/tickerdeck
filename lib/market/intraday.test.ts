import { describe, expect, it } from "vitest";
import { candleWindows, INTRADAY, lastSessions, span } from "./intraday";

// New York is UTC-4 in October: 9:30 AM is 13:30 UTC and 4:00 PM is 20:00 UTC.
const at = (day: number, utc: string) => Date.parse(`2026-10-${String(day).padStart(2, "0")}T${utc}:00Z`);
const bar = (day: number, utc: string, close = 100) => ({ t: at(day, utc), close });

describe("lastSessions", () => {
  it("keeps only the regular session, open to close inclusive", () => {
    const bars = [bar(12, "08:00"), bar(12, "13:29"), bar(12, "13:30"), bar(12, "17:00"), bar(12, "20:00"), bar(12, "20:01"), bar(12, "23:00")];
    expect(lastSessions(bars, 1).map((b) => b.t)).toEqual([at(12, "13:30"), at(12, "17:00"), at(12, "20:00")]);
  });

  it("keeps the most recent trading days and skips the weekend between them", () => {
    const bars = [bar(8, "15:00"), bar(9, "15:00"), bar(9, "19:00"), bar(12, "14:00"), bar(12, "15:00")];
    expect(lastSessions(bars, 2).map((b) => b.t)).toEqual([at(9, "15:00"), at(9, "19:00"), at(12, "14:00"), at(12, "15:00")]);
    expect(lastSessions(bars, 10)).toHaveLength(5);
  });

  it("shows the last session before today's has started", () => {
    // Monday 8:00 AM ET: only pre-market bars exist for the 12th.
    const bars = [bar(9, "15:00"), bar(9, "19:00"), bar(12, "12:00")];
    expect(lastSessions(bars, 1).map((b) => b.t)).toEqual([at(9, "15:00"), at(9, "19:00")]);
  });

  it("returns nothing for a symbol with no intraday bars", () => {
    expect(lastSessions([], 3)).toEqual([]);
  });
});

describe("INTRADAY", () => {
  it("asks far enough back to cover weekends and a holiday", () => {
    for (const { days, lookbackDays } of Object.values(INTRADAY)) expect(lookbackDays).toBeGreaterThanOrEqual(Math.ceil((days * 7) / 5) + 3);
  });
});

describe("candleWindows", () => {
  it("splits a range into requests of at most 300 candles", () => {
    const hour = 3_600_000;
    const end = at(12, "20:00");
    const windows = candleWindows(end - 14 * 24 * hour, end, 3600);
    expect(windows).toHaveLength(2);
    expect(windows[0]).toEqual({ start: end - 336 * hour, end: end - 36 * hour });
    expect(windows[1]).toEqual({ start: end - 36 * hour, end });
    expect(candleWindows(end - 24 * hour, end, 300)).toHaveLength(1);
  });
});

describe("span", () => {
  it("describes a stretch of time in the largest sensible unit", () => {
    expect(span(45 * 60_000)).toBe("45 min");
    expect(span(60_000)).toBe("1 min");
    expect(span(150 * 60_000)).toBe("2 h 30 min");
    expect(span(3 * 3_600_000)).toBe("3 h");
    expect(span(26 * 3_600_000)).toBe("1 day");
    expect(span(4 * 86_400_000)).toBe("4 days");
  });
});
