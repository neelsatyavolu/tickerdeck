"use client";

import { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react";
import { listPortfolios } from "@/lib/client/portfolios";
import type { Portfolio } from "@/lib/portfolio/types";

type Ctx = {
  portfolios: Portfolio[];
  loading: boolean;
  error: string | null;
  refresh: () => Promise<void>;
  /** Runs a write, then reloads. Throws the write's error for the form to show. */
  mutate: <T>(fn: () => Promise<T>) => Promise<T>;
};

const PortfoliosCtx = createContext<Ctx | null>(null);

function load(): Promise<Portfolio[] | Error> {
  return listPortfolios().catch((err) => new Error(err instanceof Error ? err.message : "Could not load portfolios."));
}

export function PortfoliosProvider({ children }: { children: React.ReactNode }) {
  const [portfolios, setPortfolios] = useState<Portfolio[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const apply = useCallback((result: Portfolio[] | Error) => {
    if (result instanceof Error) setError(result.message);
    else {
      setPortfolios(result);
      setError(null);
    }
    setLoading(false);
  }, []);

  const refresh = useCallback(async () => apply(await load()), [apply]);

  useEffect(() => {
    let cancelled = false;
    load().then((r) => !cancelled && apply(r));
    return () => {
      cancelled = true;
    };
  }, [apply]);

  const mutate = useCallback(
    async <T,>(fn: () => Promise<T>) => {
      const result = await fn();
      await refresh();
      return result;
    },
    [refresh],
  );

  const value = useMemo(() => ({ portfolios, loading, error, refresh, mutate }), [portfolios, loading, error, refresh, mutate]);
  return <PortfoliosCtx.Provider value={value}>{children}</PortfoliosCtx.Provider>;
}

export function usePortfolios(): Ctx {
  const ctx = useContext(PortfoliosCtx);
  if (!ctx) throw new Error("usePortfolios must be used inside PortfoliosProvider");
  return ctx;
}
