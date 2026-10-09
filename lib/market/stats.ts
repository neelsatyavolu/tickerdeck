import type { NasdaqSummary } from "./nasdaq";
import type { KeyStats, PricePoint } from "./types";

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
    volume: s?.volume ?? null,
    avgVolume: s?.avgVolume ?? null,
    dayHigh: s?.dayHigh ?? null,
    dayLow: s?.dayLow ?? null,
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

/**
 * Fill volume gaps from daily history: Nasdaq's summary sometimes reports
 * "N/A" (e.g. thinly traded BRK.A, or outside market hours). Uses the latest
 * session's volume and a 3-month average.
 */
export function withHistoryVolume(st: KeyStats, points: PricePoint[] | null): KeyStats {
  if (!points?.length || (st.volume !== null && st.avgVolume !== null)) return st;
  const vols = points.slice(-63).map((p) => p.volume).filter((v): v is number => typeof v === "number" && v > 0);
  const latest = points[points.length - 1].volume;
  return {
    ...st,
    volume: st.volume ?? (latest && latest > 0 ? latest : null),
    avgVolume: st.avgVolume ?? (vols.length ? Math.round(vols.reduce((a, b) => a + b, 0) / vols.length) : null),
  };
}

/** True when the security pays a dividend; false when we know it doesn't; null when unknown. */
export function paysDividend(st: Pick<KeyStats, "annualDividend" | "dividendYield" | "assetClass">): boolean | null {
  if ((st.annualDividend ?? 0) > 0 || (st.dividendYield ?? 0) > 0) return true;
  if (st.annualDividend === 0 || st.dividendYield === 0) return false;
  // Stocks with no dividend data at all don't pay one (e.g. TSLA); funds and indexes stay unknown.
  return st.assetClass === "stocks" ? false : null;
}
