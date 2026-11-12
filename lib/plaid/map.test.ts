import { describe, expect, it } from "vitest";
import { mapHoldings, type PlaidHoldingsData } from "./map";

const account = (over: Partial<PlaidHoldingsData["accounts"][number]> = {}) => ({ account_id: "acc-1", name: "Roth IRA", mask: "1234", type: "investment", ...over });
const security = (over: Partial<PlaidHoldingsData["securities"][number]> = {}) => ({ security_id: "sec-1", ticker_symbol: "AAPL", name: "Apple Inc.", type: "equity", is_cash_equivalent: false, ...over });
const holding = (over: Partial<PlaidHoldingsData["holdings"][number]> = {}) => ({ account_id: "acc-1", security_id: "sec-1", quantity: 10, cost_basis: 1500, ...over });

const data = (over: Partial<PlaidHoldingsData> = {}): PlaidHoldingsData => ({ accounts: [account()], securities: [security()], holdings: [holding()], ...over });

describe("mapHoldings", () => {
  it("turns a position into one lot with a per-share cost and no purchase date", () => {
    const [mapped] = mapHoldings("Schwab", data());
    expect(mapped.lots).toEqual([{ symbol: "AAPL", shares: 10, cost_basis: 150, note: null }]);
    expect(mapped.skipped).toEqual([]);
  });

  it("names the portfolio after the brokerage, the account and its last digits", () => {
    expect(mapHoldings("Schwab", data())[0]).toMatchObject({ accountId: "acc-1", name: "Schwab Roth IRA ··1234" });
    expect(mapHoldings("Schwab", data({ accounts: [account({ mask: null })] }))[0].name).toBe("Schwab Roth IRA");
  });

  it("keeps the portfolio name within the 80-character limit", () => {
    const [mapped] = mapHoldings("Schwab", data({ accounts: [account({ name: "x".repeat(200) })] }));
    expect(mapped.name.length).toBeLessThanOrEqual(80);
    expect(mapped.name.endsWith("··1234")).toBe(true);
  });

  it("splits positions by account and ignores accounts that aren't investment accounts", () => {
    const mapped = mapHoldings(
      "Fidelity",
      data({
        accounts: [account(), account({ account_id: "acc-2", name: "Brokerage", mask: "9" }), account({ account_id: "acc-3", name: "Checking", type: "depository" })],
        holdings: [holding(), holding({ account_id: "acc-2", quantity: 2, cost_basis: 100 }), holding({ account_id: "acc-3" })],
      }),
    );
    expect(mapped.map((m) => m.accountId)).toEqual(["acc-1", "acc-2"]);
    expect(mapped[1].lots).toEqual([{ symbol: "AAPL", shares: 2, cost_basis: 50, note: null }]);
  });

  it("keeps an investment account that holds nothing, so its portfolio empties out", () => {
    expect(mapHoldings("Schwab", data({ holdings: [] }))).toEqual([{ accountId: "acc-1", name: "Schwab Roth IRA ··1234", lots: [], skipped: [] }]);
  });

  it("keeps ETFs and mutual funds", () => {
    const mapped = mapHoldings(
      "Vanguard",
      data({
        securities: [security({ security_id: "etf", ticker_symbol: "VTI", type: "etf" }), security({ security_id: "mf", ticker_symbol: "VTSAX", type: "mutual fund" })],
        holdings: [holding({ security_id: "etf" }), holding({ security_id: "mf" })],
      }),
    );
    expect(mapped[0].lots.map((l) => l.symbol)).toEqual(["VTI", "VTSAX"]);
  });

  it("stores cost 0 with a note when the brokerage reports no cost basis", () => {
    for (const cost_basis of [null, 0, -5]) {
      const [mapped] = mapHoldings("Robinhood", data({ holdings: [holding({ cost_basis })] }));
      expect(mapped.lots).toEqual([{ symbol: "AAPL", shares: 10, cost_basis: 0, note: "Robinhood did not report a cost basis." }]);
    }
  });

  it("rounds the per-share cost to what the database stores", () => {
    const [mapped] = mapHoldings("Schwab", data({ holdings: [holding({ quantity: 3, cost_basis: 100 })] }));
    expect(mapped.lots[0].cost_basis).toBe(33.333333);
  });

  it("skips and reports what tickerdeck can't hold", () => {
    const [mapped] = mapHoldings(
      "Schwab",
      data({
        securities: [
          security({ security_id: "cash", ticker_symbol: "CUR:USD", name: "U S Dollar", type: "cash", is_cash_equivalent: true }),
          security({ security_id: "mm", ticker_symbol: "SWVXX", name: "Schwab Value Advantage Money", type: "mutual fund", is_cash_equivalent: true }),
          security({ security_id: "opt", ticker_symbol: "AAPL250117C00200000", name: "AAPL Jan 2025 call", type: "derivative" }),
          security({ security_id: "bond", ticker_symbol: null, name: "US Treasury 4.5%", type: "fixed income" }),
          security({ security_id: "btc", ticker_symbol: "BTC", name: "Bitcoin", type: "cryptocurrency" }),
          security({ security_id: "noticker", ticker_symbol: null, name: "Private Fund LP", type: "equity" }),
          security({ security_id: "foreign", ticker_symbol: "7203:TYO", name: "Toyota", type: "equity" }),
          security({ security_id: "short", ticker_symbol: "TSLA", name: "Tesla", type: "equity" }),
        ],
        holdings: [
          holding({ security_id: "cash" }),
          holding({ security_id: "mm" }),
          holding({ security_id: "opt" }),
          holding({ security_id: "bond" }),
          holding({ security_id: "btc" }),
          holding({ security_id: "noticker" }),
          holding({ security_id: "foreign" }),
          holding({ security_id: "short", quantity: -4 }),
          holding({ security_id: "missing" }),
        ],
      }),
    );
    expect(mapped.lots).toEqual([]);
    expect(mapped.skipped).toEqual([
      { name: "U S Dollar", reason: "cash" },
      { name: "SWVXX", reason: "cash" },
      { name: "AAPL Jan 2025 call", reason: "option or other derivative" },
      { name: "US Treasury 4.5%", reason: "bond" },
      { name: "BTC", reason: "crypto" },
      { name: "Private Fund LP", reason: "no US ticker" },
      { name: "Toyota", reason: "no US ticker" },
      { name: "TSLA", reason: "short or empty position" },
      { name: "Unknown security", reason: "unrecognised security" },
    ]);
  });

  it("skips positions that aren't in US dollars, since prices here are", () => {
    const [mapped] = mapHoldings("Schwab", data({ holdings: [holding({ iso_currency_code: "CAD" }), holding({ iso_currency_code: "USD" }), holding({ iso_currency_code: null })] }));
    expect(mapped.lots).toHaveLength(2);
    expect(mapped.skipped).toEqual([{ name: "AAPL", reason: "not in US dollars" }]);
  });

  it("stores shares to the eight decimals the database keeps, and skips dust that rounds to nothing", () => {
    const [mapped] = mapHoldings("Robinhood", data({ holdings: [holding({ quantity: 0.123456789, cost_basis: 12.3456789 }), holding({ quantity: 1e-9, cost_basis: 0.01 })] }));
    expect(mapped.lots).toEqual([{ symbol: "AAPL", shares: 0.12345679, cost_basis: 100, note: null }]);
    expect(mapped.skipped).toEqual([{ name: "AAPL", reason: "short or empty position" }]);
  });

  it("skips a position whose numbers the database couldn't store, instead of failing the whole sync", () => {
    const [mapped] = mapHoldings("Schwab", data({ holdings: [holding({ quantity: 0.001, cost_basis: 5e9 }), holding({ quantity: 5e12, cost_basis: 10 })] }));
    expect(mapped.lots).toEqual([]);
    expect(mapped.skipped).toEqual([{ name: "AAPL", reason: "amount out of range" }, { name: "AAPL", reason: "amount out of range" }]);
  });

  it("takes an account once even if the brokerage lists it twice", () => {
    const mapped = mapHoldings("Schwab", data({ accounts: [account(), account()] }));
    expect(mapped).toHaveLength(1);
    expect(mapped[0].lots).toHaveLength(1);
  });

  it("normalises the ticker's case and spacing", () => {
    const [mapped] = mapHoldings("Schwab", data({ securities: [security({ ticker_symbol: " brk.b " })] }));
    expect(mapped.lots[0].symbol).toBe("BRK.B");
  });
});
