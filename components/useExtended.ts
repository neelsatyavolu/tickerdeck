"use client";

import { useEffect, useMemo, useState } from "react";
import { api } from "@/lib/client/api";
import { isCrypto } from "@/lib/market/crypto";
import type { ExtendedQuote } from "@/lib/market/nasdaq";
import { session } from "@/lib/marketHours";
import type { LivePrice } from "./LivePrices";

const REFRESH_EVERY = 60_000;

export type ExtendedPrice = { session: "pre" | "after"; price: number; change: number | null; changePct: number | null; asOf: string };

/**
 * Pre-market and after-hours prices for these symbols. Nasdaq's snapshot is
 * polled outside the regular session; a fresher extended-hours trade from the
 * live feed wins.
 */
export function useExtended(symbols: string[], prices: Record<string, LivePrice>): Record<string, ExtendedPrice> {
  const key = [...new Set(symbols.filter((s) => !s.startsWith("^") && !isCrypto(s)))].sort().slice(0, 20).join(",");
  const [fetched, setFetched] = useState<{ key: string; rows: Record<string, ExtendedQuote> } | null>(null);

  useEffect(() => {
    if (!key) return;
    let cancelled = false;
    const load = () => {
      if (session() === "regular") return;
      api<Record<string, ExtendedQuote>>(`/api/market/extended?symbols=${encodeURIComponent(key)}`)
        .then((rows) => !cancelled && setFetched({ key, rows }))
        .catch((err) => console.warn("[extended]", err instanceof Error ? err.message : err));
    };
    load();
    const id = setInterval(load, REFRESH_EVERY);
    return () => {
      cancelled = true;
      clearInterval(id);
    };
  }, [key]);

  return useMemo(() => {
    const rows = fetched?.key === key ? fetched.rows : {};
    const out: Record<string, ExtendedPrice> = {};
    // Once the bell rings, yesterday's after-hours and today's pre-market are history.
    if (session() === "regular") return out;
    for (const s of key ? key.split(",") : []) {
      const live = prices[s];
      const snap = rows[s];
      const close = snap?.close ?? live?.price ?? null;
      if (live?.ext && close) {
        const sess = session(new Date(live.ext.time));
        const change = live.ext.price - close;
        out[s] = {
          session: sess === "pre" ? "pre" : "after",
          price: live.ext.price,
          change,
          changePct: change / close,
          asOf: new Date(live.ext.time).toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit", timeZone: "America/New_York" }) + " ET",
        };
      } else if (snap) {
        out[s] = { session: snap.session, price: snap.price, change: snap.change, changePct: snap.changePct, asOf: snap.asOf ?? "" };
      }
    }
    return out;
  }, [fetched, key, prices]);
}
