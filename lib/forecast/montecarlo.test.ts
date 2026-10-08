import { describe, expect, it } from "vitest";
import { logReturns, mulberry32, percentile, returnMatrix, simulate } from "./montecarlo";

function gbmCloses(n: number, dailyVol: number, seed: number): number[] {
  const rng = mulberry32(seed);
  const closes = [100];
  for (let i = 1; i < n; i++) {
    // Box-Muller normal draw
    const z = Math.sqrt(-2 * Math.log(rng() || 1e-12)) * Math.cos(2 * Math.PI * rng());
    closes.push(closes[i - 1] * Math.exp(dailyVol * z));
  }
  return closes;
}

describe("logReturns", () => {
  it("returns log ratios and skips non-positive prices", () => {
    const r = logReturns([100, 110, 0, 121]);
    expect(r).toHaveLength(1);
    expect(r[0]).toBeCloseTo(Math.log(1.1));
  });
});

describe("percentile", () => {
  it("interpolates linearly", () => {
    expect(percentile([0, 10], 0.5)).toBe(5);
    expect(percentile([1, 2, 3, 4, 5], 0.25)).toBe(2);
  });
});

describe("returnMatrix", () => {
  it("builds rows over the shortest series", () => {
    const rows = returnMatrix([[1, 2, 4], [10, 10]]);
    expect(rows).toEqual([[Math.log(2), 0]]);
  });
});

describe("simulate", () => {
  const closes = gbmCloses(253, 0.02, 7);
  const returns = logReturns(closes).map((r) => [r]);

  it("is deterministic with a seeded rng", () => {
    const a = simulate({ returns, values: [100], horizonDays: 21, paths: 500, rng: mulberry32(1) });
    const b = simulate({ returns, values: [100], horizonDays: 21, paths: 500, rng: mulberry32(1) });
    expect(a).toEqual(b);
  });

  it("produces ordered percentiles that widen with the horizon", () => {
    const f = simulate({ returns, values: [100], horizonDays: 63, paths: 2000, rng: mulberry32(2) });
    const { p5, p25, p50, p75, p95 } = f.end;
    expect(p5).toBeLessThan(p25);
    expect(p25).toBeLessThan(p50);
    expect(p50).toBeLessThan(p75);
    expect(p75).toBeLessThan(p95);
    const first = f.bands[1];
    const last = f.bands[f.bands.length - 1];
    expect(last.p95 - last.p5).toBeGreaterThan(first.p95 - first.p5);
    expect(f.bands[0]).toMatchObject({ day: 0, p50: 100 });
    expect(last.day).toBe(63);
  });

  it("centres the median near the assumed drift, not the historical trend", () => {
    // A series that doubled in a year would project a huge median if the trend were kept.
    const trending = closes.map((c, i) => c * Math.exp((Math.log(2) * i) / 252));
    const rets = logReturns(trending).map((r) => [r]);
    const f = simulate({ returns: rets, values: [100], horizonDays: 252, paths: 4000, annualDrift: 0, rng: mulberry32(3) });
    expect(f.end.p50).toBeGreaterThan(80);
    expect(f.end.p50).toBeLessThan(120);
    expect(f.probGain).toBeGreaterThan(0.35);
    expect(f.probGain).toBeLessThan(0.65);
  });

  it("estimates annual volatility from daily returns", () => {
    const f = simulate({ returns, values: [100], horizonDays: 5, paths: 100, rng: mulberry32(4) });
    expect(f.annualVol).toBeGreaterThan(0.2);
    expect(f.annualVol).toBeLessThan(0.45); // 2% daily ≈ 32% annual
  });

  it("sums multiple assets into one portfolio value", () => {
    const two = returns.map((row) => [row[0], -row[0]]);
    const f = simulate({ returns: two, values: [500, 500], horizonDays: 21, paths: 1000, annualDrift: 0, rng: mulberry32(5) });
    expect(f.start).toBe(1000);
    // Perfectly offsetting assets keep the portfolio far tighter than either alone.
    expect(f.annualVol).toBeLessThan(0.01);
  });

  it("rejects too little history and mismatched inputs", () => {
    expect(() => simulate({ returns: returns.slice(0, 5), values: [100], horizonDays: 5 })).toThrow(/20 days/);
    expect(() => simulate({ returns, values: [100, 1], horizonDays: 5 })).toThrow(/current value/);
    expect(() => simulate({ returns, values: [100], horizonDays: 0 })).toThrow(/Horizon/);
  });
});
