"use client";

import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { useEffect, useMemo, useRef, useState } from "react";
import { useAssistant } from "@/components/Assistant";
import { PanelEditor } from "@/components/dashboard/PanelEditor";
import { PanelView } from "@/components/dashboard/PanelViews";
import { useDashboards } from "@/components/Dashboards";
import { useLivePrices } from "@/components/LivePrices";
import { PageGate } from "@/components/PageGate";
import { ErrorText } from "@/components/ui";
import { PANEL_META, PANEL_WIDTHS, type Panel } from "@/lib/dashboard/schema";
import { moveItem } from "@/lib/reorder";

export default function DashboardPage() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();
  const { dashboards, loading, update, remove } = useDashboards();
  const { ask } = useAssistant();
  const dashboard = dashboards.find((d) => d.id === id);
  const [editing, setEditing] = useState(false);
  const [adding, setAdding] = useState(false);
  const [editingPanel, setEditingPanel] = useState<string | null>(null);
  const [renaming, setRenaming] = useState<string | null>(null);
  const [dragging, setDragging] = useState<string | null>(null);
  const [dropOn, setDropOn] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const wall = useRef<HTMLDivElement>(null);
  const [fullscreen, setFullscreen] = useState(false);

  useEffect(() => {
    const onChange = () => setFullscreen(document.fullscreenElement === wall.current && wall.current !== null);
    document.addEventListener("fullscreenchange", onChange);
    return () => document.removeEventListener("fullscreenchange", onChange);
  }, []);

  const enterFullscreen = () => {
    wall.current?.requestFullscreen?.().catch(() => setError("Your browser blocked full screen."));
  };

  const symbols = useMemo(() => [...new Set(dashboard?.panels.flatMap((p) => p.symbols) ?? [])], [dashboard]);
  const { prices, checked } = useLivePrices(symbols);
  const steps = [
    { label: "Dashboard", done: !loading },
    { label: "Live prices", done: !loading && symbols.every((s) => prices[s] || checked[s]) },
  ];

  if (!loading && !dashboard) {
    return (
      <div className="empty">
        <p>This dashboard doesn&apos;t exist or was deleted.</p>
        <Link className="btn btn-primary" href="/d">All dashboards</Link>
      </div>
    );
  }

  const panels = dashboard?.panels ?? [];
  const save = async (next: Panel[]) => {
    if (!dashboard) return;
    setError(null);
    try {
      await update(dashboard.id, { panels: next });
    } catch (err) {
      setError(err instanceof Error ? err.message : "Couldn't save the dashboard.");
    }
  };
  const indexOf = (pid: string) => panels.findIndex((p) => p.id === pid);
  const resize = (p: Panel, dir: 1 | -1) => {
    const i = PANEL_WIDTHS.indexOf(p.width);
    const w = PANEL_WIDTHS[Math.max(0, Math.min(PANEL_WIDTHS.length - 1, i + dir))];
    save(panels.map((x) => (x.id === p.id ? { ...x, width: w } : x)));
  };

  const onDelete = async () => {
    if (!dashboard || !window.confirm(`Delete "${dashboard.name}"?`)) return;
    try {
      await remove(dashboard.id);
      router.push("/d");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Couldn't delete.");
    }
  };

  const onRename = async () => {
    if (!dashboard || renaming === null) return;
    const name = renaming.trim();
    setRenaming(null);
    if (name && name !== dashboard.name) {
      try {
        await update(dashboard.id, { name });
      } catch (err) {
        setError(err instanceof Error ? err.message : "Couldn't rename.");
      }
    }
  };

  return (
    <PageGate key={id} title={dashboard?.name ?? "dashboard"} steps={steps}>
      <div className="spread">
        <div style={{ minWidth: 0 }}>
          <div className="label"><Link href="/d">Dashboards</Link> · {panels.length} panel{panels.length === 1 ? "" : "s"}</div>
          {renaming !== null ? (
            <form onSubmit={(e) => { e.preventDefault(); onRename(); }} style={{ marginTop: 8 }}>
              <input className="input display" style={{ fontSize: 28, width: "min(560px, 100%)" }} value={renaming} maxLength={80} autoFocus onChange={(e) => setRenaming(e.target.value)} onBlur={onRename} aria-label="Dashboard name" />
            </form>
          ) : (
            <h1 className="display" style={{ marginTop: 8 }}>{dashboard?.name}</h1>
          )}
        </div>
        <div className="row">
          <button className="btn btn-ghost" onClick={() => ask("Suggest a few useful panels to add to this dashboard, based on my holdings and watchlist.", { dashboardId: id })}>Ask AI for panels</button>
          {editing ? (
            <>
              <button className="btn-text" onClick={() => setRenaming(dashboard?.name ?? "")}>Rename</button>
              <button className="btn-text danger" onClick={onDelete}>Delete</button>
              <button className="btn btn-primary" onClick={() => { setEditing(false); setAdding(false); setEditingPanel(null); }}>Done</button>
            </>
          ) : (
            <>
              {panels.length > 0 && <button className="btn btn-ghost" onClick={enterFullscreen}>Full screen</button>}
              <button className="btn btn-ghost" onClick={() => setEditing(true)}>Edit layout</button>
            </>
          )}
          {!adding && <button className="btn btn-primary" onClick={() => { setAdding(true); setEditing(true); }}>Add panel</button>}
        </div>
      </div>
      <ErrorText error={error} />

      {adding && (
        <div style={{ marginTop: 16 }}>
          <PanelEditor onCancel={() => setAdding(false)} onSave={async (p) => { await save([...panels, p]); setAdding(false); }} />
        </div>
      )}

      {panels.length === 0 && !adding ? (
        <div className="empty" style={{ marginTop: 24 }}>
          <p>Nothing here yet. Add a panel, or ask the assistant something like “add a chart comparing NVDA, AMD and AVGO over a year”.</p>
          <div className="row">
            <button className="btn btn-primary" onClick={() => { setAdding(true); setEditing(true); }}>Add panel</button>
            <button className="btn btn-ghost" onClick={() => ask("Build me a useful starting dashboard from my holdings and watchlist.", { dashboardId: id })}>Ask AI to build it</button>
          </div>
        </div>
      ) : (
        <div ref={wall} className="dash-wall" style={{ marginTop: 24 }}>
        {fullscreen && (
          <div className="dash-wall-head">
            <span className="label" style={{ color: "var(--fg)" }}>{dashboard?.name}</span>
            <span className="faint mono" style={{ fontSize: 12 }}>Esc to exit</span>
            <span style={{ flex: 1 }} />
            <button className="btn-text" onClick={() => document.exitFullscreen()}>Exit full screen</button>
          </div>
        )}
        <div className="dash-grid">
          {panels.map((p, i) =>
            editingPanel === p.id ? (
              <div key={p.id} className="dash-panel span-12">
                <PanelEditor initial={p} onCancel={() => setEditingPanel(null)} onSave={async (np) => { await save(panels.map((x) => (x.id === p.id ? np : x))); setEditingPanel(null); }} />
              </div>
            ) : (
              <section
                key={p.id}
                className={`dash-panel span-${p.width}`}
                aria-label={p.title ?? PANEL_META[p.type].label}
                draggable={editing}
                data-dragging={dragging === p.id}
                data-drop={dropOn === p.id && dragging !== p.id}
                onDragStart={(e) => { setDragging(p.id); e.dataTransfer.effectAllowed = "move"; e.dataTransfer.setData("text/plain", p.id); }}
                onDragOver={(e) => { if (dragging) { e.preventDefault(); setDropOn(p.id); } }}
                onDrop={(e) => { e.preventDefault(); if (dragging && dragging !== p.id) save(moveItem(panels, indexOf(dragging), i)); setDragging(null); setDropOn(null); }}
                onDragEnd={() => { setDragging(null); setDropOn(null); }}
              >
                <div className="dash-panel-head">
                  {editing && <span className="grip" aria-hidden="true" title="Drag to move" />}
                  <span className="label">{p.title ?? `${PANEL_META[p.type].label}${p.symbols.length && p.symbols.length <= 3 ? ` · ${p.symbols.join(", ")}` : ""}`}</span>
                  {editing && (
                    <span className="row" style={{ gap: 0 }}>
                      <button className="btn-text" onClick={() => save(moveItem(panels, i, i - 1))} disabled={i === 0} aria-label="Move panel earlier" title="Move earlier">←</button>
                      <button className="btn-text" onClick={() => save(moveItem(panels, i, i + 1))} disabled={i === panels.length - 1} aria-label="Move panel later" title="Move later">→</button>
                      <button className="btn-text" onClick={() => resize(p, -1)} disabled={p.width === PANEL_WIDTHS[0]} aria-label="Narrower" title="Narrower">−</button>
                      <button className="btn-text" onClick={() => resize(p, 1)} disabled={p.width === 12} aria-label="Wider" title="Wider">+</button>
                      <button className="btn-text" onClick={() => setEditingPanel(p.id)}>Edit</button>
                      <button className="btn-text danger" onClick={() => save(panels.filter((x) => x.id !== p.id))} aria-label="Remove panel">Remove</button>
                    </span>
                  )}
                </div>
                <PanelView panel={p} />
              </section>
            ),
          )}
        </div>
        </div>
      )}
      {editing && panels.length > 0 && <p className="notice" style={{ marginTop: 12 }}>Drag panels to rearrange, or use ← → to move and − + to resize. Changes save automatically.</p>}
    </PageGate>
  );
}
