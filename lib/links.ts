/** Yahoo Finance writes share classes with a dash: BRK.B → BRK-B. */
export function yahooSymbol(symbol: string): string {
  return symbol.replace(/\./g, "-");
}

export const YAHOO_PAGES = [
  ["Summary", ""],
  ["Chart", "chart"],
  ["Statistics", "key-statistics"],
  ["Financials", "financials"],
  ["Analysis", "analysis"],
  ["Holders", "holders"],
  ["Options", "options"],
  ["News", "news"],
] as const;

export function yahooUrl(symbol: string, page = ""): string {
  const base = `https://finance.yahoo.com/quote/${encodeURIComponent(yahooSymbol(symbol))}/`;
  return page ? `${base}${page}/` : base;
}
