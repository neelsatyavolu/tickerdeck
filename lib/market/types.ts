export type QuoteSnapshot = { symbol: string; price: number; prevClose: number; time: number };

export type PricePoint = { t: number; close: number; volume?: number };

export type Profile = {
  name: string;
  exchange: string | null;
  industry: string | null;
  marketCap: number | null;
  logo: string | null;
  url: string | null;
  currency: string;
};

export type Recommendation = {
  period: string;
  strongBuy: number;
  buy: number;
  hold: number;
  sell: number;
  strongSell: number;
};

export type AnalystTargets = {
  low: number | null;
  mean: number | null;
  median: number | null;
  high: number | null;
  analysts: number | null;
  rating: string | null;
};

export type NewsItem = { time: number; headline: string; source: string; url: string; summary: string };

export type SymbolMatch = { symbol: string; name: string; type: string };

export const HISTORY_RANGES = ["1mo", "3mo", "6mo", "1y", "2y", "5y", "10y"] as const;
export type HistoryRange = (typeof HISTORY_RANGES)[number];

export type TargetPoint = { t: number; target: number; buy: number; hold: number; sell: number };

/** Key figures for the stats grid; any of them can be missing (ETFs have few). */
export type KeyStats = {
  name: string | null;
  exchange: string | null;
  sector: string | null;
  industry: string | null;
  assetClass: "stocks" | "etf" | "mutualfunds" | "index" | null;
  marketCap: number | null;
  peTTM: number | null;
  epsTTM: number | null;
  pegTTM: number | null;
  psTTM: number | null;
  pb: number | null;
  beta: number | null;
  high52: number | null;
  low52: number | null;
  avgVolume10d: number | null;
  dividendYield: number | null;
  annualDividend: number | null;
  exDividendDate: string | null;
  grossMargin: number | null;
  operatingMargin: number | null;
  netMargin: number | null;
  roe: number | null;
  revenueGrowthYoy: number | null;
  epsGrowthYoy: number | null;
  debtToEquity: number | null;
  ytdReturn: number | null;
  relativeToSP500Ytd: number | null;
};

export type EarningsPoint = { period: string; actual: number | null; estimate: number | null; surprisePercent: number | null };
