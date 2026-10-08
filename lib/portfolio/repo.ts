import "server-only";
import type { z } from "zod";
import { sql } from "../db";
import { UserFacingError } from "../errors";
import { holdingInputSchema, portfolioInputSchema } from "../validation";
import type { Holding, Portfolio } from "./types";

// Every query is scoped by the signed-in user's id: a user can only see or
// change their own rows. Inputs are validated here, before any write.

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
  };
}

export async function listPortfolios(userId: string): Promise<Portfolio[]> {
  const db = sql();
  const [portfolios, holdings] = await Promise.all([
    db`select id, name, kind, starting_cash, start_date, created_at from portfolios where user_id = ${userId} order by created_at`,
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
    where id = ${id} and user_id = ${userId} returning id`;
  if (rows.length === 0) throw new UserFacingError("Portfolio not found.", 404);
}

export async function deletePortfolio(userId: string, id: string): Promise<void> {
  const rows = await sql()`delete from portfolios where id = ${id} and user_id = ${userId} returning id`;
  if (rows.length === 0) throw new UserFacingError("Portfolio not found.", 404);
}

export async function addHolding(userId: string, portfolioId: string, input: z.input<typeof holdingInputSchema>): Promise<void> {
  const v = holdingInputSchema.parse(input);
  // Inserts only when the portfolio belongs to this user.
  const rows = await sql()`
    insert into holdings (portfolio_id, user_id, symbol, shares, cost_basis, bought_at, note)
    select p.id, ${userId}, ${v.symbol}, ${v.shares}, ${v.cost_basis}, ${v.bought_at ?? null}, ${v.note ?? null}
    from portfolios p where p.id = ${portfolioId} and p.user_id = ${userId}
    returning id`;
  if (rows.length === 0) throw new UserFacingError("Portfolio not found.", 404);
}

export async function updateHolding(userId: string, id: string, input: z.input<typeof holdingInputSchema>): Promise<void> {
  const v = holdingInputSchema.parse(input);
  const rows = await sql()`
    update holdings set symbol = ${v.symbol}, shares = ${v.shares}, cost_basis = ${v.cost_basis},
      bought_at = ${v.bought_at ?? null}, note = ${v.note ?? null}
    where id = ${id} and user_id = ${userId} returning id`;
  if (rows.length === 0) throw new UserFacingError("Holding not found.", 404);
}

export async function deleteHolding(userId: string, id: string): Promise<void> {
  const rows = await sql()`delete from holdings where id = ${id} and user_id = ${userId} returning id`;
  if (rows.length === 0) throw new UserFacingError("Holding not found.", 404);
}
