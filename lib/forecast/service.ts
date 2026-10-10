import "server-only";
import { UserFacingError } from "../errors";
import { isCrypto } from "../market/crypto";
import { history } from "../market/sources";
import { alignCloses } from "./align";
import { HORIZONS, returnMatrix, simulate, type Forecast, type Horizon } from "./montecarlo";

export type Exposure = { symbol: string; value: number };

/**
 * Forecast the combined value of several exposures. For a single stock pass
 * its current price as the value; for a portfolio pass each position's
 * market value.
 */
export async function forecastExposures(exposures: Exposure[], horizon: Horizon): Promise<Forecast & { symbols: string[] }> {
  const live = exposures.filter((e) => e.value > 0);
  if (live.length === 0) throw new UserFacingError("Nothing to forecast yet. Add holdings with shares and a price.");
  // The model counts trading days (252 a year); crypto trades all seven, so its ranges would be wrong.
  if (live.some((e) => isCrypto(e.symbol))) throw new UserFacingError("Forecasts cover stocks, funds and indexes. Crypto isn't supported yet.");
  const series = await Promise.all(live.map((e) => history(e.symbol, "1y")));
  const closes = alignCloses(series);
  const returns = returnMatrix(closes);
  if (returns.length < 20) throw new UserFacingError("Not enough shared price history to forecast these symbols yet.");
  const forecast = simulate({ returns, values: live.map((e) => e.value), horizonDays: HORIZONS[horizon] });
  return { ...forecast, symbols: live.map((e) => e.symbol) };
}
