"use client";

import Link from "next/link";
import { useState } from "react";
import { useDashboards } from "@/components/Dashboards";
import type { Proposal } from "@/lib/dashboard/aiPanels";
import { PANEL_META } from "@/lib/dashboard/schema";

/** Panels the assistant proposed, with a one-click "Add" to a chosen dashboard. */
export function ProposalCard({ proposal, defaultDashboardId }: { proposal: Proposal; defaultDashboardId?: string }) {
  const { dashboards, addPanels, create } = useDashboards();
  const [target, setTarget] = useState(defaultDashboardId ?? dashboards[0]?.id ?? "new");
  const [state, setState] = useState<{ done?: string; error?: string; busy?: boolean }>({});

  const add = async () => {
    setState({ busy: true });
    try {
      if (target === "new") {
        const id = await create("AI dashboard", proposal.panels);
        setState({ done: id });
      } else {
        await addPanels(target, proposal.panels);
        setState({ done: target });
      }
    } catch (err) {
      setState({ error: err instanceof Error ? err.message : "Couldn't add the panels." });
    }
  };

  return (
    <div className="panel-proposal">
      <div className="label" style={{ color: "var(--fg)" }}>Proposed panels</div>
      <ul style={{ margin: 0, paddingLeft: 18 }} className="mono">
        {proposal.panels.map((p) => (
          <li key={p.id} style={{ fontSize: 12 }}>
            {p.title ?? PANEL_META[p.type].label}
            <span className="faint"> · {PANEL_META[p.type].label}{p.symbols.length ? ` · ${p.symbols.join(", ")}` : ""}{p.range ? ` · ${p.range}` : ""}</span>
          </li>
        ))}
      </ul>
      {proposal.rejected.length > 0 && <div className="notice">Skipped: {proposal.rejected.join("; ")}</div>}
      {state.done ? (
        <div className="notice" role="status">
          Added. <Link href={`/d/${state.done}`} style={{ textDecoration: "underline" }}>Open dashboard</Link>
        </div>
      ) : proposal.panels.length > 0 ? (
        <div className="row" style={{ gap: 8 }}>
          <select className="input" style={{ padding: "4px 6px", fontSize: 12 }} value={target} onChange={(e) => setTarget(e.target.value)} aria-label="Dashboard to add to">
            {dashboards.map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}
            <option value="new">New dashboard</option>
          </select>
          <button className="btn btn-primary" style={{ padding: "4px 12px" }} onClick={add} disabled={state.busy}>
            {state.busy ? "Adding" : `Add ${proposal.panels.length} panel${proposal.panels.length === 1 ? "" : "s"}`}
          </button>
        </div>
      ) : null}
      {state.error && <div className="error">{state.error}</div>}
    </div>
  );
}
