import "server-only";
import { memo, peek, remember } from "./cache";
import { fetchJson, UpstreamError } from "./http";
import type { AnalystTargets, HistoryRange, PricePoint, QuoteSnapshot, SymbolMatch, TargetPoint } from "./types";

// Nasdaq's public quote API (the one nasdaq.com uses). Unofficial like Yahoo's,
// but it answers requests from cloud hosts, which Yahoo rate-limits to 429.

const BASE = "https://api.nasdaq.com/api";
const HEADERS = {
  "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130 Safari/537.36",
  Accept: "application/json",
};
const HISTORY_TTL = 60 * 60_000;
const SLOW_TTL = 6 * 60 * 60_000;
const RANGE_DAYS: Record<HistoryRange, number> = { "1mo": 31, "3mo": 92, "6mo": 183, "1y": 366, "2y": 731, "5y": 1827 };

export type AssetClass = "stocks" | "etf" | "mutualfunds";
const ASSET_CLASSES: AssetClass[] = ["stocks", "etf", "mutualfunds"];
type Envelope<T> = { data: T | null; status?: { rCode?: number } };

/** "$1,234.50" / "777.22" / "N/A" → number | null */
export function parseNum(v: unknown): number | null {
  if (typeof v === "number") return Number.isFinite(v) ? v : null;
  if (typeof v !== "string") return null;
  const n = Number(v.replace(/[$,%\s]/g, ""));
  return v.trim() && Number.isFinite(n) ? n : null;
}

/** "10/07/2026" → that day's 20:00 UTC (US close), in ms. */
export function parseDay(v: string): number | null {
  const m = /^(\d{2})\/(\d{2})\/(\d{4})$/.exec(v);
  return m ? Date.UTC(Number(m[3]), Number(m[1]) - 1, Number(m[2]), 20) : null;
}

type RawHistory = { tradesTable?: { rows?: { date: string; close: string; volume?: string }[] | null } | null };

export function parseHistory(data: RawHistory | null): PricePoint[] {
  const points: PricePoint[] = [];
  for (const row of data?.tradesTable?.rows ?? []) {
    const t = parseDay(row.date);
    const close = parseNum(row.close);
    if (t !== null && close !== null && close > 0) points.push({ t, close, volume: parseNum(row.volume) ?? undefined });
  }
  return points.sort((a, b) => a.t - b.t);
}

type RawTargets = {
  consensusOverview?: { lowPriceTarget?: number; highPriceTarget?: number; priceTarget?: number; buy?: number; hold?: number; sell?: number } | null;
  historicalConsensus?: { x: number; y: number; z?: { buy?: number; hold?: number; sell?: number; consensus?: string } }[] | null;
};

export function parseTargets(data: RawTargets | null): { targets: AnalystTargets; history: TargetPoint[] } | null {
  const o = data?.consensusOverview;
  if (!o || !o.priceTarget) return null;
  const history = (data?.historicalConsensus ?? [])
    .filter((p) => p.y > 0)
    .map((p) => ({ t: p.x * 1000, target: p.y, buy: p.z?.buy ?? 0, hold: p.z?.hold ?? 0, sell: p.z?.sell ?? 0 }));
  const latest = data?.historicalConsensus?.at(-1)?.z?.consensus ?? null;
  const analysts = (o.buy ?? 0) + (o.hold ?? 0) + (o.sell ?? 0);
  return {
    targets: {
      low: o.lowPriceTarget ?? null,
      mean: o.priceTarget,
      median: null,
      high: o.highPriceTarget ?? null,
      analysts: analysts || null,
      rating: latest ? latest.toLowerCase() : null,
    },
    history,
  };
}

function get<T>(path: string): Promise<Envelope<T>> {
  return fetchJson<Envelope<T>>("nasdaq", `${BASE}${path}`, { headers: HEADERS, timeoutMs: 10_000 });
}

const CLASS_TTL = 7 * 24 * 60 * 60_000; // a symbol's asset type practically never changes
const classKey = (symbol: string) => `nq:class:${symbol}`;

/**
 * Run a lookup for every asset class at once and settle on the first that
 * returns something (Nasdaq calls take 1–3 s each, so never wait for the
 * slowest). Resolves null when none do.
 */
export function firstClass<T>(lookup: (cls: AssetClass) => Promise<T | null>, classes: AssetClass[] = ASSET_CLASSES): Promise<{ cls: AssetClass; value: T } | null> {
  return new Promise((resolve) => {
    let pending = classes.length;
    let settled = false;
    for (const cls of classes) {
      lookup(cls)
        .then((value) => {
          if (value !== null && !settled) {
            settled = true;
            resolve({ cls, value });
          }
        }, () => {})
        .finally(() => {
          if (--pending === 0 && !settled) resolve(null);
        });
    }
  });
}

/** Which of Nasdaq's three listings (stocks, ETFs, mutual funds) a symbol is in. */
export function assetClass(symbol: string): Promise<AssetClass | null> {
  return memo(classKey(symbol), CLASS_TTL, async () => {
    const hit = await firstClass((cls) =>
      get<{ companyName?: string }>(`/quote/${encodeURIComponent(symbol)}/info?assetclass=${cls}`).then((r) => (r.data?.companyName ? true : null)),
    );
    return hit?.cls ?? null;
  });
}

