"use client";

import { useEffect, useState } from "react";
import { api, cachedApi } from "@/lib/client/api";
import { lastDays } from "@/lib/market/performance";
import type { HistoryRange, IntradayRange, PricePoint } from "@/lib/market/types";

type Loaded = { id: string; data: Record<string, PricePoint[]>; failed: string[] };
const EMPTY: Loaded = { id: "", data: {}, failed: [] };

const RANGE_DAYS: Record<HistoryRange, number> = { "1mo": 31, "3mo": 92, "6mo": 183, "1y": 366, "2y": 731, "5y": 1827, "10y": 3653 };
const HISTORY_TTL = 10 * 60_000;
const INTRADAY_EVERY = 60_000;

/**
 * Daily closes for several symbols; symbols that fail are reported, not fatal.
 * Always fetches the 10-year series (cached in the browser) and cuts the range
 * locally, so changing ranges or revisiting a page doesn't hit the network.
 */
export function useHistories(symbols: string[], range: HistoryRange) {
  const key = [...new Set(symbols)].sort().join(",");
  const id = `${key}|${range}`;
  const [loaded, setLoaded] = useState<Loaded>(EMPTY);

  useEffect(() => {
    if (!key) return;
    let cancelled = false;
    Promise.all(
      key.split(",").map((s) =>
        cachedApi<PricePoint[]>(`/api/market/history?symbol=${encodeURIComponent(s)}&range=10y`, HISTORY_TTL).then(
          (points) => [s, range === "10y" ? points : lastDays(points, RANGE_DAYS[range])] as const,
          () => [s, null] as const,
        ),
      ),
    ).then((results) => {
      if (cancelled) return;
      setLoaded({
        id: `${key}|${range}`,
        data: Object.fromEntries(results.filter(([, p]) => p !== null)) as Record<string, PricePoint[]>,
        failed: results.filter(([, p]) => p === null).map(([s]) => s),
      });
    });
    return () => {
      cancelled = true;
    };
  }, [key, range]);

  // While a new range loads, keep showing the previous one for the same symbols.
  const usable = key && loaded.id.startsWith(`${key}|`) ? loaded : EMPTY;
  return { data: usable.data, failed: usable.failed, loading: Boolean(key) && loaded.id !== id };
}

/**
 * Minute bars for one symbol while a short range is selected (null turns it
 * off). Refetched every minute in a visible tab so new bars keep arriving.
 */
export function useIntraday(symbol: string, range: IntradayRange | null) {
  const id = range ? `${symbol}|${range}` : "";
  const [loaded, setLoaded] = useState<{ id: string; points: PricePoint[]; failed: boolean }>({ id: "", points: [], failed: false });

  useEffect(() => {
    if (!range) return;
    let cancelled = false;
    const load = () =>
      api<PricePoint[]>(`/api/market/intraday?symbol=${encodeURIComponent(symbol)}&range=${range}`).then(
        (points) => !cancelled && setLoaded({ id: `${symbol}|${range}`, points, failed: false }),
        (err) => {
          console.warn("[history] intraday failed", err);
          // Keep bars already on screen if a later refresh fails.
          if (!cancelled) setLoaded((prev) => (prev.id === `${symbol}|${range}` ? prev : { id: `${symbol}|${range}`, points: [], failed: true }));
        },
      );
    load();
    const timer = setInterval(() => !document.hidden && load(), INTRADAY_EVERY);
    return () => {
      cancelled = true;
      clearInterval(timer);
    };
  }, [symbol, range]);

  const current = id !== "" && loaded.id === id;
  return { points: current ? loaded.points : [], failed: current && loaded.failed, loading: id !== "" && !current };
}
