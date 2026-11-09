"use client";

import Link from "next/link";
import { useParams, useRouter, useSearchParams } from "next/navigation";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useAssistant } from "@/components/Assistant";
import { PanelEditor } from "@/components/dashboard/PanelEditor";
import { PanelView } from "@/components/dashboard/PanelViews";
import { useFillScreen } from "@/components/dashboard/useFillScreen";
import { useDashboards } from "@/components/Dashboards";
import { useLivePrices } from "@/components/LivePrices";
import { PageGate } from "@/components/PageGate";
import { ErrorText } from "@/components/ui";
import { useWakeLock, type WakeState } from "@/components/useWakeLock";
import { ENHANCE_PROMPT } from "@/lib/dashboard/aiPanels";
import { PANEL_META, PANEL_WIDTHS, type Panel } from "@/lib/dashboard/schema";
import { isTidy, rowTemplate, tidyLayout } from "@/lib/dashboard/tidy";
import { moveItem } from "@/lib/reorder";

const WAKE_NOTE: Record<WakeState, string> = {
  off: "",
  pending: "",
  held: "Screen stays awake",
  unsupported: "This browser can't keep the screen awake. Turn off auto-lock on the device.",
  refused: "The device won't keep the screen awake right now. Check battery saver or auto-lock.",
};

export default function DashboardPage() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();
  const { dashboards, loading, update, remove, markUsed } = useDashboards();
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
  const grid = useFillScreen<HTMLDivElement>();
  // Display mode lives in the URL, so a bookmark or home-screen icon on a
  // spare tablet opens straight into it.
  // It waits for panels and steps aside while editing, so it never covers the editor.
  const display = useSearchParams().get("display") === "1" && !editing && (dashboard?.panels.length ?? 0) > 0;
  const wake = useWakeLock(display);

  const setDisplay = useCallback((on: boolean) => {
    window.history.replaceState(null, "", on ? `${window.location.pathname}?display=1` : window.location.pathname);
  }, []);
  const exitDisplay = useCallback(() => {
    if (document.fullscreenElement) document.exitFullscreen().catch(() => { /* already leaving full screen */ });
    setDisplay(false);
  }, [setDisplay]);

  useEffect(() => {
    if (!display) return;
    // The browser handles Esc itself in full screen; leaving it ends display mode too.
    const onFullscreen = () => { if (!document.fullscreenElement) setDisplay(false); };
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") exitDisplay(); };
    document.addEventListener("fullscreenchange", onFullscreen);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("fullscreenchange", onFullscreen);
      document.removeEventListener("keydown", onKey);
    };
  }, [display, setDisplay, exitDisplay]);

  // Opening a dashboard makes it the target for one-click "Add to dashboard".
  const exists = Boolean(dashboard);
  useEffect(() => {
    if (exists) markUsed(id);
  }, [exists, id, markUsed]);

  const enterDisplay = () => {
    setDisplay(true);
    // Full screen is a bonus: where a browser lacks or blocks it (iPhone), the
    // display still covers the whole window.
    wall.current?.requestFullscreen?.().catch(() => {});
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
      <div className="dash-head">
        <div style={{ minWidth: 0 }}>
          <div className="label"><Link href="/d">Dashboards</Link></div>
          {renaming !== null ? (
            <form onSubmit={(e) => { e.preventDefault(); onRename(); }} style={{ marginTop: 6 }}>
              <input className="input display" style={{ fontSize: 28, width: "min(560px, 100%)" }} value={renaming} maxLength={80} autoFocus onChange={(e) => setRenaming(e.target.value)} onBlur={onRename} aria-label="Dashboard name" />
            </form>
          ) : (
            <h1 className="display" style={{ marginTop: 6 }}>{dashboard?.name}</h1>
          )}
        </div>
        {!editing && (
          <div className="row" style={{ gap: 4 }}>
            {panels.length > 0 && <button className="btn-text" onClick={enterDisplay} title="Fill the screen with this dashboard and keep the screen awake">Display mode</button>}
            {panels.length > 0 && <button className="btn-text" onClick={() => ask(ENHANCE_PROMPT, { dashboardId: id })} title="Ask the assistant to add news, fundamentals and more to this dashboard">Enhance with AI</button>}
            <button className="btn-text" onClick={() => setEditing(true)}>Edit</button>
            <button className="btn btn-primary" onClick={() => { setAdding(true); setEditing(true); }}>+ Add panel</button>
          </div>
        )}
      </div>
      {editing && (
        <div className="dash-toolbar" role="toolbar" aria-label="Edit dashboard">
          <span className="label">Editing</span>
          <span className="faint" style={{ fontSize: 13 }}>Drag panels, or use ← → to move and − + to resize. Changes save automatically.</span>
          <span style={{ flex: 1 }} />
          {!adding && <button className="btn-text" onClick={() => setAdding(true)}>+ Add panel</button>}
          <button className="btn-text" onClick={() => setRenaming(dashboard?.name ?? "")}>Rename</button>
          {!isTidy(panels) && <button className="btn-text" onClick={() => save(tidyLayout(panels))} title="Resize panels so every row fills the width">Tidy layout</button>}
          <button className="btn-text danger" onClick={onDelete}>Delete</button>
          <button className="btn btn-primary" style={{ padding: "4px 12px" }} onClick={() => { setEditing(false); setAdding(false); setEditingPanel(null); }}>Done</button>
        </div>
      )}
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
        <div ref={wall} className="dash-wall" data-display={display}>
        {display && (
          <div className="dash-wall-head">
            <span className="label" style={{ color: "var(--fg)" }}>{dashboard?.name}</span>
            <span className="faint mono" style={{ fontSize: 12 }}>{WAKE_NOTE[wake]}</span>
            <span style={{ flex: 1 }} />
            <button className="btn-text" onClick={exitDisplay}>Exit display mode</button>
          </div>
        )}
        <div ref={grid} className="dash-grid" style={editingPanel === null ? ({ "--rows": rowTemplate(panels) } as React.CSSProperties) : undefined}>
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
    </PageGate>
  );
}
