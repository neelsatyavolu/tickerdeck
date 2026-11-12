import "server-only";
import type { z } from "zod";
import { sql } from "../db";
import { UserFacingError } from "../errors";
import { holdingInputSchema, portfolioInputSchema } from "../validation";
import type { Holding, Portfolio, PortfolioLink } from "./types";

// Every query is scoped by the signed-in user's id: a user can only see or
// change their own rows. Inputs are validated here, before any write.
// Portfolios synced from a brokerage (plaid_item_id set) are read-only here;
// only a sync changes them (lib/plaid/repo.ts).

type Row = Record<string, unknown>;

const num = (v: unknown) => (v === null || v === undefined ? null : Number(v));
const day = (v: unknown) => (v instanceof Date ? v.toISOString().slice(0, 10) : (v as string | null));

function toHolding(r: Row): Holding {
  return {
    id: r.id as string,
    portfolio_id: r.portfolio_id as string,
    symbol: r.symbol as string,
    shares: Number(r.shares),
    cost_basis: Number(r.cost_basis),
    bought_at: day(r.bought_at),
    note: (r.note as string | null) ?? null,
  };
}

function toPortfolio(r: Row, holdings: Holding[]): Portfolio {
  return {
    id: r.id as string,
    name: r.name as string,
    kind: r.kind as Portfolio["kind"],
    starting_cash: num(r.starting_cash),
    start_date: day(r.start_date),
    created_at: r.created_at instanceof Date ? r.created_at.toISOString() : String(r.created_at),
    holdings,
    link: r.plaid_item_id
      ? {
          item_id: r.plaid_item_id as string,
          institution: r.institution_name as string,
          status: r.link_status as PortfolioLink["status"],
          last_synced_at: r.last_synced_at instanceof Date ? r.last_synced_at.toISOString() : ((r.last_synced_at as string | null) ?? null),
        }
      : null,
  };
}

const LINKED = "This portfolio is synced from your brokerage. Unlink it in Settings to edit it.";

/** Explains a write that matched nothing: the row is synced from a brokerage, or it isn't this user's. */
async function refuse(userId: string, what: "Portfolio" | "Holding", id: string): Promise<never> {
  const linked =
    what === "Portfolio"
      ? await sql()`select 1 from portfolios where id = ${id} and user_id = ${userId} and plaid_item_id is not null`
      : await sql()`
          select 1 from holdings h join portfolios p on p.id = h.portfolio_id
          where h.id = ${id} and h.user_id = ${userId} and p.plaid_item_id is not null`;
  if (linked.length > 0) throw new UserFacingError(LINKED, 409);
  throw new UserFacingError(`${what} not found.`, 404);
}

export async function listPortfolios(userId: string): Promise<Portfolio[]> {
  const db = sql();
  const [portfolios, holdings] = await Promise.all([
    db`
      select p.id, p.name, p.kind, p.starting_cash, p.start_date, p.created_at,
        p.plaid_item_id, i.institution_name, i.status as link_status, i.last_synced_at
      from portfolios p left join plaid_items i on i.id = p.plaid_item_id
      where p.user_id = ${userId} order by p.created_at`,
    db`select id, portfolio_id, symbol, shares, cost_basis, bought_at, note from holdings where user_id = ${userId} order by created_at`,
  ]);
  const byPortfolio = new Map<string, Holding[]>();
  for (const h of holdings.map(toHolding)) byPortfolio.set(h.portfolio_id, [...(byPortfolio.get(h.portfolio_id) ?? []), h]);
  return portfolios.map((p) => toPortfolio(p, byPortfolio.get(p.id as string) ?? []));
}

export async function createPortfolio(userId: string, input: z.input<typeof portfolioInputSchema>): Promise<string> {
  const v = portfolioInputSchema.parse(input);
  const rows = await sql()`
    insert into portfolios (user_id, name, kind, starting_cash, start_date)
    values (${userId}, ${v.name}, ${v.kind}, ${v.starting_cash}, ${v.start_date})
    returning id`;
  return rows[0].id as string;
}

export async function updatePortfolio(userId: string, id: string, input: z.input<typeof portfolioInputSchema>): Promise<void> {
  const v = portfolioInputSchema.parse(input);
  const rows = await sql()`
    update portfolios set name = ${v.name}, kind = ${v.kind}, starting_cash = ${v.starting_cash}, start_date = ${v.start_date}
    where id = ${id} and user_id = ${userId} and plaid_item_id is null returning id`;
  if (rows.length === 0) await refuse(userId, "Portfolio", id);
}

