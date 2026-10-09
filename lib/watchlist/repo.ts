import "server-only";
import { sql } from "../db";
import { symbolSchema } from "../validation";

export type WatchItem = { symbol: string; name: string | null; added_at: string };

const toItem = (r: Record<string, unknown>): WatchItem => ({
  symbol: r.symbol as string,
  name: (r.name as string | null) ?? null,
  added_at: r.added_at instanceof Date ? r.added_at.toISOString() : String(r.added_at),
});

export async function listWatchlist(userId: string): Promise<WatchItem[]> {
  const rows = await sql()`select symbol, name, added_at from watchlist where user_id = ${userId} order by added_at`;
  return rows.map(toItem);
}

/** Adding a symbol that's already watched is a no-op (keeps its original date). */
export async function addToWatchlist(userId: string, rawSymbol: string, rawName?: string | null): Promise<void> {
  const symbol = symbolSchema.parse(rawSymbol);
  const name = rawName?.trim().slice(0, 200) || null;
  await sql()`
    insert into watchlist (user_id, symbol, name) values (${userId}, ${symbol}, ${name})
    on conflict (user_id, symbol) do update set name = coalesce(watchlist.name, excluded.name)`;
}

export async function removeFromWatchlist(userId: string, rawSymbol: string): Promise<void> {
  const symbol = symbolSchema.parse(rawSymbol);
  await sql()`delete from watchlist where user_id = ${userId} and symbol = ${symbol}`;
}
