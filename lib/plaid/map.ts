import { holdingInputSchema, tickerSchema } from "../validation";

// Turns what Plaid reports for a linked brokerage into tickerdeck lots, one
// portfolio per investment account. Pure: no network, no database. Anything
// that can't be held or stored here is skipped and reported, so one odd
// position never fails a whole sync.

export type PlaidHoldingsData = {
  accounts: { account_id: string; name: string; mask: string | null; type: string }[];
  holdings: { account_id: string; security_id: string; quantity: number; cost_basis: number | null; iso_currency_code?: string | null }[];
  securities: { security_id: string; ticker_symbol: string | null; name: string | null; type: string | null; is_cash_equivalent?: boolean | null }[];
};

export type SyncedLot = { symbol: string; shares: number; cost_basis: number; note: string | null };
export type SkippedPosition = { name: string; reason: string };
export type SyncedAccount = { accountId: string; name: string; lots: SyncedLot[]; skipped: SkippedPosition[] };

type Account = PlaidHoldingsData["accounts"][number];
type Holding = PlaidHoldingsData["holdings"][number];
type Security = PlaidHoldingsData["securities"][number];

const MAX_NAME = 80; // portfolios.name
const SHARE_DECIMALS = 1e8; // holdings.shares is numeric(24, 8)
const COST_DECIMALS = 1e6; // holdings.cost_basis is numeric(18, 6)

/** Security types tickerdeck can't price or hold, and how to describe them. */
const UNSUPPORTED: Record<string, string> = {
  cash: "cash",
  derivative: "option or other derivative",
  "fixed income": "bond",
  cryptocurrency: "crypto",
  loan: "loan",
};

function portfolioName(institution: string, account: Account): string {
  const suffix = account.mask ? ` ··${account.mask}` : "";
  return `${institution} ${account.name}`.trim().slice(0, MAX_NAME - suffix.length).trimEnd() + suffix;
}

function ticker(security: Security): string | null {
  const parsed = tickerSchema.safeParse(security.ticker_symbol ?? "");
  return parsed.success ? parsed.data : null;
}

/** Plaid reports the total paid for a position; tickerdeck stores cost per share. */
function toLot(institution: string, symbol: string, shares: number, holding: Holding): SyncedLot {
  const total = holding.cost_basis;
  if (total === null || !(total > 0)) return { symbol, shares, cost_basis: 0, note: `${institution} did not report a cost basis.` };
  return { symbol, shares, cost_basis: Math.round((total / holding.quantity) * COST_DECIMALS) / COST_DECIMALS, note: null };
}

function mapPosition(institution: string, holding: Holding, security: Security | undefined): { lot: SyncedLot } | { skipped: SkippedPosition } {
  if (!security) return { skipped: { name: "Unknown security", reason: "unrecognised security" } };
  const symbol = ticker(security);
  const skip = (reason: string) => ({ skipped: { name: symbol ?? security.name ?? "Unknown security", reason } });

  if (security.is_cash_equivalent) return skip("cash");
  const unsupported = UNSUPPORTED[security.type ?? ""];
  if (unsupported) return skip(unsupported);
  if (!symbol) return skip("no US ticker");
  if (holding.iso_currency_code && holding.iso_currency_code !== "USD") return skip("not in US dollars");
  const shares = Math.round(holding.quantity * SHARE_DECIMALS) / SHARE_DECIMALS;
  if (!(shares > 0)) return skip("short or empty position");
  const lot = toLot(institution, symbol, shares, holding);
  return holdingInputSchema.safeParse(lot).success ? { lot } : skip("amount out of range");
}

export function mapHoldings(institution: string, data: PlaidHoldingsData): SyncedAccount[] {
  const securities = new Map(data.securities.map((s) => [s.security_id, s]));
  return data.accounts
    .filter((a, i, all) => a.type === "investment" && all.findIndex((b) => b.account_id === a.account_id) === i)
    .map((account) => {
      const positions = data.holdings.filter((h) => h.account_id === account.account_id).map((h) => mapPosition(institution, h, securities.get(h.security_id)));
      return {
        accountId: account.account_id,
        name: portfolioName(institution, account),
        lots: positions.flatMap((p) => ("lot" in p ? [p.lot] : [])),
        skipped: positions.flatMap((p) => ("skipped" in p ? [p.skipped] : [])),
      };
    });
}
