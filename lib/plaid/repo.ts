import "server-only";
import { sql } from "../db";
import { UserFacingError } from "../errors";
import type { SyncedAccount } from "./map";
import type { ItemStatus, PlaidItem } from "./types";

// Linked brokerages. As in the portfolio repo, every statement is scoped by
// the signed-in user's id. Only findItem returns the (sealed) access token.

type Row = Record<string, unknown>;

const MAX_ERROR = 300; // plaid_items.last_error
const iso = (v: unknown) => (v === null || v === undefined ? null : v instanceof Date ? v.toISOString() : String(v));

function toItem(r: Row): PlaidItem {
  return {
    id: r.id as string,
    institution: r.institution_name as string,
    status: r.status as ItemStatus,
    last_synced_at: iso(r.last_synced_at),
    last_error: (r.last_error as string | null) ?? null,
  };
}

export async function listItems(userId: string): Promise<PlaidItem[]> {
  const rows = await sql()`
    select id, institution_name, status, last_synced_at, last_error
    from plaid_items where user_id = ${userId} order by created_at`;
  return rows.map(toItem);
}

export async function hasInstitution(userId: string, institutionId: string): Promise<boolean> {
  const rows = await sql()`select 1 from plaid_items where user_id = ${userId} and institution_id = ${institutionId}`;
  return rows.length > 0;
}

export type NewItem = { itemId: string; sealedToken: string; institutionId: string; institutionName: string };

export async function insertItem(userId: string, item: NewItem): Promise<string> {
  const rows = await sql()`
    insert into plaid_items (user_id, item_id, access_token, institution_id, institution_name)
    values (${userId}, ${item.itemId}, ${item.sealedToken}, ${item.institutionId}, ${item.institutionName})
    on conflict (user_id, institution_id) do nothing
    returning id`;
  if (rows.length === 0) throw new UserFacingError(`${item.institutionName} is already linked. Use Reconnect instead.`, 409);
  return rows[0].id as string;
}

export type StoredItem = { id: string; itemId: string; sealedToken: string; institution: string };

/** What a sync needs to call Plaid for this link, or null when it isn't this user's. */
export async function findItem(userId: string, id: string): Promise<StoredItem | null> {
  const rows = await sql()`
    select id, item_id, access_token, institution_name
    from plaid_items where id = ${id} and user_id = ${userId}`;
  const r = rows[0];
  return r ? { id: r.id as string, itemId: r.item_id as string, sealedToken: r.access_token as string, institution: r.institution_name as string } : null;
}

/**
 * Makes the link's portfolios match the brokerage, all or nothing: one
 * holdings portfolio per account, its lots replaced by the current positions,
 * and the link marked as synced. The portfolio of an account the brokerage no
 * longer reports is released: it keeps its last lots and becomes an ordinary
 * portfolio the user can edit or delete.
 *
 * The link's row is locked first. Without that, two syncs running at once
 * would each miss the other's new lots when clearing, and both sets would stay.
 */
export async function replaceHoldings(userId: string, id: string, accounts: SyncedAccount[]): Promise<void> {
  const portfolios = accounts.map((a) => ({ account_id: a.accountId, name: a.name }));
  const lots = accounts.flatMap((a) => a.lots.map((l) => ({ ...l, account_id: a.accountId })));
  const db = sql();
  const [, rows] = await db.transaction([
    db`select id from plaid_items where id = ${id} and user_id = ${userId} for update`,
    db.query(
      `with item as (
       select id from plaid_items where id = $2 and user_id = $1
     ),
     synced as (
       insert into portfolios (user_id, name, kind, plaid_item_id, plaid_account_id)
       select $1, a.name, 'holdings', item.id, a.account_id
       from item, jsonb_to_recordset($3::jsonb) as a(account_id text, name text)
       on conflict (plaid_item_id, plaid_account_id) where plaid_item_id is not null
       do update set plaid_account_id = excluded.plaid_account_id
       returning id, plaid_account_id
     ),
     released as (
       update portfolios p set plaid_item_id = null
       where p.plaid_item_id in (select id from item)
         and jsonb_array_length($3::jsonb) > 0
         and p.plaid_account_id not in (select a.account_id from jsonb_to_recordset($3::jsonb) as a(account_id text))
     ),
     cleared as (
       delete from holdings h using synced s where h.portfolio_id = s.id
     ),
     added as (
       insert into holdings (portfolio_id, user_id, symbol, shares, cost_basis, note)
       select s.id, $1, l.symbol, l.shares, l.cost_basis, l.note
       from synced s
       join jsonb_to_recordset($4::jsonb) as l(account_id text, symbol text, shares numeric, cost_basis numeric, note text)
         on l.account_id = s.plaid_account_id
     )
     update plaid_items set status = 'ok', last_error = null, last_synced_at = now()
     where id in (select id from item)
     returning id`,
      [userId, id, JSON.stringify(portfolios), JSON.stringify(lots)],
    ),
  ]);
  if (rows.length === 0) throw new UserFacingError("Brokerage link not found.", 404);
}

export async function markItemFailed(userId: string, id: string, status: ItemStatus, message: string): Promise<void> {
  await sql()`
    update plaid_items set status = ${status}, last_error = ${message.slice(0, MAX_ERROR)}
    where id = ${id} and user_id = ${userId}`;
}

/** Removes the link. Its portfolios stay, as ordinary editable ones. */
export async function deleteItem(userId: string, id: string): Promise<void> {
  const rows = await sql()`delete from plaid_items where id = ${id} and user_id = ${userId} returning id`;
  if (rows.length === 0) throw new UserFacingError("Brokerage link not found.", 404);
}
