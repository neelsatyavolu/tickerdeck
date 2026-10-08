// Monte Carlo price ranges from resampled daily returns.
//
// Each simulated day draws one historical day at random and applies that
// day's return to every asset. Drawing whole days keeps the way assets moved
// together. Historical mean returns are removed and replaced by a single
// assumed drift, because one year of mean return is mostly noise.

export const HORIZONS = { "1w": 5, "1m": 21, "3m": 63, "6m": 126, "1y": 252 } as const;
export type Horizon = keyof typeof HORIZONS;
export const DEFAULT_ANNUAL_DRIFT = 0.07;
const TRADING_DAYS = 252;
const MAX_CHECKPOINTS = 26;

export type Rng = () => number;

export type Percentiles = { p5: number; p25: number; p50: number; p75: number; p95: number };
export type BandPoint = Percentiles & { day: number };

export type Forecast = {
  horizonDays: number;
  start: number;
  end: Percentiles;
  bands: BandPoint[];
  probGain: number;
  annualVol: number;
  annualDrift: number;
  paths: number;
  sampleDays: number;
};

export type SimulateInput = {
  /** Daily log returns, one row per historical day, one column per asset. */
  returns: number[][];
  /** Current value of each asset (price for a single stock, market value for a position). */
  values: number[];
  horizonDays: number;
  paths?: number;
  annualDrift?: number;
  rng?: Rng;
};

/** Small seeded PRNG so tests are deterministic. */
export function mulberry32(seed: number): Rng {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function logReturns(closes: number[]): number[] {
  const out: number[] = [];
  for (let i = 1; i < closes.length; i++) {
    const a = closes[i - 1];
    const b = closes[i];
    if (a > 0 && b > 0) out.push(Math.log(b / a));
  }
  return out;
}

/** Closes per asset aligned on shared dates → daily log-return rows. */
export function returnMatrix(closesByAsset: number[][]): number[][] {
  const days = Math.min(...closesByAsset.map((c) => c.length));
  const rows: number[][] = [];
  for (let i = 1; i < days; i++) {
    const row = closesByAsset.map((c) => Math.log(c[i] / c[i - 1]));
    if (row.every(Number.isFinite)) rows.push(row);
  }
  return rows;
}

export function percentile(sorted: number[], q: number): number {
  if (sorted.length === 0) return NaN;
  const pos = (sorted.length - 1) * q;
  const lo = Math.floor(pos);
  const hi = Math.ceil(pos);
  return sorted[lo] + (sorted[hi] - sorted[lo]) * (pos - lo);
}

function percentilesOf(values: Float64Array): Percentiles {
  const sorted = Array.from(values).sort((x, y) => x - y);
  return {
    p5: percentile(sorted, 0.05),
    p25: percentile(sorted, 0.25),
    p50: percentile(sorted, 0.5),
    p75: percentile(sorted, 0.75),
    p95: percentile(sorted, 0.95),
  };
}

function checkpoints(horizonDays: number): number[] {
  const step = Math.max(1, Math.ceil(horizonDays / MAX_CHECKPOINTS));
  const days: number[] = [];
  for (let d = step; d < horizonDays; d += step) days.push(d);
  days.push(horizonDays);
  return days;
}

function demean(returns: number[][], dailyDrift: number): number[][] {
  const cols = returns[0].length;
  const means = Array.from({ length: cols }, (_, j) =>
    returns.reduce((sum, row) => sum + row[j], 0) / returns.length,
  );
  return returns.map((row) => row.map((r, j) => r - means[j] + dailyDrift));
}

function annualizedVol(returns: number[][], values: number[]): number {
  const total = values.reduce((a, b) => a + b, 0);
  const weights = values.map((v) => v / total);
  const daily = returns.map((row) => row.reduce((sum, r, j) => sum + r * weights[j], 0));
  const mean = daily.reduce((a, b) => a + b, 0) / daily.length;
  const variance = daily.reduce((s, r) => s + (r - mean) ** 2, 0) / Math.max(1, daily.length - 1);
  return Math.sqrt(variance * TRADING_DAYS);
}

export function simulate(input: SimulateInput): Forecast {
  const { returns, values, horizonDays } = input;
  const paths = input.paths ?? 5000;
  const annualDrift = input.annualDrift ?? DEFAULT_ANNUAL_DRIFT;
  const rng = input.rng ?? Math.random;

  if (returns.length < 20) throw new Error("Need at least 20 days of price history to forecast.");
  if (values.length === 0 || values.length !== returns[0].length) {
    throw new Error("Each asset needs a current value and a return history.");
  }
  if (!Number.isInteger(horizonDays) || horizonDays < 1) throw new Error("Horizon must be a positive number of days.");

  const adjusted = demean(returns, Math.log(1 + annualDrift) / TRADING_DAYS);
  const start = values.reduce((a, b) => a + b, 0);
  const marks = checkpoints(horizonDays);
  const atMark = marks.map(() => new Float64Array(paths));

  const current = new Float64Array(values.length);
  for (let p = 0; p < paths; p++) {
    current.set(values);
    let m = 0;
    for (let d = 1; d <= horizonDays; d++) {
      const row = adjusted[Math.floor(rng() * adjusted.length)];
      for (let j = 0; j < current.length; j++) current[j] *= Math.exp(row[j]);
      if (d === marks[m]) {
        let sum = 0;
        for (let j = 0; j < current.length; j++) sum += current[j];
        atMark[m][p] = sum;
        m++;
      }
    }
  }

  const finals = atMark[atMark.length - 1];
  let gains = 0;
  for (const v of finals) if (v > start) gains++;

  return {
    horizonDays,
    start,
    end: percentilesOf(finals),
    bands: [
      { day: 0, p5: start, p25: start, p50: start, p75: start, p95: start },
      ...marks.map((day, i) => ({ day, ...percentilesOf(atMark[i]) })),
    ],
    probGain: gains / paths,
    annualVol: annualizedVol(returns, values),
    annualDrift,
    paths,
    sampleDays: returns.length,
  };
}
