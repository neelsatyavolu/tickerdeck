"use client";

import Link from "next/link";
import { useState } from "react";
import { useDashboards } from "@/components/Dashboards";
import { newPanelId, type Panel } from "@/lib/dashboard/schema";

/** Small select of the user's dashboards. */
export function DashboardPicker({ value, onChange }: { value: string | null; onChange: (id: string) => void }) {
  const { dashboards } = useDashboards();
  return (
    <select className="input" style={{ padding: "4px 6px", fontSize: 12 }} value={value ?? ""} onChange={(e) => onChange(e.target.value)} aria-label="Dashboard" autoFocus>
      {!value && <option value="">Choose a dashboard</option>}
      {dashboards.map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}
    </select>
  );
}

/**
 * One-click "Add to <dashboard>": appends panels to the last dashboard used,
 * with a "change" link to pick another. Creates a dashboard if there are none.
 */
export function AddToDashboard({ make, label }: { make: () => Omit<Panel, "id">[]; label: string }) {
  const { dashboards, lastUsedId, addPanels, create, markUsed } = useDashboards();
  const [chosen, setChosen] = useState<string | null>(null);
  const [picking, setPicking] = useState(false);
  const [done, setDone] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const targetId = chosen ?? lastUsedId;
  const target = dashboards.find((d) => d.id === targetId) ?? null;

  const add = async () => {
    setError(null);
    const panels = make().map((p) => ({ ...p, id: newPanelId() })) as Panel[];
    try {
      if (target) {
        await addPanels(target.id, panels);
        markUsed(target.id);
        setDone(target.id);
      } else {
        const id = await create("My dashboard", panels);
        markUsed(id);
        setDone(id);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Couldn't add it.");
    }
  };

  if (done) {
    return (
      <span className="notice" role="status">
        Added. <Link href={`/d/${done}`} style={{ textDecoration: "underline" }}>Open dashboard</Link>
      </span>
    );
  }
  return (
    <span className="row" style={{ gap: 6 }}>
      <button className="btn btn-ghost" onClick={add}>{label} → {target ? target.name : "new dashboard"}</button>
      {dashboards.length > 1 && !picking && <button className="btn-text" onClick={() => setPicking(true)}>change</button>}
      {picking && <DashboardPicker value={targetId} onChange={(id) => { setChosen(id); setPicking(false); }} />}
      {error && <span className="error">{error}</span>}
    </span>
  );
}
