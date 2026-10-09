import type { NewsItem } from "./types";

// News curation: keep reputable outlets, drop wires and SEO mills, merge the
// same story reported for several tickers, newest first.

/** Finnhub source name (lowercased, no spaces) → display name. Anything else is dropped. */
const REPUTABLE: Record<string, string> = {
  reuters: "Reuters",
  bloomberg: "Bloomberg",
  cnbc: "CNBC",
  wsj: "WSJ",
  thewallstreetjournal: "WSJ",
  marketwatch: "MarketWatch",
  barrons: "Barron's",
  financialtimes: "Financial Times",
  ft: "Financial Times",
  associatedpress: "AP",
  ap: "AP",
  yahoo: "Yahoo Finance",
  yahoofinance: "Yahoo Finance",
  businessinsider: "Business Insider",
  fortune: "Fortune",
  forbes: "Forbes",
  axios: "Axios",
  theeconomist: "The Economist",
  economist: "The Economist",
  seekingalpha: "Seeking Alpha",
  benzinga: "Benzinga",
  thestreet: "TheStreet",
  investopedia: "Investopedia",
  morningstar: "Morningstar",
  fool: "Motley Fool",
  motleyfool: "Motley Fool",
  zacks: "Zacks",
};

export function sourceName(raw: string): string | null {
  return REPUTABLE[raw.toLowerCase().replace(/[^a-z]/g, "")] ?? null;
}

const headlineKey = (h: string) => h.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim().slice(0, 90);

/** Reputable, https-only, deduplicated (by URL and headline), tickers merged, newest first. */
export function curate(items: NewsItem[], limit = 60): NewsItem[] {
  const byKey = new Map<string, NewsItem>();
  const urlToKey = new Map<string, string>();
  for (const n of items) {
    const source = sourceName(n.source);
    if (!source || !n.headline || !n.url.startsWith("https://")) continue;
    const key = urlToKey.get(n.url) ?? headlineKey(n.headline);
    const prev = byKey.get(key);
    const related = [...new Set([...(prev?.related ?? []), ...(n.related ?? [])])];
    const image = prev?.image ?? (n.image?.startsWith("https://") ? n.image : null);
    byKey.set(key, { ...(prev ?? n), source: prev?.source ?? source, related, image, time: Math.max(prev?.time ?? 0, n.time) });
    urlToKey.set(n.url, key);
  }
  return [...byKey.values()].sort((a, b) => b.time - a.time).slice(0, limit);
}
