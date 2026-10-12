import "server-only";
import { z } from "zod";
import { sql } from "../db";
import { UserFacingError } from "../errors";
import { symbolSchema } from "../validation";

// Watchlists: every user has one primary list (created on first use) plus any
// number of named custom lists. Every query is scoped by user_id.

export type WatchItem = { symbol: string; name: string | null; added_at: string };
export type WatchList = { id: string; name: string; is_primary: boolean; items: WatchItem[] };

export const listNameSchema = z.string().trim().min(1, "Name the list").max(60);

const iso = (v: unknown) => (v instanceof Date ? v.toISOString() : String(v));

async function primaryId(userId: string): Promise<string> {
  const db = sql();
  await db`insert into watchlists (user_id, name, is_primary, position) values (${userId}, 'Watchlist', true, 0)
           on conflict (user_id) where is_primary do nothing`;
  const rows = await db`select id from watchlists where user_id = ${userId} and is_primary`;
  return rows[0].id as string;
}

/** The list to act on: the given one if it's this user's, else the primary. */
async function resolveList(userId: string, listId?: string | null): Promise<string> {
  if (!listId) return primaryId(userId);
  const rows = await sql()`select id from watchlists where id = ${listId} and user_id = ${userId}`;
  if (rows.length === 0) throw new UserFacingError("Watchlist not found.", 404);
  return listId;
}

export async function listWatchlists(userId: string): Promise<WatchList[]> {
  const db = sql();
  const [existingLists, items] = await Promise.all([
    db`select id, name, is_primary from watchlists where user_id = ${userId} order by is_primary desc, position nulls last, created_at`,
    db`select watchlist_id, symbol, name, added_at from watchlist where user_id = ${userId} order by position nulls last, added_at`,
  ]);
  let lists = existingLists;
  if (!lists.some((l) => l.is_primary)) {
    await primaryId(userId);
    lists = await db`select id, name, is_primary from watchlists where user_id = ${userId} order by is_primary desc, position nulls last, created_at`;
  }
  return lists.map((l) => ({
    id: l.id as string,
    name: l.name as string,
    is_primary: Boolean(l.is_primary),
    items: items.filter((i) => i.watchlist_id === l.id).map((i) => ({ symbol: i.symbol as string, name: (i.name as string | null) ?? null, added_at: iso(i.added_at) })),
  }));
}

export async function createWatchlist(userId: string, rawName: string): Promise<string> {
  const name = listNameSchema.parse(rawName);
  await primaryId(userId);
  const rows = await sql()`
    insert into watchlists (user_id, name, position)
    values (${userId}, ${name}, (select coalesce(max(position), 0) + 1 from watchlists where user_id = ${userId}))
    returning id`;
  return rows[0].id as string;
}

export async function renameWatchlist(userId: string, id: string, rawName: string): Promise<void> {
  const name = listNameSchema.parse(rawName);
  const rows = await sql()`update watchlists set name = ${name} where id = ${id} and user_id = ${userId} returning id`;
  if (rows.length === 0) throw new UserFacingError("Watchlist not found.", 404);
}

export async function deleteWatchlist(userId: string, id: string): Promise<void> {
  const rows = await sql()`delete from watchlists where id = ${id} and user_id = ${userId} and not is_primary returning id`;
  if (rows.length === 0) throw new UserFacingError("That list can't be deleted.", 400);
}

/** New symbols go to the end of the list. Adding one that's already there is a no-op. */
export async function addToWatchlist(userId: string, rawSymbol: string, rawName?: string | null, listId?: string | null): Promise<void> {
  const symbol = symbolSchema.parse(rawSymbol);
  const name = rawName?.trim().slice(0, 200) || null;
  const list = await resolveList(userId, listId);
  await sql()`
    insert into watchlist (user_id, watchlist_id, symbol, name, position)
    values (${userId}, ${list}, ${symbol}, ${name}, (select coalesce(max(position), 0) + 1 from watchlist where watchlist_id = ${list}))
    on conflict (watchlist_id, symbol) do update set name = coalesce(watchlist.name, excluded.name)`;
}

export async function removeFromWatchlist(userId: string, rawSymbol: string, listId?: string | null): Promise<void> {
  const symbol = symbolSchema.parse(rawSymbol);
  const list = await resolveList(userId, listId);
  await sql()`delete from watchlist where user_id = ${userId} and watchlist_id = ${list} and symbol = ${symbol}`;
}

/** Save a list's order (top to bottom). Symbols not mentioned keep their relative place after. */
export async function reorderWatchlist(userId: string, rawSymbols: string[], listId?: string | null): Promise<void> {
  const symbols = rawSymbols.map((s) => symbolSchema.parse(s));
  const list = await resolveList(userId, listId);
  await sql().query(
    `update watchlist w set position = case when o.n is not null then o.n else $4 + coalesce(w.position, 0) end
     from watchlist w2
     left join unnest($3::text[]) with ordinality as o(symbol, n) on o.symbol = w2.symbol
     where w.id = w2.id and w.user_id = $1 and w.watchlist_id = $2`,
    [userId, list, symbols, symbols.length + 1],
  );
}
