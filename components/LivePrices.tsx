"use client";

import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from "react";
import { api } from "@/lib/client/api";
import { isCrypto } from "@/lib/market/crypto";
import type { QuoteSnapshot } from "@/lib/market/types";
import { session } from "@/lib/marketHours";

// Live prices: a REST snapshot for previous close and a starting price, then
// shared trade WebSocket on top. Snapshots refresh every minute as a
// fallback for when the socket is down or the market is closed. Crypto isn't
// on the stream, so its snapshots refresh every 15 seconds instead, and
// indexes (no free feed streams the Dow or S&P) every 5.

/** `price` is the regular session; trades before 9:30 or after 4:00 ET go to `ext`. */
export type LivePrice = { price: number; prevClose: number; time: number; fromTrade: boolean; ext?: { price: number; time: number } };
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
const CRYPTO_EVERY = 15_000;
const INDEX_EVERY = 5_000;
const isIndex = (s: string) => s.startsWith("^");
const FLUSH_EVERY = 400;
const QUIET_AFTER = 90_000;
const SNAPSHOT_BATCH = 50;
const SYMBOL_RE = /^([A-Z][A-Z0-9.-]{0,9}|\^[A-Z0-9]{2,6})$/;
// Indexes (^GSPC) aren't on Finnhub's free trade stream and crypto (BTC-USD)
// isn't a stock symbol there; both refresh by snapshot.
const streamable = (s: string) => !isIndex(s) && !isCrypto(s);

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

  // REST snapshots: immediately for new symbols, then every minute (crypto every 15 seconds, indexes every 5).
  useEffect(() => {
    if (!watchedKey) return;
    let cancelled = false;
    const all = watchedKey.split(",");
    const coins = all.filter(isCrypto);
    const indexes = all.filter(isIndex);
    const load = async (symbols: string[]) => {
      try {
        // Skip malformed symbols and stay under the route's 50-symbol limit,
        // so one bad ticker never blanks every price.
        const valid = symbols.filter((s) => SYMBOL_RE.test(s));
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
        setChecked((prev) => ({ ...prev, ...Object.fromEntries(symbols.map((s) => [s, true as const])) }));
        setPrices((prev) => {
          const next = { ...prev };
          for (const q of quotes) {
            const cur = prev[q.symbol];
            // Keep a fresher trade price; always take the snapshot's previous close.
            next[q.symbol] = cur?.fromTrade && cur.time > q.time ? { ...cur, prevClose: q.prevClose } : { price: q.price, prevClose: q.prevClose, time: q.time, fromTrade: false, ext: cur?.ext };
          }
          return next;
        });
      } catch (err) {
        console.warn("[prices] snapshot failed", err);
        if (!cancelled) setChecked((prev) => ({ ...prev, ...Object.fromEntries(symbols.map((s) => [s, true as const])) }));
      }
    };
    load(all);
    const id = setInterval(() => load(all), SNAPSHOT_EVERY);
    const coinId = coins.length > 0 ? setInterval(() => load(coins), CRYPTO_EVERY) : undefined;
    // Index levels only move in the regular session; skipping hidden tabs keeps an always-on display cheap.
    const indexId = indexes.length > 0 ? setInterval(() => !document.hidden && session() === "regular" && load(indexes), INDEX_EVERY) : undefined;
    return () => {
      cancelled = true;
      clearInterval(id);
      clearInterval(coinId);
      clearInterval(indexId);
    };
  }, [watchedKey]);

  // Browsers share one backend Finnhub connection, reconnecting with backoff.
  useEffect(() => {
    let closed = false;
    let retry = 0;
    let timer: ReturnType<typeof setTimeout> | undefined;

    const connect = async () => {
      let url: string;
      try {
        url = (await api<{ url: string }>("/api/market/stream")).url;
      } catch (err) {
        if (closed) return;
        console.warn("[prices] stream unavailable", err);
        timer = setTimeout(connect, 30_000);
        return;
      }
      if (closed) return;
      const socket = new WebSocket(url);
      ws.current = socket;
      socket.onopen = () => {
        if (closed) return;
        subscribed.current.clear();
        for (const s of [...counts.current.keys()].filter(streamable)) {
          socket.send(JSON.stringify({ type: "subscribe", symbol: s }));
          subscribed.current.add(s);
        }
      };
      socket.onmessage = (ev) => {
        try {
          if (closed) return;
          const msg = JSON.parse(String(ev.data)) as { type?: string; connected?: boolean; message?: string; data?: { s: string; p: number; t: number }[] };
          if (msg.type === "status") {
            setSocketOpen(msg.connected === true);
            return;
          }
          if (msg.type === "error") {
            console.warn("[prices] stream error", msg.message);
            return;
          }
          if (msg.type !== "trade" || !msg.data) return;
          // Opening a socket alone doesn't prove the upstream is healthy.
          retry = 0;
          setSocketOpen(true);
          for (const tr of msg.data) {
            const prev = pending.current.get(tr.s);
            if (!prev || tr.t >= prev.t) pending.current.set(tr.s, { p: tr.p, t: tr.t });
          }
        } catch {
          /* ignore malformed frames */
        }
      };
      socket.onclose = () => {
        if (closed || ws.current !== socket) return;
        setSocketOpen(false);
        ws.current = null;
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
          if (session(new Date(t)) !== "regular") {
            // Extended-hours prints don't move the day's change; they're shown beside it.
            if (!cur?.ext || t >= cur.ext.time) next[s] = { ...(cur ?? { price: p, prevClose: p, time: t, fromTrade: true }), ext: { price: p, time: t } };
          } else if (!cur || t >= cur.time) next[s] = { price: p, prevClose: cur?.prevClose ?? p, time: t, fromTrade: true };
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