export async function deletePortfolio(userId: string, id: string): Promise<void> {
  const rows = await sql()`delete from portfolios where id = ${id} and user_id = ${userId} and plaid_item_id is null returning id`;
  if (rows.length === 0) await refuse(userId, "Portfolio", id);
}

export async function addHolding(userId: string, portfolioId: string, input: z.input<typeof holdingInputSchema>): Promise<void> {
  const v = holdingInputSchema.parse(input);
  // Inserts only when the portfolio belongs to this user.
  const rows = await sql()`
    insert into holdings (portfolio_id, user_id, symbol, shares, cost_basis, bought_at, note)
    select p.id, ${userId}, ${v.symbol}, ${v.shares}, ${v.cost_basis}, ${v.bought_at ?? null}, ${v.note ?? null}
    from portfolios p where p.id = ${portfolioId} and p.user_id = ${userId} and p.plaid_item_id is null
    returning id`;
  if (rows.length === 0) await refuse(userId, "Portfolio", portfolioId);
}

export async function updateHolding(userId: string, id: string, input: z.input<typeof holdingInputSchema>): Promise<void> {
  const v = holdingInputSchema.parse(input);
  const rows = await sql()`
    update holdings set symbol = ${v.symbol}, shares = ${v.shares}, cost_basis = ${v.cost_basis},
      bought_at = ${v.bought_at ?? null}, note = ${v.note ?? null}
    where id = ${id} and user_id = ${userId}
      and portfolio_id in (select p.id from portfolios p where p.user_id = ${userId} and p.plaid_item_id is null)
    returning id`;
  if (rows.length === 0) await refuse(userId, "Holding", id);
}

export async function deleteHolding(userId: string, id: string): Promise<void> {
  const rows = await sql()`
    delete from holdings where id = ${id} and user_id = ${userId}
      and portfolio_id in (select p.id from portfolios p where p.user_id = ${userId} and p.plaid_item_id is null)
    returning id`;
  if (rows.length === 0) await refuse(userId, "Holding", id);
}

/**
 * Bulk import in one statement (all or nothing): into an existing portfolio
 * of this user's, or into a new portfolio created in the same statement.
 * Returns the portfolio id.
 */
export async function importHoldings(
  userId: string,
  target: { portfolioId: string } | { portfolio: z.input<typeof portfolioInputSchema> },
  inputs: z.input<typeof holdingInputSchema>[],
): Promise<string> {
  const rows = inputs.map((h) => holdingInputSchema.parse(h)).map((h) => ({ ...h, bought_at: h.bought_at ?? null, note: h.note ?? null }));
  if (rows.length === 0) throw new UserFacingError("Nothing to import.");
  const json = JSON.stringify(rows);
  const recordset = "x(symbol text, shares numeric, cost_basis numeric, bought_at date, note text)";

  if ("portfolioId" in target) {
    const result = await sql().query(
      `insert into holdings (portfolio_id, user_id, symbol, shares, cost_basis, bought_at, note)
       select p.id, $1, x.symbol, x.shares, x.cost_basis, x.bought_at, x.note
       from portfolios p, jsonb_to_recordset($3::jsonb) as ${recordset}
       where p.id = $2 and p.user_id = $1 and p.plaid_item_id is null
       returning portfolio_id`,
      [userId, target.portfolioId, json],
    );
    if (result.length === 0) await refuse(userId, "Portfolio", target.portfolioId);
    return target.portfolioId;
  }

  const v = portfolioInputSchema.parse(target.portfolio);
  const result = await sql().query(
    `with p as (
       insert into portfolios (user_id, name, kind, starting_cash, start_date)
       values ($1, $2, $3, $4, $5) returning id
     )
     insert into holdings (portfolio_id, user_id, symbol, shares, cost_basis, bought_at, note)
     select p.id, $1, x.symbol, x.shares, x.cost_basis, x.bought_at, x.note
     from p, jsonb_to_recordset($6::jsonb) as ${recordset}
     returning portfolio_id`,
    [userId, v.name, v.kind, v.starting_cash, v.start_date, json],
  );
  return result[0].portfolio_id as string;
}
