// Common company and index names → symbols, so questions like "what's Nike's
// P/E" or "how has the Dow done over 10 years" find the right data.
// Longer names first so "berkshire hathaway a" wins over "berkshire". Names that
// are also everyday words ("target", "snap", "zoom", "visa") are left out on purpose;
// their tickers still work.

const NAMES: [string, string][] = [
  ["berkshire hathaway a", "BRK.A"], ["berkshire hathaway class a", "BRK.A"], ["berkshire a", "BRK.A"],
  ["berkshire hathaway b", "BRK.B"], ["berkshire hathaway", "BRK.B"], ["berkshire", "BRK.B"],
  ["dow jones industrial average", "^DJI"], ["dow jones", "^DJI"], ["djia", "^DJI"], ["the dow", "^DJI"],
  ["nasdaq composite", "^IXIC"], ["nasdaq 100", "^NDX"], ["nasdaq-100", "^NDX"], ["nasdaq", "^IXIC"],
  ["s&p 500", "^GSPC"], ["s&p", "^GSPC"], ["sp500", "^GSPC"], ["russell 2000", "^RUT"], ["vix", "^VIX"],
  ["coca-cola", "KO"], ["coca cola", "KO"], ["coke", "KO"], ["pepsico", "PEP"], ["pepsi", "PEP"],
  ["facebook", "META"], ["meta platforms", "META"], ["instagram", "META"],
  ["alphabet", "GOOG"], ["google", "GOOG"], ["youtube", "GOOG"],
  ["apple", "AAPL"], ["microsoft", "MSFT"], ["amazon", "AMZN"], ["nvidia", "NVDA"], ["tesla", "TSLA"],
  ["netflix", "NFLX"], ["nike", "NKE"], ["costco", "COST"], ["ebay", "EBAY"], ["starbucks", "SBUX"],
  ["walmart", "WMT"], ["home depot", "HD"], ["lowe's", "LOW"], ["mcdonald's", "MCD"], ["mcdonalds", "MCD"],
  ["chipotle", "CMG"], ["disney", "DIS"], ["walt disney", "DIS"], ["comcast", "CMCSA"], ["verizon", "VZ"], ["at&t", "T"], ["t-mobile", "TMUS"],
  ["intel", "INTC"], ["amd", "AMD"], ["advanced micro devices", "AMD"], ["qualcomm", "QCOM"], ["broadcom", "AVGO"], ["micron", "MU"],
  ["ibm", "IBM"], ["oracle", "ORCL"], ["salesforce", "CRM"], ["adobe", "ADBE"], ["cisco", "CSCO"], ["palantir", "PLTR"],
  ["paypal", "PYPL"], ["mastercard", "MA"], ["american express", "AXP"], ["jpmorgan", "JPM"], ["jp morgan", "JPM"],
  ["bank of america", "BAC"], ["wells fargo", "WFC"], ["goldman sachs", "GS"], ["morgan stanley", "MS"],
  ["boeing", "BA"], ["ford", "F"], ["general motors", "GM"], ["exxon", "XOM"], ["exxonmobil", "XOM"], ["chevron", "CVX"],
  ["pfizer", "PFE"], ["johnson & johnson", "JNJ"], ["johnson and johnson", "JNJ"], ["eli lilly", "LLY"], ["merck", "MRK"], ["moderna", "MRNA"],
  ["procter & gamble", "PG"], ["procter and gamble", "PG"], ["unitedhealth", "UNH"], ["cvs", "CVS"],
  ["uber", "UBER"], ["lyft", "LYFT"], ["airbnb", "ABNB"], ["spotify", "SPOT"], ["snapchat", "SNAP"], ["pinterest", "PINS"],
  ["shopify", "SHOP"], ["coinbase", "COIN"], ["robinhood", "HOOD"], ["gamestop", "GME"], ["amc", "AMC"],
  ["lululemon", "LULU"], ["dominos", "DPZ"], ["domino's", "DPZ"], ["kraft heinz", "KHC"], ["hershey", "HSY"], ["mondelez", "MDLZ"],
  ["3m", "MMM"], ["caterpillar", "CAT"], ["general electric", "GE"], ["honeywell", "HON"], ["lockheed martin", "LMT"],
  ["dell", "DELL"], ["hp", "HPQ"], ["sony", "SONY"], ["toyota", "TM"], ["alibaba", "BABA"], ["taiwan semiconductor", "TSM"], ["tsmc", "TSM"],
];

const escape = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
const PATTERNS = NAMES.map(([name, symbol]) => ({ symbol, re: new RegExp(`(^|[^a-z0-9])${escape(name)}('s)?(?=$|[^a-z0-9])`, "i") }));

/** Symbols for company or index names in the text, in order of appearance. */
export function namedSymbols(text: string): string[] {
  const hits: { at: number; symbol: string; len: number }[] = [];
  const taken: [number, number][] = [];
  for (const { symbol, re } of PATTERNS) {
    const m = re.exec(text);
    if (!m) continue;
    const start = m.index + m[1].length;
    const end = m.index + m[0].length;
    if (taken.some(([a, b]) => start < b && end > a)) continue; // a longer name already claimed this text
    taken.push([start, end]);
    hits.push({ at: start, symbol, len: end - start });
  }
  return [...new Set(hits.sort((a, b) => a.at - b.at).map((h) => h.symbol))];
}
