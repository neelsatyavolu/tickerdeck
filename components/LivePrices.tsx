"use client";

import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from "react";
import { api } from "@/lib/client/api";
import type { QuoteSnapshot } from "@/lib/market/types";

// Live prices: a REST snapshot for previous close and a starting price, then
// Finnhub's trade WebSocket on top. Snapshots refresh every minute as a
// fallback for when the socket is down or the market is closed.

export type LivePrice = { price: number; prevClose: number; time: number; fromTrade: boolean };
export type FeedStatus = "connecting" | "live" | "quiet" | "offline";

type Ctx = {
  prices: Record<string, LivePrice>;
  /** Symbols a snapshot has answered for, priced or not (lets loaders stop waiting). */
  checked: Record<string, true>;
  status: FeedStatus;
  lastTrade: number | null;
  watch: (symbols: string[]) => () => void;
};

const LiveCtx = createContext<Ctx | null>(null);
const SNAPSHOT_EVERY = 60_000;
const FLUSH_EVERY = 400;
const QUIET_AFTER = 90_000;
const SNAPSHOT_BATCH = 50;
const SYMBOL_RE = /^([A-Z][A-Z0-9.-]{0,9}|\^[A-Z0-9]{2,6})$/;
// Indexes (^GSPC) aren't on Finnhub's free trade stream; they refresh by snapshot.
const streamable = (s: string) => !s.startsWith("^");

