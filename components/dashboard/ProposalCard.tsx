"use client";

import Link from "next/link";
import { useState } from "react";
import { useDashboards } from "@/components/Dashboards";
import { diffLayouts, type Proposal } from "@/lib/dashboard/aiPanels";
import { PANEL_META, type Panel } from "@/lib/dashboard/schema";
import { DashboardPicker } from "./AddToDashboard";

type Applied = { id: string; undo: { name: string; panels: Panel[] } | null };

/**
 * Panels or a layout edit the assistant proposed. One click applies it to the
 * open dashboard (or the last one used); Undo puts the old layout back.
 */
export function ProposalCard({ proposal, defaultDashboardId }: { proposal: Proposal; defaultDashboardId?: string }) {
  const { dashboards, update, create, lastUsedId, markUsed } = useDashboards();
  const [chosen, setChosen] = useState<string | null>(null);
  const [picking, setPicking] = useState(false);
  const [busy, setBusy] = useState(false);
  const [applied, setApplied] = useState<Applied | null>(null);
  const [error, setError] = useState<string | null>(null);

  const targetId = chosen ?? defaultDashboardId ?? lastUsedId;
  const target = dashboards.find((d) => d.id === targetId) ?? null;
  const count = proposal.panels.length;
  const diff = proposal.kind === "replace" && target ? diffLayouts(target.panels, proposal.panels) : null;

  const apply = async () => {
    setBusy(true);
    setError(null);
    try {
      if (!target) {
        const id = await create(proposal.kind === "replace" && proposal.name ? proposal.name : "AI dashboard", proposal.panels);
        markUsed(id);
        setApplied({ id, undo: null });
      } else {
        const undo = { name: target.name, panels: target.panels };
        if (proposal.kind === "replace") await update(target.id, { panels: proposal.panels, ...(proposal.name ? { name: proposal.name } : {}) });
        else await update(target.id, { panels: [...target.panels, ...proposal.panels] });
        markUsed(target.id);
        setApplied({ id: target.id, undo });
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Couldn't apply that.");
    } finally {
      setBusy(false);
    }
  };

  const undo = async () => {
    if (!applied?.undo) return;
    setBusy(true);
    try {
      await update(applied.id, applied.undo);
      setApplied(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Couldn't undo.");
    } finally {
      setBusy(false);
    }
  };

  const summary =
    proposal.kind === "replace"
      ? diff
        ? [diff.added && `+${diff.added} added`, diff.removed && `−${diff.removed} removed`, diff.changed && `${diff.changed} changed`, diff.moved && "reordered"].filter(Boolean).join(" · ") || "no changes"
        : `${count} panels`
      : `${count} new panel${count === 1 ? "" : "s"}`;

  const actionLabel = !target
    ? `Create dashboard with ${count} panel${count === 1 ? "" : "s"}`
    : proposal.kind === "replace"
      ? `Apply to ${target.name}`
      : `Add to ${target.name}`;

  return (
    <div className="panel-proposal">
      <div className="spread" style={{ alignItems: "center" }}>
        <span className="label" style={{ color: "var(--fg)" }}>{proposal.kind === "replace" ? "Layout edit" : "Proposed panels"}</span>
        <span className="faint mono" style={{ fontSize: 11 }}>{summary}</span>
      </div>
      <ul style={{ margin: 0, paddingLeft: 18 }} className="mono">
        {proposal.panels.slice(0, 12).map((p) => (
          <li key={p.id} style={{ fontSize: 12 }}>
            {p.title ?? PANEL_META[p.type].label}
            <span className="faint"> · {PANEL_META[p.type].label}{p.symbols.length ? ` · ${p.symbols.slice(0, 6).join(", ")}${p.symbols.length > 6 ? "…" : ""}` : ""}</span>
          </li>
        ))}
      </ul>
      {proposal.rejected.length > 0 && <div className="notice">Skipped: {proposal.rejected.join("; ")}</div>}

      {applied ? (
        <div className="row" role="status" style={{ gap: 10 }}>
          <span className="notice">Done.</span>
          {applied.id !== defaultDashboardId && <Link href={`/d/${applied.id}`} className="btn-text" style={{ textDecoration: "underline" }}>Open dashboard</Link>}
          {applied.undo && <button className="btn-text" onClick={undo} disabled={busy}>Undo</button>}
        </div>
      ) : count > 0 ? (
        <div className="row" style={{ gap: 10 }}>
          <button className="btn btn-primary" style={{ padding: "6px 12px" }} onClick={apply} disabled={busy}>
            {busy ? "Applying" : actionLabel}
          </button>
          {dashboards.length > 0 && !picking && (
            <button className="btn-text" onClick={() => setPicking(true)}>{target ? "change" : "or pick one"}</button>
          )}
          {picking && <DashboardPicker value={targetId} onChange={(id) => { setChosen(id); setPicking(false); }} />}
        </div>
      ) : null}
      {error && <div className="error">{error}</div>}
    </div>
  );
}
