// Instant, in-memory symbol search over the listing index (client and server).

/** [symbol, name, type, marketCap] — compact so ~12k listings stay small. */
export type Listing = [string, string, string, number];

const SUFFIX = / (Common Stock|Ordinary Shares|Common Shares|Class [A-Z] (Common Stock|Ordinary Shares|Shares)|American Depositary Shares.*|Depositary Shares.*)$/i;

export function cleanName(name: string): string {
  return name.replace(SUFFIX, "").replace(/\s+/g, " ").trim();
}

const words = (s: string) => s.toLowerCase().split(/[^a-z0-9&]+/).filter(Boolean);

/** Best matches: exact ticker, ticker prefix, name-word prefix, name contains; bigger companies first within each. */
export function searchListings(listings: Listing[], query: string, limit = 8): { symbol: string; name: string; type: string }[] {
  const q = query.trim();
  if (!q) return [];
  const upper = q.toUpperCase().replace(/^\$/, "");
  const lower = q.toLowerCase();
  const qWords = words(lower);
  const scored: { l: Listing; score: number }[] = [];
  for (const l of listings) {
    const [sym, name, , cap] = l;
    let score = 0;
    if (sym === upper) score = 1000;
    else if (sym.startsWith(upper)) score = 600 - (sym.length - upper.length) * 10;
    else {
      const n = name.toLowerCase();
      const nw = words(n);
      if (qWords.length && qWords.every((w) => nw.some((x) => x.startsWith(w)))) score = nw[0]?.startsWith(qWords[0]) ? 450 : 350;
      else if (lower.length >= 3 && n.includes(lower)) score = 150;
    }
    if (score > 0) scored.push({ l, score: score + Math.log10(Math.max(cap, 1)) * 8 });
  }
  scored.sort((a, b) => b.score - a.score);
  return scored.slice(0, limit).map(({ l }) => ({ symbol: l[0], name: l[1], type: l[2] }));
}
