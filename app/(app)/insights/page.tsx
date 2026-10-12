"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { PageGate } from "@/components/PageGate";
import { usePortfolios } from "@/components/Portfolios";
import { ErrorText, Seg } from "@/components/ui";
import { useWatchlist } from "@/components/Watchlist";
import { INSIGHT_CATEGORIES, isStale, type Insight, type InsightSet } from "@/lib/ai/insights";
import { effortOf, useAiPrefs, type Provider } from "@/lib/client/aiPrefs";
import { api, postJson } from "@/lib/client/api";
import { timeAgo } from "@/lib/format";
import { uniqueSymbols } from "@/lib/portfolio/math";

// AI insights: short findings about what you hold and watch, and the market,
// written by your connected ChatGPT or Grok subscription. The latest set is
// saved, so it shows at once; it is rewritten on Refresh, or when you open the
// page and it is over a day old.

type Status = Record<Provider, boolean>;
const ALL = "All";
const PROVIDER_LABEL: Record<Provider, string> = { codex: "ChatGPT", grok: "Grok" };
const TONE_LABEL: Record<Insight["tone"], string> = { up: "Good news", down: "Bad news", neutral: "Neutral" };

const hostOf = (url: string) => new URL(url).hostname.replace(/^www\./, "");

async function loadStatus(): Promise<Status> {
  try {
    return (await fetch("/api/ai/status").then((r) => r.json())) as Status;
  } catch {
    return { codex: false, grok: false };
  }
}

function Card({ insight, mine }: { insight: Insight; mine: Set<string> }) {
  return (
    <article className="insight-card">
      <div className="label insight-kind">
        <span className={`insight-dot ${insight.tone}`} role="img" aria-label={TONE_LABEL[insight.tone]} />
        {insight.category}
      </div>
      <h2 className="insight-title">{insight.title}</h2>
      <p className="insight-body">{insight.body}</p>
      {insight.symbols.length > 0 && (
        <div className="news-tickers">
          {insight.symbols.map((s) => (
            <Link key={s} href={`/s/${encodeURIComponent(s)}`} className={mine.has(s) ? "mine" : undefined}>{s}</Link>
          ))}
        </div>
      )}
      {insight.sources.length > 0 && (
        <div className="insight-sources">
          {insight.sources.map((s) => (
            <a key={s.url} href={s.url} target="_blank" rel="noopener noreferrer">{s.title ?? hostOf(s.url)}</a>
          ))}
        </div>
      )}
    </article>
  );
}

export default function InsightsPage() {
  const { portfolios, loading: loadingPortfolios } = usePortfolios();
  const { lists, loading: loadingWatch } = useWatchlist();
  const prefs = useAiPrefs();
  const [saved, setSaved] = useState<{ set: InsightSet | null } | null>(null);
  const [status, setStatus] = useState<Status | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [filter, setFilter] = useState<string>(ALL);
  const autoRan = useRef(false);

  useEffect(() => {
    let cancelled = false;
    api<InsightSet | null>("/api/ai/insights")
      .then((set) => !cancelled && setSaved({ set }))
      .catch((err) => {
        if (cancelled) return;
        setSaved({ set: null });
        setError(err instanceof Error ? err.message : "Could not load insights.");
      });
    loadStatus().then((s) => !cancelled && setStatus(s));
    return () => {
      cancelled = true;
    };
  }, []);

  const ready = !loadingPortfolios && !loadingWatch;
  const mine = useMemo(() => new Set([...uniqueSymbols(portfolios), ...lists.flatMap((l) => l.items.map((i) => i.symbol))]), [portfolios, lists]);
  // The provider to use: the saved default if it's connected, else whichever is.
  const provider: Provider | null =
    prefs.provider && status?.[prefs.provider] ? prefs.provider : status?.codex ? "codex" : status?.grok ? "grok" : null;
  const model = provider ? prefs.model[provider] : undefined;
  const effort = provider ? effortOf(prefs, provider) : undefined;
  const fast = provider === "codex" && prefs.fast;

  const generate = useCallback(async () => {
    if (!provider) return;
    setBusy(true);
    setError(null);
    try {
      const set = await postJson<InsightSet>("/api/ai/insights", { provider, model, effort, fast });
      setSaved({ set });
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not write insights.");
    } finally {
      setBusy(false);
    }
  }, [provider, model, effort, fast]);

  // Once per visit: write a set if there is none, or the saved one is over a day old.
  const set = saved?.set ?? null;
  const canWrite = ready && saved !== null && provider !== null && mine.size > 0;
  useEffect(() => {
    if (!canWrite || autoRan.current) return;
    const t = setTimeout(() => {
      autoRan.current = true;
      if (!set || isStale(set.generated_at)) void generate();
    }, 0);
    return () => clearTimeout(t);
  }, [canWrite, set, generate]);

  const insights = useMemo(() => set?.insights ?? [], [set]);
  const filters = useMemo(() => [ALL, ...INSIGHT_CATEGORIES.filter((c) => insights.some((i) => i.category === c))], [insights]);
  const active = filters.includes(filter) ? filter : ALL;
  const shown = active === ALL ? insights : insights.filter((i) => i.category === active);
  const steps = [
    { label: "Your portfolios and watchlists", done: ready },
    { label: "Saved insights", done: saved !== null && status !== null },
  ];

  return (
    <PageGate title="insights" steps={steps}>
      <div className="dash-head">
        <div>
          <div className="label">
            {set ? `Written ${timeAgo(Date.parse(set.generated_at))} by ${PROVIDER_LABEL[set.provider]} (${set.model})` : "Written by your ChatGPT or Grok subscription"}
          </div>
          <h1 className="display" style={{ marginTop: 6 }}>AI insights</h1>
        </div>
        <div className="row" style={{ gap: 8 }}>
          {filters.length > 2 && (
            <div className="insight-filters">
              <Seg label="Category" value={active} options={filters} onChange={setFilter} />
            </div>
          )}
          <button type="button" className="btn btn-ghost" onClick={generate} disabled={busy || !canWrite}>
            {busy ? "Writing…" : set ? "Refresh" : "Write insights"}
          </button>
        </div>
      </div>

      <ErrorText error={error} />
      {busy && (
        <div className="notice" role="status" style={{ marginTop: 24 }}>
          Reading your holdings and the market. This usually takes about a minute{set ? "; the insights below stay until the new ones are ready" : ""}.
        </div>
      )}
      {status && !provider && (
        <div className="notice" style={{ marginTop: 24 }}>
          Insights are written with your own ChatGPT or Grok subscription. <Link href="/settings" style={{ color: "var(--accent)" }}>Connect one in Settings</Link>{set ? " to refresh them." : " to get started."}
        </div>
      )}
      {ready && provider && mine.size === 0 && (
        <div className="notice" style={{ marginTop: 24 }}>Hold or watch a few stocks and insights about them show up here.</div>
      )}

      {shown.length > 0 && (
        <div className="grid-cells insight-grid">
          {shown.map((insight) => <Card key={`${insight.category}:${insight.title}`} insight={insight} mine={mine} />)}
        </div>
      )}
      {set && (
        <p className="notice" style={{ marginTop: 24, maxWidth: 680 }}>
          An AI model wrote these from your portfolio data, market data and web pages. It can get things wrong, and none of this is financial advice.
        </p>
      )}
    </PageGate>
  );
}
