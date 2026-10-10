// Cryptocurrencies, named the way Yahoo Finance names them (BTC-USD, so links
// work) and priced in US dollars from Coinbase, where the same string is the
// product id. Watch-only, like indexes: they can't be held in a portfolio.

export type CryptoInfo = { symbol: string; name: string };

const COINS: [base: string, name: string][] = [
  ["BTC", "Bitcoin"],
  ["ETH", "Ethereum"],
  ["SOL", "Solana"],
  ["XRP", "XRP"],
  ["BNB", "BNB"],
  ["DOGE", "Dogecoin"],
  ["ADA", "Cardano"],
  ["LINK", "Chainlink"],
  ["AVAX", "Avalanche"],
  ["LTC", "Litecoin"],
  ["BCH", "Bitcoin Cash"],
  ["DOT", "Polkadot"],
  ["XLM", "Stellar"],
  ["UNI", "Uniswap"],
  ["SUI", "Sui"],
  ["HBAR", "Hedera"],
  ["TON", "Toncoin"],
  ["NEAR", "NEAR Protocol"],
  ["AAVE", "Aave"],
  ["ATOM", "Cosmos"],
  ["ICP", "Internet Computer"],
  ["ETC", "Ethereum Classic"],
  ["FIL", "Filecoin"],
  ["APT", "Aptos"],
  ["ARB", "Arbitrum"],
  ["OP", "Optimism"],
  ["ALGO", "Algorand"],
];

export const CRYPTO: CryptoInfo[] = COINS.map(([base, name]) => ({ symbol: `${base}-USD`, name }));

const BY_SYMBOL = new Map(CRYPTO.map((c) => [c.symbol, c]));

export const isCrypto = (symbol: string) => BY_SYMBOL.has(symbol);
export const cryptoInfo = (symbol: string) => BY_SYMBOL.get(symbol) ?? null;

const MIN_QUERY = 2; // one letter is almost always the start of a stock ticker

/** Coins whose ticker or pair starts with the query, or whose name has a word that does. */
export function searchCrypto(query: string): CryptoInfo[] {
  const q = query.trim().toLowerCase();
  if (q.length < MIN_QUERY) return [];
  return CRYPTO.filter((c) => c.symbol.toLowerCase().startsWith(q) || c.name.toLowerCase().split(" ").some((word) => word.startsWith(q)));
}
