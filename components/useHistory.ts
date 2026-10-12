"use client";

import { useEffect, useMemo, useState } from "react";
import { api } from "@/lib/client/api";
import { loadHistory, readHistory } from "@/lib/client/history";
import type { HistoryRange, IntradayRange, PricePoint } from "@/lib/market/types";

type Loaded = { id: string; data: Record<string, PricePoint[]>; failed: string[] };
const EMPTY: Loaded = { id: "", data: {}, failed: [] };

const INTRADAY_EVERY = 60_000;

/**
 * Daily closes for several symbols; symbols that fail are reported, not fatal.
 * Fetches the requested window, reusing wider cached series when available.
 * Short charts don't download ten years of data for every holding.
 */
export function useHistories(symbols: string[], range: HistoryRange) {
  const key = [...new Set(symbols)].sort().join(",");
  const id = `${key}|${range}`;
  const [loaded, setLoaded] = useState<Loaded>(EMPTY);
  const cached = useMemo(() => {
    if (!key) return null;
    const entries = key.split(",").map((s) => [s, readHistory(s, range)] as const);
    if (entries.some(([, points]) => points === undefined)) return null;
    return { id: `${key}|${range}`, data: Object.fromEntries(entries) as Record<string, PricePoint[]>, failed: [] };
  }, [key, range]);

  useEffect(() => {
    if (!key) return;
    let cancelled = false;
    Promise.all(
      key.split(",").map((s) =>
        loadHistory(s, range).then(
          (points) => [s, points] as const,
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
  const usable = cached ?? (key && loaded.id.startsWith(`${key}|`) ? loaded : EMPTY);
  return { data: usable.data, failed: usable.failed, loading: Boolean(key) && usable.id !== id };
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
