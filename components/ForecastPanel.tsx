"use client";

import { useEffect, useRef, useState } from "react";
import { postJson } from "@/lib/client/api";
import { HORIZONS, type Forecast, type Horizon } from "@/lib/forecast/montecarlo";
import { plainPct, usd } from "@/lib/format";
import { FanChart } from "./charts/FanChart";
import type { SeriesPoint } from "./charts/LineChart";
import { ErrorText, Seg, Tile } from "./ui";

type Exposure = { symbol: string; value: number };

type Props = {
  /** Current exposures. Read when a forecast runs, so live ticks don't trigger reruns. */
  exposures: Exposure[];
  /** Changes only when what's held changes (symbols/shares), which triggers a rerun. */
  runKey: string;
  history: SeriesPoint[];
  onAskOutlook?: () => void;
  /** Called once the first forecast has resolved (or can't run), for page loaders. */
  onSettled?: () => void;
};

const HORIZON_LABEL: Record<Horizon, string> = { "1w": "1 week", "1m": "1 month", "3m": "3 months", "6m": "6 months", "1y": "1 year" };
const HORIZON_KEYS = Object.keys(HORIZONS) as Horizon[];

export function ForecastPanel({ exposures, runKey, history, onAskOutlook, onSettled }: Props) {
  const [horizon, setHorizon] = useState<Horizon>("3m");
  const [result, setResult] = useState<{ id: string; forecast: Forecast | null; error: string | null } | null>(null);
  const latest = useRef(exposures);
  const ready = exposures.some((e) => e.value > 0);
  const id = `${horizon}|${runKey}`;

  useEffect(() => {
    latest.current = exposures;
  });

  useEffect(() => {
    if (!ready) return;
    let cancelled = false;
    const runId = `${horizon}|${runKey}`;
    postJson<Forecast>("/api/forecast", { horizon, exposures: latest.current.filter((e) => e.value > 0) })
      .then((f) => !cancelled && setResult({ id: runId, forecast: f, error: null }))
      .catch((err) => !cancelled && setResult({ id: runId, forecast: null, error: err instanceof Error ? err.message : "Forecast failed." }));
    return () => {
      cancelled = true;
    };
  }, [horizon, runKey, ready]);

  // Keep the previous chart visible (dimmed) while a new horizon runs.
  const loading = result?.id !== id;
  const settled = !ready || !loading;
  useEffect(() => {
    if (settled) onSettled?.();
  }, [settled, onSettled]);
  const forecast = result?.forecast ?? null;
  const error = !loading ? result?.error ?? null : null;

  // Show the tail of history at roughly the same span as the forecast.
  const tail = history.slice(-Math.max(HORIZONS[horizon] * 2, 40));

  return (
    <div className="stack">
      <div className="spread">
        <Seg label="Forecast horizon" value={horizon} options={HORIZON_KEYS} onChange={setHorizon} />
        {onAskOutlook && <button className="btn btn-ghost" onClick={onAskOutlook}>AI outlook</button>}
      </div>
      {!ready ? (
        <div className="notice">Forecasts appear once there are priced holdings with shares.</div>
      ) : error ? (
        <ErrorText error={error} />
      ) : !forecast ? (
        <div className="notice">Simulating<span className="caret" aria-hidden="true" /></div>
      ) : (
        <div style={{ opacity: loading ? 0.5 : 1, transition: "opacity 150ms" }}>
          <FanChart history={tail} forecast={forecast} />
          <div className="grid-cells cols-4" style={{ marginTop: 16 }}>
            <Tile label={`Median in ${HORIZON_LABEL[horizon]}`} value={usd(forecast.end.p50)} sub={plainPct(forecast.end.p50 / forecast.start - 1)} />
            <Tile label="90% range" value={<span className="num" style={{ fontSize: 17 }}>{usd(forecast.end.p5, { digits: 0 })} – {usd(forecast.end.p95, { digits: 0 })}</span>} />
            <Tile label="Chance of gain" value={plainPct(forecast.probGain, 0)} />
            <Tile label="Annual volatility" value={plainPct(forecast.annualVol, 0)} />
          </div>
          <p className="notice" style={{ marginTop: 8 }}>
            {forecast.paths.toLocaleString()} simulated paths resampling {forecast.sampleDays} trading days of returns, with the median assumed to grow {plainPct(forecast.annualDrift, 0)}/yr. This shows a range based on past volatility. It is not a prediction.
          </p>
        </div>
      )}
    </div>
  );
}
