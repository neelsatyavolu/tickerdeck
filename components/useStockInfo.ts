"use client";

import { useEffect, useState } from "react";
import { cachedApi } from "@/lib/client/api";
import type { AnalystTargets, EarningsPoint, KeyStats, NewsItem, Profile, QuoteSnapshot, Recommendation, TargetPoint } from "@/lib/market/types";

type Panel<T> = { value: T | null; error: string | null };
export type StockInfo = {
  symbol: string;
  quote: Panel<QuoteSnapshot>;
  profile: Panel<Profile>;
  stats: Panel<KeyStats>;
  targets: Panel<{ targets: AnalystTargets; history: TargetPoint[] }>;
  recommendations: Panel<Recommendation[]>;
  news: Panel<NewsItem[]>;
  earnings: Panel<EarningsPoint[]>;
  peers: Panel<string[]>;
};

/** Stock details (same URL and cache as the stock page, so they share results). */
export function useStockInfo(symbol: string | undefined) {
  const [state, setState] = useState<{ symbol: string; info: StockInfo | null; error: string | null } | null>(null);
  useEffect(() => {
    if (!symbol) return;
    let cancelled = false;
    cachedApi<StockInfo>(`/api/market/stock/${encodeURIComponent(symbol)}`, 2 * 60_000)
      .then((info) => !cancelled && setState({ symbol, info, error: null }))
      .catch((err) => !cancelled && setState({ symbol, info: null, error: err instanceof Error ? err.message : "Unavailable" }));
    return () => {
      cancelled = true;
    };
  }, [symbol]);
  const current = state?.symbol === symbol ? state : null;
  return { info: current?.info ?? null, error: current?.error ?? null, loading: Boolean(symbol) && !current };
}
