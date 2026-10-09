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

/** Outlet logos stand in for photos on some feeds (every Reuters story has the same one). */
export function realImage(url: string | null | undefined): string | null {
  if (!url?.startsWith("https://")) return null;
  return /\/logos?\/|logo[^/]*\.(png|jpe?g|svg|webp)$/i.test(url.replace(/[?#].*$/, "")) ? null : url;
}

/** "Stocks rally - Reuters" → "Stocks rally"; summaries that only repeat the headline are dropped. */
export function tidyText(headline: string, summary: string, source: string): { headline: string; summary: string } {
  const h = headline.replace(new RegExp(`\\s+[-–—|]\\s+${source.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}$`, "i"), "").trim();
  const repeats = headlineKey(summary).startsWith(headlineKey(h));
  return { headline: h, summary: repeats ? "" : summary };
}

const PLACEHOLDER_REPEATS = 3;
const imageKey = (url: string) => url.replace(/[?#].*$/, "");

/** Images that several different stories share are outlet placeholders, not photos. */
function placeholderImages(items: NewsItem[]): Set<string> {
  const counts = new Map<string, Set<string>>();
  for (const n of items) {
    if (!n.image) continue;
    const k = imageKey(n.image);
    counts.set(k, (counts.get(k) ?? new Set()).add(headlineKey(n.headline)));
  }
  return new Set([...counts].filter(([, stories]) => stories.size >= PLACEHOLDER_REPEATS).map(([k]) => k));
}

/** Reputable, https-only, deduplicated (by URL and headline), tickers merged, newest first. */
export function curate(items: NewsItem[], limit = 60): NewsItem[] {
  const placeholders = placeholderImages(items);
  const byKey = new Map<string, NewsItem>();
  const urlToKey = new Map<string, string>();
  for (const n of items) {
    const source = sourceName(n.source);
    if (!source || !n.headline || !n.url.startsWith("https://")) continue;
    const key = urlToKey.get(n.url) ?? headlineKey(n.headline);
    const prev = byKey.get(key);
    const related = [...new Set([...(prev?.related ?? []), ...(n.related ?? [])])];
    const image = prev?.image ?? (n.image && placeholders.has(imageKey(n.image)) ? null : realImage(n.image));
    const text = prev ? { headline: prev.headline, summary: prev.summary } : tidyText(n.headline, n.summary, n.source);
    byKey.set(key, { ...(prev ?? n), ...text, source: prev?.source ?? source, related, image, time: Math.max(prev?.time ?? 0, n.time) });
    urlToKey.set(n.url, key);
  }
  return [...byKey.values()].sort((a, b) => b.time - a.time).slice(0, limit);
}
