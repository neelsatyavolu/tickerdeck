import "server-only";
import { memo } from "./cache";
import { fetchJson, UpstreamError } from "./http";
import type { EarningsPoint, NewsItem, Profile, QuoteSnapshot, Recommendation, SymbolMatch } from "./types";

const BASE = "https://finnhub.io/api/v1";
const QUOTE_TTL = 15_000;
const SLOW_TTL = 6 * 60 * 60_000;
const NEWS_TTL = 15 * 60_000;
const QUOTE_CONCURRENCY = 6;

export function finnhubKey(): string {
  const key = process.env.FINNHUB_API_KEY;
  if (!key) throw new UpstreamError("finnhub", 0, "FINNHUB_API_KEY is not set");
  return key;
}

function get<T>(path: string, params: Record<string, string>): Promise<T> {
  const qs = new URLSearchParams({ ...params, token: finnhubKey() });
  return fetchJson<T>("finnhub", `${BASE}/${path}?${qs}`);
}

type RawQuote = { c: number; d: number | null; dp: number | null; pc: number; t: number };

export function quote(symbol: string): Promise<QuoteSnapshot | null> {
  return memo(`fh:quote:${symbol}`, QUOTE_TTL, async () => {
    const q = await get<RawQuote>("quote", { symbol });
    // Finnhub answers unknown symbols with all zeros.
    if (!q || !q.c || !q.t) return null;
    return { symbol, price: q.c, prevClose: q.pc, time: q.t * 1000 };
  });
}

/** Snapshot several quotes with bounded parallelism; one bad symbol never fails the batch. */
export async function quotes(symbols: string[]): Promise<{ quotes: QuoteSnapshot[]; failed: string[] }> {
  const results: (QuoteSnapshot | null)[] = new Array(symbols.length).fill(null);
  let next = 0;
  async function worker() {
    while (next < symbols.length) {
      const i = next++;
      results[i] = await quote(symbols[i]).catch(() => null);
    }
  }
  await Promise.all(Array.from({ length: Math.min(QUOTE_CONCURRENCY, symbols.length) }, worker));
  return {
    quotes: results.filter((q): q is QuoteSnapshot => q !== null),
    failed: symbols.filter((_, i) => results[i] === null),
  };
}

type RawProfile = { name?: string; exchange?: string; finnhubIndustry?: string; marketCapitalization?: number; logo?: string; weburl?: string; currency?: string };

export function profile(symbol: string): Promise<Profile | null> {
  return memo(`fh:profile:${symbol}`, SLOW_TTL, async () => {
    const p = await get<RawProfile>("stock/profile2", { symbol });
    if (!p?.name) return null;
    return {
      name: p.name,
      exchange: p.exchange ?? null,
      industry: p.finnhubIndustry ?? null,
      marketCap: p.marketCapitalization ? p.marketCapitalization * 1e6 : null,
      logo: p.logo || null,
      url: p.weburl || null,
      currency: p.currency ?? "USD",
    };
  });
}

export function recommendations(symbol: string): Promise<Recommendation[]> {
  return memo(`fh:rec:${symbol}`, SLOW_TTL, async () => {
    const rows = await get<Recommendation[]>("stock/recommendation", { symbol });
    return Array.isArray(rows) ? rows.slice(0, 6) : [];
  });
}

type RawNews = { datetime: number; headline: string; source: string; url: string; summary: string };

function isoDay(d: Date): string {
  return d.toISOString().slice(0, 10);
}

export function news(symbol: string, days = 10): Promise<NewsItem[]> {
  return memo(`fh:news:${symbol}:${days}`, NEWS_TTL, async () => {
    const to = new Date();
    const from = new Date(to.getTime() - days * 86_400_000);
    const rows = await get<RawNews[]>("company-news", { symbol, from: isoDay(from), to: isoDay(to) });
    return (Array.isArray(rows) ? rows : [])
      .filter((n) => n.headline && n.url?.startsWith("https://"))
      .sort((a, b) => b.datetime - a.datetime)
      .slice(0, 12)
      .map((n) => ({ time: n.datetime * 1000, headline: n.headline, source: n.source, url: n.url, summary: n.summary?.slice(0, 400) ?? "" }));
  });
}

type RawSearch = { result?: { symbol: string; description: string; type: string }[] };

export function search(query: string): Promise<SymbolMatch[]> {
  return memo(`fh:search:${query.toLowerCase()}`, SLOW_TTL, async () => {
    const r = await get<RawSearch>("search", { q: query, exchange: "US" });
    const seen = new Set<string>();
    return (r.result ?? [])
      .filter((m) => /^[A-Z][A-Z0-9.-]{0,9}$/.test(m.symbol) && !seen.has(m.symbol) && Boolean(seen.add(m.symbol)))
      .slice(0, 8)
      .map((m) => ({ symbol: m.symbol, name: m.description, type: m.type }));
  });
}

/** Finnhub's "basic financials": ratios, margins, growth and returns (percent values are in percent). */
export function metrics(symbol: string): Promise<Record<string, number | string | null>> {
  return memo(`fh:metric:${symbol}`, SLOW_TTL, async () => {
    const r = await get<{ metric?: Record<string, number | string | null> }>("stock/metric", { symbol, metric: "all" });
    return r.metric ?? {};
  });
}

type RawEarnings = { period: string; actual: number | null; estimate: number | null; surprisePercent: number | null };

export function earnings(symbol: string): Promise<EarningsPoint[]> {
  return memo(`fh:earnings:${symbol}`, SLOW_TTL, async () => {
    const rows = await get<RawEarnings[]>("stock/earnings", { symbol });
    return (Array.isArray(rows) ? rows : [])
      .map((e) => ({ period: e.period, actual: e.actual, estimate: e.estimate, surprisePercent: e.surprisePercent }))
      .sort((a, b) => a.period.localeCompare(b.period));
  });
}

export function peers(symbol: string): Promise<string[]> {
  return memo(`fh:peers:${symbol}`, SLOW_TTL, async () => {
    const rows = await get<string[]>("stock/peers", { symbol });
    return (Array.isArray(rows) ? rows : []).filter((p) => p !== symbol && /^[A-Z][A-Z0-9.-]{0,9}$/.test(p)).slice(0, 10);
  });
}

/** General market headlines (used on index pages, which have no company news). */
export function marketNews(): Promise<NewsItem[]> {
  return memo("fh:marketnews", NEWS_TTL, async () => {
    const rows = await get<RawNews[]>("news", { category: "general" });
    return (Array.isArray(rows) ? rows : [])
      .filter((n) => n.headline && n.url?.startsWith("https://"))
      .sort((a, b) => b.datetime - a.datetime)
      .slice(0, 12)
      .map((n) => ({ time: n.datetime * 1000, headline: n.headline, source: n.source, url: n.url, summary: n.summary?.slice(0, 400) ?? "" }));
  });
}