export function history(symbol: string, range: HistoryRange): Promise<PricePoint[]> {
  return memo(`nq:history:${symbol}:${range}`, HISTORY_TTL, async () => {
    const from = new Date(Date.now() - RANGE_DAYS[range] * 86_400_000).toISOString().slice(0, 10);
    const fetchClass = async (cls: AssetClass) => {
      const r = await get<RawHistory>(`/quote/${encodeURIComponent(symbol)}/historical?assetclass=${cls}&fromdate=${from}&limit=9999`);
      const points = parseHistory(r.data);
      return points.length ? points : null;
    };
    // Known type: one call. Unknown: ask all three at once and learn the type.
    const known = await peek<AssetClass | null>(classKey(symbol));
    const hit = await firstClass(fetchClass, known ? [known] : ASSET_CLASSES);
    if (!hit) throw new UpstreamError("nasdaq", 404, `No price history for ${symbol}`);
    if (!known) remember(classKey(symbol), CLASS_TTL, hit.cls);
    return hit.value;
  });
}

export function analystTargets(symbol: string): Promise<{ targets: AnalystTargets; history: TargetPoint[] } | null> {
  return memo(`nq:targets:${symbol}`, SLOW_TTL, async () => parseTargets((await get<RawTargets>(`/analyst/${encodeURIComponent(symbol)}/targetprice`)).data));
}

type RawSummary = { summaryData?: Record<string, { label: string; value: string }> | null };
type RawInfo = { companyName?: string; exchange?: string };

export type NasdaqSummary = {
  name: string | null;
  exchange: string | null;
  sector: string | null;
  industry: string | null;
  assetClass: AssetClass;
  annualDividend: number | null;
  exDividendDate: string | null;
  dividendYield: number | null;
  marketCap: number | null;
};

export function parseSummary(info: RawInfo | null, summary: RawSummary | null, cls: AssetClass): NasdaqSummary {
  const d = summary?.summaryData ?? {};
  const text = (k: string) => {
    const v = d[k]?.value?.trim();
    return v && v !== "N/A" ? v : null;
  };
  return {
    name: info?.companyName?.replace(/ (Common Stock|Class [A-Z] Common Stock|Common Shares|Ordinary Shares)$/i, "") ?? null,
    exchange: text("Exchange") ?? info?.exchange ?? null,
    sector: text("Sector"),
    industry: text("Industry"),
    assetClass: cls,
    annualDividend: parseNum(text("AnnualizedDividend")),
    exDividendDate: text("ExDividendDate"),
    dividendYield: parseNum(text("Yield")) === null ? null : (parseNum(text("Yield")) as number) / 100,
    marketCap: parseNum(text("MarketCap")),
  };
}

export function summary(symbol: string): Promise<NasdaqSummary | null> {
  return memo(`nq:summary:${symbol}`, SLOW_TTL, async () => {
    const enc = encodeURIComponent(symbol);
    const both = (cls: AssetClass) =>
      Promise.all([get<RawInfo>(`/quote/${enc}/info?assetclass=${cls}`), get<RawSummary>(`/quote/${enc}/summary?assetclass=${cls}`)]).then(([info, sum]) =>
        info.data?.companyName ? { info: info.data, sum: sum.data } : null,
      );
    const known = await peek<AssetClass | null>(classKey(symbol));
    const hit = await firstClass(both, known ? [known] : ASSET_CLASSES);
    if (!hit) return null;
    if (!known) remember(classKey(symbol), CLASS_TTL, hit.cls);
    return parseSummary(hit.value.info, hit.value.sum, hit.cls);
  });
}

/** Latest close and the one before it. Mutual funds price once a day, so this is their quote. */
export function latestQuote(symbol: string, points: PricePoint[]): QuoteSnapshot | null {
  if (points.length < 2) return null;
  const last = points[points.length - 1];
  return { symbol, price: last.close, prevClose: points[points.length - 2].close, time: last.t };
}

/** Quote from recent daily closes, for symbols Finnhub's free plan won't price (mutual funds). */
export function quote(symbol: string): Promise<QuoteSnapshot | null> {
  // Reuses the cached 5-year series rather than making another call.
  return memo(`nq:quote:${symbol}`, 5 * 60_000, async () => latestQuote(symbol, await history(symbol, "5y")));
}

type RawLookup = { symbol: string; name: string; asset?: string }[];

const ASSET_LABEL: Record<string, string> = { STOCKS: "Stock", ETF: "ETF", MUTUALFUNDS: "Mutual fund" };

export function parseLookup(rows: RawLookup | null): SymbolMatch[] {
  return (rows ?? [])
    .filter((r) => r.asset && r.asset in ASSET_LABEL && /^[A-Z][A-Z0-9.-]{0,9}$/.test(r.symbol))
    .map((r) => ({ symbol: r.symbol, name: r.name.replace(/ (Common Stock|Common Shares|Ordinary Shares)$/i, ""), type: ASSET_LABEL[r.asset as string] }));
}

export function search(query: string): Promise<SymbolMatch[]> {
  return memo(`nq:search:${query.toLowerCase()}`, SLOW_TTL, async () =>
    parseLookup((await get<RawLookup>(`/autocomplete/slookup/10?search=${encodeURIComponent(query)}`)).data),
  );
}
