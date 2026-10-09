"use client";
import { api } from "./api";

export type WatchItem = { symbol: string; name: string | null; added_at: string };
export type WatchList = { id: string; name: string; is_primary: boolean; items: WatchItem[] };

const json = { "Content-Type": "application/json" };
// keepalive: a save still completes if the user navigates away right after it.
const keep = { keepalive: true } as const;

export const listWatchlists = () => api<WatchList[]>("/api/watchlists");
/** Primary list's items (kept for callers that only need the main list). */
export const listWatchlist = () => api<WatchItem[]>("/api/watchlist");
export const createWatchlist = async (name: string) =>
  (await api<{ id: string }>("/api/watchlists", { ...keep, method: "POST", headers: json, body: JSON.stringify({ name }) })).id;
export const renameWatchlist = (id: string, name: string) =>
  api<null>(`/api/watchlists/${id}`, { ...keep, method: "PATCH", headers: json, body: JSON.stringify({ name }) });
export const deleteWatchlist = (id: string) => api<null>(`/api/watchlists/${id}`, { ...keep, method: "DELETE" });

export const addToWatchlist = (symbol: string, name?: string | null, watchlistId?: string | null) =>
  api<null>("/api/watchlist", { ...keep, method: "POST", headers: json, body: JSON.stringify({ symbol, name: name ?? null, watchlistId: watchlistId ?? null }) });
export const removeFromWatchlist = (symbol: string, watchlistId?: string | null) =>
  api<null>(`/api/watchlist/${encodeURIComponent(symbol)}${watchlistId ? `?list=${watchlistId}` : ""}`, { ...keep, method: "DELETE" });
export const reorderWatchlist = (symbols: string[], watchlistId?: string | null) =>
  api<null>("/api/watchlist/order", { ...keep, method: "PUT", headers: json, body: JSON.stringify({ symbols, watchlistId: watchlistId ?? null }) });