export function LivePricesProvider({ children }: { children: React.ReactNode }) {
  const [prices, setPrices] = useState<Record<string, LivePrice>>({});
  const [checked, setChecked] = useState<Record<string, true>>({});
  const [watched, setWatched] = useState<string[]>([]);
  const [socketOpen, setSocketOpen] = useState(false);
  const [lastTrade, setLastTrade] = useState<number | null>(null);
  const [now, setNow] = useState(() => Date.now());
  const counts = useRef(new Map<string, number>());
  const ws = useRef<WebSocket | null>(null);
  const subscribed = useRef(new Set<string>());
  const pending = useRef(new Map<string, { p: number; t: number }>());

  const watch = useCallback((symbols: string[]) => {
    const list = [...new Set(symbols.filter(Boolean))];
    for (const s of list) counts.current.set(s, (counts.current.get(s) ?? 0) + 1);
    setWatched([...counts.current.keys()].sort());
    return () => {
      for (const s of list) {
        const n = (counts.current.get(s) ?? 1) - 1;
        if (n <= 0) counts.current.delete(s);
        else counts.current.set(s, n);
      }
      setWatched([...counts.current.keys()].sort());
    };
  }, []);

  const watchedKey = watched.join(",");

  // REST snapshots: immediately for new symbols, then every minute.
  useEffect(() => {
    if (!watchedKey) return;
    let cancelled = false;
    const load = async () => {
      try {
        // Skip malformed symbols and stay under the route's 50-symbol limit,
        // so one bad ticker never blanks every price.
        const valid = watchedKey.split(",").filter((s) => SYMBOL_RE.test(s));
        const batches: string[][] = [];
        for (let i = 0; i < valid.length; i += SNAPSHOT_BATCH) batches.push(valid.slice(i, i + SNAPSHOT_BATCH));
        const results = await Promise.all(
          batches.map((b) =>
            api<{ quotes: QuoteSnapshot[] }>(`/api/market/quotes?symbols=${encodeURIComponent(b.join(","))}`).catch((err) => {
              console.warn("[prices] snapshot batch failed", err);
              return { quotes: [] as QuoteSnapshot[] };
            }),
          ),
        );
        const quotes = results.flatMap((r) => r.quotes);
        if (cancelled) return;
        setChecked((prev) => ({ ...prev, ...Object.fromEntries(watchedKey.split(",").map((s) => [s, true as const])) }));
        setPrices((prev) => {
          const next = { ...prev };
          for (const q of quotes) {
            const cur = prev[q.symbol];
            // Keep a fresher trade price; always take the snapshot's previous close.
            next[q.symbol] = cur?.fromTrade && cur.time > q.time ? { ...cur, prevClose: q.prevClose } : { price: q.price, prevClose: q.prevClose, time: q.time, fromTrade: false };
          }
          return next;
        });
      } catch (err) {
        console.warn("[prices] snapshot failed", err);
        if (!cancelled) setChecked((prev) => ({ ...prev, ...Object.fromEntries(watchedKey.split(",").map((s) => [s, true as const])) }));
      }
    };
    load();
    const id = setInterval(load, SNAPSHOT_EVERY);
    return () => {
      cancelled = true;
      clearInterval(id);
    };
  }, [watchedKey]);

  // One WebSocket for the whole app, reconnecting with backoff.
  useEffect(() => {
    let closed = false;
    let retry = 0;
    let timer: ReturnType<typeof setTimeout> | undefined;

    const connect = async () => {
      let key: string;
      try {
        key = (await api<{ key: string }>("/api/market/key")).key;
      } catch (err) {
        console.warn("[prices] no stream key", err);
        timer = setTimeout(connect, 30_000);
        return;
      }
      if (closed) return;
      const socket = new WebSocket(`wss://ws.finnhub.io?token=${encodeURIComponent(key)}`);
      ws.current = socket;
      socket.onopen = () => {
        retry = 0;
        setSocketOpen(true);
        subscribed.current.clear();
        for (const s of [...counts.current.keys()].filter(streamable)) {
          socket.send(JSON.stringify({ type: "subscribe", symbol: s }));
          subscribed.current.add(s);
        }
      };
      socket.onmessage = (ev) => {
        try {
          const msg = JSON.parse(String(ev.data)) as { type?: string; data?: { s: string; p: number; t: number }[] };
          if (msg.type !== "trade" || !msg.data) return;
          for (const tr of msg.data) {
            const prev = pending.current.get(tr.s);
            if (!prev || tr.t >= prev.t) pending.current.set(tr.s, { p: tr.p, t: tr.t });
          }
        } catch {
          /* ignore malformed frames */
        }
      };
      socket.onclose = () => {
        setSocketOpen(false);
        ws.current = null;
        if (closed) return;
        const delay = Math.min(30_000, 1000 * 2 ** retry++);
        timer = setTimeout(connect, delay);
      };
      socket.onerror = () => socket.close();
    };

    connect();
    return () => {
      closed = true;
      clearTimeout(timer);
      ws.current?.close();
    };
  }, []);

  // Keep socket subscriptions in step with what pages are watching.
  useEffect(() => {
    const socket = ws.current;
    if (!socket || socket.readyState !== WebSocket.OPEN) return;
    const want = new Set(watched.filter(streamable));
    for (const s of want) {
      if (!subscribed.current.has(s)) {
        socket.send(JSON.stringify({ type: "subscribe", symbol: s }));
        subscribed.current.add(s);
      }
    }
    for (const s of [...subscribed.current]) {
      if (!want.has(s)) {
        socket.send(JSON.stringify({ type: "unsubscribe", symbol: s }));
        subscribed.current.delete(s);
      }
    }
  }, [watched, socketOpen]);

  // Batch trade updates so a busy tape doesn't re-render on every print.
  useEffect(() => {
    const id = setInterval(() => {
      setNow(Date.now());
      if (pending.current.size === 0) return;
      const batch = new Map(pending.current);
      pending.current.clear();
      setPrices((prev) => {
        const next = { ...prev };
        for (const [s, { p, t }] of batch) {
          const cur = prev[s];
          if (!cur || t >= cur.time) next[s] = { price: p, prevClose: cur?.prevClose ?? p, time: t, fromTrade: true };
        }
        return next;
      });
      setLastTrade((prev) => Math.max(prev ?? 0, ...[...batch.values()].map((v) => v.t)));
    }, FLUSH_EVERY);
    return () => clearInterval(id);
  }, []);

  const status: FeedStatus = !socketOpen
    ? lastTrade === null && Object.keys(prices).length === 0 ? "connecting" : "offline"
    : lastTrade !== null && now - lastTrade < QUIET_AFTER ? "live" : "quiet";

  const value = useMemo(() => ({ prices, checked, status, lastTrade, watch }), [prices, checked, status, lastTrade, watch]);
  return <LiveCtx.Provider value={value}>{children}</LiveCtx.Provider>;
}

function useLiveCtx(): Ctx {
  const ctx = useContext(LiveCtx);
  if (!ctx) throw new Error("useLivePrices must be used inside LivePricesProvider");
  return ctx;
}

/** Subscribe to live prices for these symbols while the component is mounted. */
export function useLivePrices(symbols: string[]) {
  const { prices, checked, status, lastTrade, watch } = useLiveCtx();
  const key = [...new Set(symbols)].sort().join(",");
  useEffect(() => (key ? watch(key.split(",")) : undefined), [key, watch]);
  return { prices, checked, status, lastTrade };
}

export function useFeedStatus() {
  const { status, lastTrade } = useLiveCtx();
  return { status, lastTrade };
}
