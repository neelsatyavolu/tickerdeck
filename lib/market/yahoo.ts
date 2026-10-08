import "server-only";
import { memo } from "./cache";
import { fetchJson, UpstreamError } from "./http";
import type { AnalystTargets, HistoryRange, PricePoint } from "./types";

// Yahoo Finance's public chart and quoteSummary endpoints are unofficial.
// Everything Yahoo-specific lives in this file so it can be swapped out.

const HOSTS = ["https://query1.finance.yahoo.com", "https://query2.finance.yahoo.com"];
const UA = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130 Safari/537.36";
const HISTORY_TTL = 60 * 60_000;
const TARGETS_TTL = 6 * 60 * 60_000;
const SESSION_TTL = 60 * 60_000;

type RawChart = {
  chart?: {
    result?: { timestamp?: number[]; indicators?: { adjclose?: { adjclose?: (number | null)[] }[]; quote?: { close?: (number | null)[] }[] } }[] | null;
    error?: { description?: string } | null;
  };
};

/** Daily closes, preferring split- and dividend-adjusted closes. */
export function parseChart(raw: RawChart): PricePoint[] {
  const result = raw.chart?.result?.[0];
  const times = result?.timestamp ?? [];
  const closes = result?.indicators?.adjclose?.[0]?.adjclose ?? result?.indicators?.quote?.[0]?.close ?? [];
  const points: PricePoint[] = [];
  times.forEach((t, i) => {
    const c = closes[i];
    if (typeof c === "number" && Number.isFinite(c) && c > 0) points.push({ t: t * 1000, close: c });
  });
  return points;
}

async function withFallback<T>(path: string, init: RequestInit): Promise<T> {
  let lastError: unknown;
  for (const host of HOSTS) {
    try {
      return await fetchJson<T>("yahoo", `${host}${path}`, init);
    } catch (err) {
      lastError = err;
      if (err instanceof UpstreamError && err.status === 404) throw err;
    }
  }
  throw lastError;
}

export function history(symbol: string, range: HistoryRange): Promise<PricePoint[]> {
  return memo(`yh:history:${symbol}:${range}`, HISTORY_TTL, async () => {
    const qs = new URLSearchParams({ range, interval: "1d", includeAdjustedClose: "true" });
    const raw = await withFallback<RawChart>(`/v8/finance/chart/${encodeURIComponent(symbol)}?${qs}`, { headers: { "User-Agent": UA } });
    const points = parseChart(raw);
    if (points.length === 0) throw new UpstreamError("yahoo", 404, `No price history for ${symbol}`);
    return points;
  });
}

// quoteSummary needs a cookie + crumb pair from Yahoo's consent flow.
function yahooSession(): Promise<{ cookie: string; crumb: string }> {
  return memo("yh:session", SESSION_TTL, async () => {
    const res = await fetch("https://fc.yahoo.com", { headers: { "User-Agent": UA }, redirect: "manual", signal: AbortSignal.timeout(8000) });
    const cookie = res.headers.getSetCookie().map((c) => c.split(";")[0]).join("; ");
    if (!cookie) throw new UpstreamError("yahoo", res.status, "yahoo session cookie missing");
    const crumbRes = await fetch(`${HOSTS[0]}/v1/test/getcrumb`, { headers: { "User-Agent": UA, cookie }, signal: AbortSignal.timeout(8000) });
    const crumb = (await crumbRes.text()).trim();
    if (!crumbRes.ok || !crumb || crumb.includes("<")) throw new UpstreamError("yahoo", crumbRes.status, "yahoo crumb unavailable");
    return { cookie, crumb };
  });
}

type Raw = { raw?: number } | undefined;
type RawSummary = {
  quoteSummary?: {
    result?: { financialData?: { targetLowPrice?: Raw; targetMeanPrice?: Raw; targetMedianPrice?: Raw; targetHighPrice?: Raw; numberOfAnalystOpinions?: Raw; recommendationKey?: string } }[] | null;
  };
};

export function parseTargets(raw: RawSummary): AnalystTargets | null {
  const fd = raw.quoteSummary?.result?.[0]?.financialData;
  if (!fd) return null;
  const n = (v: Raw) => (typeof v?.raw === "number" && v.raw > 0 ? v.raw : null);
  const targets = {
    low: n(fd.targetLowPrice),
    mean: n(fd.targetMeanPrice),
    median: n(fd.targetMedianPrice),
    high: n(fd.targetHighPrice),
    analysts: n(fd.numberOfAnalystOpinions),
    rating: fd.recommendationKey && fd.recommendationKey !== "none" ? fd.recommendationKey.replace(/_/g, " ") : null,
  };
  return targets.mean === null && targets.rating === null ? null : targets;
}

export function analystTargets(symbol: string): Promise<AnalystTargets | null> {
  return memo(`yh:targets:${symbol}`, TARGETS_TTL, async () => {
    const { cookie, crumb } = await yahooSession();
    const qs = new URLSearchParams({ modules: "financialData", crumb });
    const raw = await withFallback<RawSummary>(`/v10/finance/quoteSummary/${encodeURIComponent(symbol)}?${qs}`, {
      headers: { "User-Agent": UA, cookie },
    });
    return parseTargets(raw);
  });
}
