"use client";

import { useEffect, useState } from "react";
import { loadOverviews } from "@/lib/client/overviews";
import type { Overview } from "@/lib/market/overview";

/** Sparkline, returns and 52-week range per symbol (browser-cached for 5 minutes). */
export function useOverviews(symbols: string[]) {
  const key = [...new Set(symbols)].sort().join(",");
  const [data, setData] = useState<{ key: string; map: Record<string, Overview | null> } | null>(null);
  useEffect(() => {
    if (!key) return;
    let cancelled = false;
    loadOverviews(key.split(","))
      .then((map) => !cancelled && setData((prev) => ({ key, map: { ...(prev?.map ?? {}), ...map } })))
      .catch(() => !cancelled && setData((prev) => ({ key, map: prev?.map ?? {} })));
    return () => {
      cancelled = true;
    };
  }, [key]);
  return { map: data?.map ?? {}, ready: !key || data?.key === key };
}
