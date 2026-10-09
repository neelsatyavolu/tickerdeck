"use client";
import { api } from "./api";

export type WatchItem = { symbol: string; name: string | null; added_at: string };

const json = { "Content-Type": "application/json" };
// keepalive: a save still completes if the user navigates away right after it.
const keep = { keepalive: true } as const;

export const listWatchlist = () => api<WatchItem[]>("/api/watchlist");
export const addToWatchlist = (symbol: string, name?: string | null) =>
  api<null>("/api/watchlist", { ...keep, method: "POST", headers: json, body: JSON.stringify({ symbol, name: name ?? null }) });
export const removeFromWatchlist = (symbol: string) => api<null>(`/api/watchlist/${encodeURIComponent(symbol)}`, { ...keep, method: "DELETE" });
export const reorderWatchlist = (symbols: string[]) =>
  api<null>("/api/watchlist/order", { ...keep, method: "PUT", headers: json, body: JSON.stringify({ symbols }) });
