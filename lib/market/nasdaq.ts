import "server-only";
import { memo } from "./cache";
import { fetchJson, UpstreamError } from "./http";
import type { AnalystTargets, HistoryRange, PricePoint, TargetPoint } from "./types";

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

export type AssetClass = "stocks" | "etf";
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

/** Nasdaq files ETFs separately from stocks; find which one this symbol is. */
export function assetClass(symbol: string): Promise<AssetClass | null> {
  return memo(`nq:class:${symbol}`, SLOW_TTL, async () => {
    for (const cls of ["stocks", "etf"] as const) {
      const r = await get<{ companyName?: string }>(`/quote/${encodeURIComponent(symbol)}/info?assetclass=${cls}`);
      if (r.data?.companyName) return cls;
    }
    return null;
  });
}

export function history(symbol: string, range: HistoryRange): Promise<PricePoint[]> {
  return memo(`nq:history:${symbol}:${range}`, HISTORY_TTL, async () => {
    const cls = await assetClass(symbol);
    if (!cls) throw new UpstreamError("nasdaq", 404, `No price history for ${symbol}`);
    const from = new Date(Date.now() - RANGE_DAYS[range] * 86_400_000).toISOString().slice(0, 10);
    const r = await get<RawHistory>(`/quote/${encodeURIComponent(symbol)}/historical?assetclass=${cls}&fromdate=${from}&limit=9999`);
    const points = parseHistory(r.data);
    if (points.length === 0) throw new UpstreamError("nasdaq", 404, `No price history for ${symbol}`);
    return points;
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
    const cls = await assetClass(symbol);
    if (!cls) return null;
    const enc = encodeURIComponent(symbol);
    const [info, sum] = await Promise.all([get<RawInfo>(`/quote/${enc}/info?assetclass=${cls}`), get<RawSummary>(`/quote/${enc}/summary?assetclass=${cls}`)]);
    return parseSummary(info.data, sum.data, cls);
  });
}
