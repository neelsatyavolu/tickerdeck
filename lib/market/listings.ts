import "server-only";
import { memo } from "./cache";
import { fetchJson } from "./http";
import { cleanName, type Listing } from "./symbolSearch";

// Every US stock and ETF (from Nasdaq's screener), for instant search. Loaded
// once a day into the shared cache; mutual funds aren't listed here and still
// come from the slower remote search.

const HEADERS = {
  "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130 Safari/537.36",
  Accept: "application/json",
};
const TTL = 24 * 60 * 60_000;
const SYMBOL_RE = /^[A-Z][A-Z0-9.-]{0,9}$/;

type StockRow = { symbol: string; name: string; marketCap?: string };
type EtfRow = { symbol: string; companyName: string };

/** Nasdaq writes share classes with a slash (BRK/A); we use a dot (BRK.A). */
export function normalizeListingSymbol(raw: string): string | null {
  const s = raw.trim().toUpperCase().replace("/", ".");
  return SYMBOL_RE.test(s) ? s : null;
}

export function toListings(stocks: StockRow[], etfs: EtfRow[]): Listing[] {
  const out = new Map<string, Listing>();
  for (const r of stocks) {
    const sym = normalizeListingSymbol(r.symbol);
    if (sym && r.name) out.set(sym, [sym, cleanName(r.name), "Stock", Number(r.marketCap) || 0]);
  }
  for (const r of etfs) {
    const sym = normalizeListingSymbol(r.symbol);
    if (sym && r.companyName && !out.has(sym)) out.set(sym, [sym, cleanName(r.companyName), "ETF", 0]);
  }
  return [...out.values()];
}

export function listings(): Promise<Listing[]> {
  return memo("nq:listings", TTL, async () => {
    const [stocks, etfs] = await Promise.all([
      fetchJson<{ data?: { rows?: StockRow[] } }>("nasdaq", "https://api.nasdaq.com/api/screener/stocks?tableonly=true&limit=10000&download=true", { headers: HEADERS, timeoutMs: 20_000 }),
      fetchJson<{ data?: { data?: { rows?: EtfRow[] } } }>("nasdaq", "https://api.nasdaq.com/api/screener/etf?tableonly=true&limit=10000&download=true", { headers: HEADERS, timeoutMs: 20_000 }).catch(() => ({ data: { data: { rows: [] } } })),
    ]);
    const list = toListings(stocks.data?.rows ?? [], etfs.data?.data?.rows ?? []);
    if (list.length < 1000) throw new Error("Listing index looks incomplete");
    return list;
  });
}
