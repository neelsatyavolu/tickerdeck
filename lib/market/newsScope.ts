import type { NewsItem } from "./types";

// Narrowing the news page to one portfolio or watchlist.

/** Company news is fetched for at most this many symbols per request (the upstream rate limit). */
export const NEWS_MAX_SYMBOLS = 12;

/** Stories tagged with at least one of the symbols: one entry per URL, newest first. */
export function storiesFor(items: NewsItem[], symbols: Iterable<string>): NewsItem[] {
  const wanted = new Set(symbols);
  const tagged = items.filter((n) => n.related?.some((s) => wanted.has(s)));
  return [...new Map(tagged.map((n) => [n.url, n])).values()].sort((a, b) => b.time - a.time);
}
