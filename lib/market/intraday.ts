import type { IntradayRange, PricePoint } from "./types";

// Short chart ranges are drawn from minute bars rather than daily closes.
// "Days" are trading days: 1W is five sessions, 2W is ten.

/** Trading days shown, bar size, and how far back to ask so weekends and a holiday are covered. */
export const INTRADAY: Record<IntradayRange, { days: number; minutes: 1 | 5; lookbackDays: number }> = {
  "1d": { days: 1, minutes: 1, lookbackDays: 5 },
  "3d": { days: 3, minutes: 1, lookbackDays: 8 },
  "1w": { days: 5, minutes: 5, lookbackDays: 10 },
  "2w": { days: 10, minutes: 5, lookbackDays: 18 },
};

const OPEN_MIN = 9 * 60 + 30;
const CLOSE_MIN = 16 * 60;
const NEW_YORK = new Intl.DateTimeFormat("en-CA", { timeZone: "America/New_York", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hourCycle: "h23" });

function newYork(t: number): { date: string; minutes: number } {
  const parts = Object.fromEntries(NEW_YORK.formatToParts(t).map((p) => [p.type, p.value]));
  return { date: `${parts.year}-${parts.month}-${parts.day}`, minutes: Number(parts.hour) * 60 + Number(parts.minute) };
}

/** The regular-session bars (9:30 to 4:00 New York) of the last `days` trading days that have any. */
export function lastSessions(points: PricePoint[], days: number): PricePoint[] {
  const regular = points
    .map((point) => ({ point, ...newYork(point.t) }))
    .filter((b) => b.minutes >= OPEN_MIN && b.minutes <= CLOSE_MIN)
    .sort((a, b) => a.point.t - b.point.t);
  const keep = new Set([...new Set(regular.map((b) => b.date))].slice(-days));
  return regular.filter((b) => keep.has(b.date)).map((b) => b.point);
}

const PAGE_CANDLES = 300; // the most Coinbase returns per request

/** Request windows covering start to end, oldest first, each at most 300 candles of `seconds`. */
export function candleWindows(start: number, end: number, seconds: number): { start: number; end: number }[] {
  const step = PAGE_CANDLES * seconds * 1000;
  const windows: { start: number; end: number }[] = [];
  for (let from = start; from < end; from += step) windows.push({ start: from, end: Math.min(end, from + step) });
  return windows;
}

/** A stretch of time for a chart tooltip: "45 min", "2 h 30 min", "4 days". */
export function span(ms: number): string {
  const minutes = Math.round(ms / 60_000);
  if (minutes < 60) return `${minutes} min`;
  if (minutes < 24 * 60) return minutes % 60 ? `${Math.floor(minutes / 60)} h ${minutes % 60} min` : `${minutes / 60} h`;
  const days = Math.round(minutes / (24 * 60));
  return `${days} day${days === 1 ? "" : "s"}`;
}
