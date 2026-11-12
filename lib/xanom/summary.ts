import "server-only";
import { sql } from "../db";
import { userBySub } from "./repo";

// SPEC.md §4 summary for the accounts.xanom.co dashboard. Counts only: no
// balances, holdings values, tickers or names.

export type Summary =
  | { linked: false }
  | { linked: true; headline: string; items: { label: string; value: string }[]; recent: never[]; url: string };

export type Counts = { portfolios: number; watchlists: number; dashboards: number; brokerages: number };

const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;

export function buildSummary(counts: Counts, url: string): Summary {
  const headline = [plural(counts.portfolios, "portfolio", "portfolios"), plural(counts.watchlists, "watchlist", "watchlists")].join(" · ");
  const items = [
    { label: "Portfolios", value: String(counts.portfolios) },
    { label: "Watchlists", value: String(counts.watchlists) },
    { label: "Dashboards", value: String(counts.dashboards) },
  ];
  if (counts.brokerages > 0) items.push({ label: "Linked brokerages", value: String(counts.brokerages) });
  return { linked: true, headline, items, recent: [], url };
}

/** Portfolios count holdings and paper baskets; watchlists count the watchlist page's lists and watchlist-kind portfolios. */
export async function countsFor(userId: string): Promise<Counts> {
  const rows = (await sql().query(
    `select
       (select count(*) from portfolios where user_id = $1 and kind <> 'watchlist')::int as portfolios,
       ((select count(*) from watchlists where user_id = $1)
        + (select count(*) from portfolios where user_id = $1 and kind = 'watchlist'))::int as watchlists,
       (select count(*) from dashboards where user_id = $1)::int as dashboards,
       (select count(*) from plaid_items where user_id = $1)::int as brokerages`,
    [userId],
  )) as Counts[];
  const r = rows[0];
  return { portfolios: Number(r?.portfolios ?? 0), watchlists: Number(r?.watchlists ?? 0), dashboards: Number(r?.dashboards ?? 0), brokerages: Number(r?.brokerages ?? 0) };
}

export async function summaryFor(sub: string, url: string): Promise<Summary> {
  const user = await userBySub(sub);
  if (!user) return { linked: false };
  return buildSummary(await countsFor(user.id), url);
}
