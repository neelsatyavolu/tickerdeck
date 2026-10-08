import type { NasdaqSummary } from "./nasdaq";
import type { KeyStats } from "./types";

const n = (v: unknown): number | null => (typeof v === "number" && Number.isFinite(v) ? v : null);
const frac = (v: unknown): number | null => (n(v) === null ? null : (n(v) as number) / 100);

/** Merge Finnhub's metrics with Nasdaq's summary. Finnhub percents become fractions. */
export function buildKeyStats(m: Record<string, unknown>, s: NasdaqSummary | null): KeyStats {
  const capMillions = n(m.marketCapitalization);
  return {
    name: s?.name ?? null,
    exchange: s?.exchange ?? null,
    sector: s?.sector ?? null,
    industry: s?.industry ?? null,
    assetClass: s?.assetClass ?? null,
    marketCap: s?.marketCap ?? (capMillions === null ? null : capMillions * 1e6),
    peTTM: n(m.peTTM),
    epsTTM: n(m.epsTTM),
    pegTTM: n(m.pegTTM),
    psTTM: n(m.psTTM),
    pb: n(m.pb) ?? n(m.pbQuarterly),
    beta: n(m.beta),
    high52: n(m["52WeekHigh"]),
    low52: n(m["52WeekLow"]),
    avgVolume10d: n(m["10DayAverageTradingVolume"]) === null ? null : (n(m["10DayAverageTradingVolume"]) as number) * 1e6,
    dividendYield: s?.dividendYield ?? frac(m.currentDividendYieldTTM),
    annualDividend: s?.annualDividend ?? n(m.dividendIndicatedAnnual),
    exDividendDate: s?.exDividendDate ?? null,
    grossMargin: frac(m.grossMarginTTM),
    operatingMargin: frac(m.operatingMarginTTM),
    netMargin: frac(m.netProfitMarginTTM),
    roe: frac(m.roeTTM),
    revenueGrowthYoy: frac(m.revenueGrowthTTMYoy),
    epsGrowthYoy: frac(m.epsGrowthTTMYoy),
    debtToEquity: n(m["totalDebt/totalEquityQuarterly"]),
    ytdReturn: frac(m.yearToDatePriceReturnDaily),
    relativeToSP500Ytd: frac(m["priceRelativeToS&P500Ytd"]),
  };
}
