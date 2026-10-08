export type QuoteSnapshot = { symbol: string; price: number; prevClose: number; time: number };

export type PricePoint = { t: number; close: number };

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

export const HISTORY_RANGES = ["1mo", "3mo", "6mo", "1y", "2y", "5y"] as const;
export type HistoryRange = (typeof HISTORY_RANGES)[number];
