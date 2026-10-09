"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { useDashboards } from "@/components/Dashboards";
import { PageGate } from "@/components/PageGate";
import { usePortfolios } from "@/components/Portfolios";
import { SymbolSearch } from "@/components/SymbolSearch";
import { ErrorText } from "@/components/ui";
import { useWatchlist } from "@/components/Watchlist";
import { PANEL_META } from "@/lib/dashboard/schema";
import { buildTemplate, TEMPLATES } from "@/lib/dashboard/templates";
import { timeAgo } from "@/lib/format";

export default function DashboardsPage() {
  const { dashboards, loading, error, create } = useDashboards();
  const { portfolios } = usePortfolios();
  const { items: watchlist } = useWatchlist();
  const router = useRouter();
  const [busy, setBusy] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [deepDive, setDeepDive] = useState("");
  const [blankName, setBlankName] = useState("");

  const start = async (key: string, make: () => Promise<string>) => {
    setBusy(key);
    setActionError(null);
    try {
      router.push(`/d/${await make()}`);
    } catch (err) {
      setActionError(err instanceof Error ? err.message : "Couldn't create the dashboard.");
      setBusy(null);
    }
  };

  const fromTemplate = (id: string, symbol?: string) =>
    start(id, async () => {
      const t = buildTemplate(id, {
        portfolios: portfolios.map((p) => ({ id: p.id, name: p.name, symbols: [...new Set(p.holdings.filter((h) => h.shares > 0).map((h) => h.symbol))] })),
        watchlist: watchlist.map((w) => w.symbol),
        symbol,
      });
      return create(t.name, t.panels);
    });

  return (
    <PageGate title="dashboards" steps={[{ label: "Dashboards", done: !loading }]}>
      <div className="label">{dashboards.length} dashboard{dashboards.length === 1 ? "" : "s"}</div>
      <h1 className="display" style={{ marginTop: 8 }}>Dashboards</h1>
      <ErrorText error={error ?? actionError} />

      {dashboards.length > 0 && (
        <section className="section" style={{ marginTop: 24 }}>
          <div style={{ borderTop: "1px solid var(--border)" }}>
            {dashboards.map((d) => (
              <Link key={d.id} href={`/d/${d.id}`} className="list-row" style={{ gridTemplateColumns: "minmax(0, 2fr) minmax(0, 3fr) auto" }}>
                <span style={{ fontWeight: 500 }}>{d.name}</span>
                <span className="faint mono hide-sm" style={{ fontSize: 12, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                  {d.panels.length} panels · {[...new Set(d.panels.map((p) => PANEL_META[p.type].label))].join(", ")}
                </span>
                <span className="faint mono" style={{ fontSize: 12 }}>{timeAgo(Date.parse(d.updated_at))}</span>
              </Link>
            ))}
          </div>
        </section>
      )}

      <section className="section">
        <div className="spread"><h2 className="display">New dashboard</h2></div>
        <div className="grid-cells cols-3">
          {TEMPLATES.map((t) => (
            <div key={t.id} className="stack" style={{ gap: 10 }}>
              <div className="label" style={{ color: "var(--fg)" }}>{t.name}</div>
              <p className="serif muted" style={{ margin: 0, fontSize: 16, flex: 1 }}>{t.description}</p>
              {t.needsSymbol ? (
                <div className="row">
                  <SymbolSearch placeholder="Pick a ticker" keepValue onSelect={(s) => setDeepDive(s)} width={160} />
                  <button className="btn btn-primary" disabled={!deepDive || busy !== null} onClick={() => fromTemplate(t.id, deepDive)}>{busy === t.id ? "Creating" : "Create"}</button>
                </div>
              ) : (
                <div><button className="btn btn-primary" disabled={busy !== null} onClick={() => fromTemplate(t.id)}>{busy === t.id ? "Creating" : "Use this layout"}</button></div>
              )}
            </div>
          ))}
          <div className="stack" style={{ gap: 10 }}>
            <div className="label" style={{ color: "var(--fg)" }}>Blank</div>
            <p className="serif muted" style={{ margin: 0, fontSize: 16, flex: 1 }}>Start empty and add panels yourself, or ask the assistant to build them.</p>
            <form className="row" onSubmit={(e) => { e.preventDefault(); start("blank", () => create(blankName.trim() || "My dashboard")); }}>
              <input className="input" placeholder="Name" value={blankName} maxLength={80} onChange={(e) => setBlankName(e.target.value)} aria-label="Dashboard name" />
              <button className="btn btn-primary" disabled={busy !== null}>{busy === "blank" ? "Creating" : "Create"}</button>
            </form>
          </div>
        </div>
      </section>
    </PageGate>
  );
}
