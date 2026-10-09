"use client";

import { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react";
import { createSerialQueue } from "@/lib/client/serial";
import * as client from "@/lib/client/watchlist";
import type { WatchItem } from "@/lib/client/watchlist";

type Ctx = {
  items: WatchItem[];
  loading: boolean;
  error: string | null;
  isWatched: (symbol: string) => boolean;
  add: (symbol: string, name?: string | null) => Promise<void>;
  remove: (symbol: string) => Promise<void>;
  /** Save a new order (symbols top to bottom). */
  reorder: (symbols: string[]) => Promise<void>;
};

const WatchlistCtx = createContext<Ctx | null>(null);
const saves = createSerialQueue();

function load(): Promise<WatchItem[] | Error> {
  return client.listWatchlist().catch((err) => new Error(err instanceof Error ? err.message : "Could not load the watchlist."));
}

export function WatchlistProvider({ children }: { children: React.ReactNode }) {
  const [items, setItems] = useState<WatchItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const apply = useCallback((r: WatchItem[] | Error) => {
    if (r instanceof Error) setError(r.message);
    else {
      setItems(r);
      setError(null);
    }
    setLoading(false);
  }, []);

  useEffect(() => {
    let cancelled = false;
    load().then((r) => !cancelled && apply(r));
    return () => {
      cancelled = true;
    };
  }, [apply]);

  // Optimistic: the list updates at once and rolls back if the server refuses.
  const add = useCallback(
    async (symbol: string, name?: string | null) => {
      setItems((prev) => (prev.some((i) => i.symbol === symbol) ? prev : [...prev, { symbol, name: name ?? null, added_at: new Date().toISOString() }]));
      try {
        await client.addToWatchlist(symbol, name);
      } catch (err) {
        apply(await load());
        throw err;
      }
    },
    [apply],
  );

  const remove = useCallback(
    async (symbol: string) => {
      setItems((prev) => prev.filter((i) => i.symbol !== symbol));
      try {
        await client.removeFromWatchlist(symbol);
      } catch (err) {
        apply(await load());
        throw err;
      }
    },
    [apply],
  );

  const reorder = useCallback(
    async (symbols: string[]) => {
      setItems((prev) => {
        const bySymbol = new Map(prev.map((i) => [i.symbol, i]));
        const ordered = symbols.map((s) => bySymbol.get(s)).filter((i): i is WatchItem => Boolean(i));
        return [...ordered, ...prev.filter((i) => !symbols.includes(i.symbol))];
      });
      try {
        await saves(() => client.reorderWatchlist(symbols));
      } catch (err) {
        apply(await load());
        throw err;
      }
    },
    [apply],
  );

  const isWatched = useCallback((symbol: string) => items.some((i) => i.symbol === symbol), [items]);
  const value = useMemo(() => ({ items, loading, error, isWatched, add, remove, reorder }), [items, loading, error, isWatched, add, remove, reorder]);
  return <WatchlistCtx.Provider value={value}>{children}</WatchlistCtx.Provider>;
}

export function useWatchlist(): Ctx {
  const ctx = useContext(WatchlistCtx);
  if (!ctx) throw new Error("useWatchlist must be used inside WatchlistProvider");
  return ctx;
}

/** Toggle for a stock page or a search result. */
export function WatchButton({ symbol, name }: { symbol: string; name?: string | null }) {
  const { isWatched, add, remove, loading } = useWatchlist();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const watched = isWatched(symbol);
  const toggle = async () => {
    setBusy(true);
    setError(null);
    try {
      if (watched) await remove(symbol);
      else await add(symbol, name);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Couldn't update the watchlist.");
    } finally {
      setBusy(false);
    }
  };
  return (
    <>
      <button className="btn btn-ghost" onClick={toggle} disabled={busy || loading} aria-pressed={watched}>
        {watched ? (
          <>
            <span className="dot live" aria-hidden="true" /> Watching
          </>
        ) : (
          "Watch"
        )}
      </button>
      {error && <span className="error">{error}</span>}
    </>
  );
}
