export const PORTFOLIO_KINDS = ["holdings", "watchlist", "paper"] as const;
export type PortfolioKind = (typeof PORTFOLIO_KINDS)[number];

export type Holding = {
  id: string;
  portfolio_id: string;
  symbol: string;
  shares: number;
  cost_basis: number; // per share
  bought_at: string | null; // YYYY-MM-DD
  note: string | null;
};

export type Portfolio = {
  id: string;
  name: string;
  kind: PortfolioKind;
  starting_cash: number | null;
  start_date: string | null;
  created_at: string;
  holdings: Holding[];
};

export type Quote = { price: number; prevClose: number };
