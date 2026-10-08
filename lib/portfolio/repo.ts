import type { SupabaseClient } from "@supabase/supabase-js";
import { holdingInputSchema, portfolioInputSchema } from "../validation";
import type { Holding, Portfolio } from "./types";
import type { z } from "zod";

// Data access shared by the browser (writes, guarded by RLS) and the server
// (AI context). Inputs are validated here, at the boundary, before any write.

const SELECT = "id, name, kind, starting_cash, start_date, created_at, holdings(id, portfolio_id, symbol, shares, cost_basis, bought_at, note)";

type Row = Omit<Portfolio, "holdings" | "starting_cash"> & {
  starting_cash: number | string | null;
  holdings: (Omit<Holding, "shares" | "cost_basis"> & { shares: number | string; cost_basis: number | string })[];
};

// Postgres numerics arrive as strings.
function toPortfolio(row: Row): Portfolio {
  return {
    ...row,
    starting_cash: row.starting_cash === null ? null : Number(row.starting_cash),
    holdings: (row.holdings ?? []).map((h) => ({ ...h, shares: Number(h.shares), cost_basis: Number(h.cost_basis) })),
  };
}

function fail(action: string, error: { message: string } | null): never {
  throw new Error(`Could not ${action}: ${error?.message ?? "unknown error"}`);
}

export async function listPortfolios(db: SupabaseClient): Promise<Portfolio[]> {
  const { data, error } = await db.from("portfolios").select(SELECT).order("created_at");
  if (error) fail("load portfolios", error);
  return (data as Row[]).map(toPortfolio);
}

export async function getPortfolio(db: SupabaseClient, id: string): Promise<Portfolio | null> {
  const { data, error } = await db.from("portfolios").select(SELECT).eq("id", id).maybeSingle();
  if (error) fail("load portfolio", error);
  return data ? toPortfolio(data as Row) : null;
}

export async function createPortfolio(db: SupabaseClient, input: z.input<typeof portfolioInputSchema>): Promise<string> {
  const values = portfolioInputSchema.parse(input);
  const { data, error } = await db.from("portfolios").insert(values).select("id").single();
  if (error) fail("create portfolio", error);
  return data.id as string;
}

export async function updatePortfolio(db: SupabaseClient, id: string, input: z.input<typeof portfolioInputSchema>): Promise<void> {
  const values = portfolioInputSchema.parse(input);
  const { error } = await db.from("portfolios").update(values).eq("id", id);
  if (error) fail("update portfolio", error);
}

export async function deletePortfolio(db: SupabaseClient, id: string): Promise<void> {
  const { error } = await db.from("portfolios").delete().eq("id", id);
  if (error) fail("delete portfolio", error);
}

export async function addHolding(db: SupabaseClient, portfolioId: string, input: z.input<typeof holdingInputSchema>): Promise<void> {
  const values = holdingInputSchema.parse(input);
  const { error } = await db.from("holdings").insert({ ...values, portfolio_id: portfolioId });
  if (error) fail("add holding", error);
}

export async function updateHolding(db: SupabaseClient, id: string, input: z.input<typeof holdingInputSchema>): Promise<void> {
  const values = holdingInputSchema.parse(input);
  const { error } = await db.from("holdings").update(values).eq("id", id);
  if (error) fail("update holding", error);
}

export async function deleteHolding(db: SupabaseClient, id: string): Promise<void> {
  const { error } = await db.from("holdings").delete().eq("id", id);
  if (error) fail("delete holding", error);
}
