// Market indexes, named the way Yahoo Finance names them (so links work),
// with the CNBC symbol used to price them.

export type IndexInfo = { symbol: string; name: string; cnbc: string; aliases: string[] };

export const INDEXES: IndexInfo[] = [
  { symbol: "^GSPC", name: "S&P 500", cnbc: ".SPX", aliases: ["s&p", "s&p 500", "sp500", "spx", "standard & poor"] },
  { symbol: "^DJI", name: "Dow Jones Industrial Average", cnbc: ".DJI", aliases: ["dow", "dow jones", "djia", "dji"] },
  { symbol: "^IXIC", name: "Nasdaq Composite", cnbc: ".IXIC", aliases: ["nasdaq", "nasdaq composite", "ixic", "comp"] },
  { symbol: "^NDX", name: "Nasdaq-100", cnbc: ".NDX", aliases: ["nasdaq 100", "nasdaq-100", "ndx"] },
  { symbol: "^RUT", name: "Russell 2000", cnbc: ".RUT", aliases: ["russell", "russell 2000", "rut", "small cap"] },
  { symbol: "^VIX", name: "CBOE Volatility Index", cnbc: ".VIX", aliases: ["vix", "volatility", "fear index"] },
];

const BY_SYMBOL = new Map(INDEXES.map((i) => [i.symbol, i]));

export const isIndex = (symbol: string) => BY_SYMBOL.has(symbol);
export const indexInfo = (symbol: string) => BY_SYMBOL.get(symbol) ?? null;

/** Indexes whose symbol, name or alias matches the query. */
export function searchIndexes(query: string): IndexInfo[] {
  const q = query.trim().toLowerCase();
  if (!q) return [];
  return INDEXES.filter(
    (i) => i.symbol.toLowerCase() === q || i.symbol.slice(1).toLowerCase().startsWith(q.replace(/^\^/, "")) || i.name.toLowerCase().includes(q) || i.aliases.some((a) => a.startsWith(q) || q.startsWith(a)),
  );
}
