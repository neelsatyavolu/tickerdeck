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
  const rows = await sql()`select symbol, name, added_at from watchlist where user_id = ${userId} order by position nulls last, added_at`;
  return rows.map(toItem);
}

/** New symbols go to the end. Adding one that's already watched is a no-op (keeps its place). */
export async function addToWatchlist(userId: string, rawSymbol: string, rawName?: string | null): Promise<void> {
  const symbol = symbolSchema.parse(rawSymbol);
  const name = rawName?.trim().slice(0, 200) || null;
  await sql()`
    insert into watchlist (user_id, symbol, name, position)
    values (${userId}, ${symbol}, ${name}, (select coalesce(max(position), 0) + 1 from watchlist where user_id = ${userId}))
    on conflict (user_id, symbol) do update set name = coalesce(watchlist.name, excluded.name)`;
}

export async function removeFromWatchlist(userId: string, rawSymbol: string): Promise<void> {
  const symbol = symbolSchema.parse(rawSymbol);
  await sql()`delete from watchlist where user_id = ${userId} and symbol = ${symbol}`;
}

/**
 * Save a new order. Symbols are numbered in the order given; any watched
 * symbol missing from the list keeps its relative place after them.
 */
export async function reorderWatchlist(userId: string, rawSymbols: string[]): Promise<void> {
  const symbols = rawSymbols.map((s) => symbolSchema.parse(s));
  await sql().query(
    `update watchlist w set position = case when o.n is not null then o.n else $3 + coalesce(w.position, 0) end
     from watchlist w2
     left join unnest($2::text[]) with ordinality as o(symbol, n) on o.symbol = w2.symbol
     where w.id = w2.id and w.user_id = $1`,
    [userId, symbols, symbols.length + 1],
  );
}
