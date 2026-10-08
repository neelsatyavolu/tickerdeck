"use client";

import { useEffect, useState } from "react";
import { api } from "@/lib/client/api";
import type { HistoryRange, PricePoint } from "@/lib/market/types";

type Loaded = { id: string; data: Record<string, PricePoint[]>; failed: string[] };
const EMPTY: Loaded = { id: "", data: {}, failed: [] };

/** Daily closes for several symbols; symbols that fail are reported, not fatal. */
export function useHistories(symbols: string[], range: HistoryRange) {
  const key = [...new Set(symbols)].sort().join(",");
  const id = `${key}|${range}`;
  const [loaded, setLoaded] = useState<Loaded>(EMPTY);

  useEffect(() => {
    if (!key) return;
    let cancelled = false;
    Promise.all(
      key.split(",").map((s) =>
        api<PricePoint[]>(`/api/market/history?symbol=${encodeURIComponent(s)}&range=${range}`).then(
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
  const usable = key && loaded.id.startsWith(`${key}|`) ? loaded : EMPTY;
  return { data: usable.data, failed: usable.failed, loading: Boolean(key) && loaded.id !== id };
}
