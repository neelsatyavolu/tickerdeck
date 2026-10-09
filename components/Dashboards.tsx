"use client";

import { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react";
import * as client from "@/lib/client/dashboards";
import type { Dashboard, Panel } from "@/lib/dashboard/schema";

type Ctx = {
  dashboards: Dashboard[];
  loading: boolean;
  error: string | null;
  create: (name: string, panels?: Panel[]) => Promise<string>;
  /** Optimistic: applies at once, rolls back if the server refuses. */
  update: (id: string, patch: { name?: string; panels?: Panel[] }) => Promise<void>;
  remove: (id: string) => Promise<void>;
  addPanels: (id: string, panels: Panel[]) => Promise<void>;
};

const DashboardsCtx = createContext<Ctx | null>(null);

function load(): Promise<Dashboard[] | Error> {
  return client.listDashboards().catch((err) => new Error(err instanceof Error ? err.message : "Could not load dashboards."));
}

export function DashboardsProvider({ children }: { children: React.ReactNode }) {
  const [dashboards, setDashboards] = useState<Dashboard[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const apply = useCallback((r: Dashboard[] | Error) => {
    if (r instanceof Error) setError(r.message);
    else {
      setDashboards(r);
      setError(null);
    }
    setLoading(false);
  }, []);

  useEffect(() => {
    let cancelled = false;
    load().then((r) => !cancelled && apply(r));
    return () => {
      cancelled = true;
    };
  }, [apply]);

  const create = useCallback(
    async (name: string, panels: Panel[] = []) => {
      const id = await client.createDashboard(name, panels);
      apply(await load());
      return id;
    },
    [apply],
  );

  const update = useCallback(
    async (id: string, patch: { name?: string; panels?: Panel[] }) => {
      setDashboards((prev) => prev.map((d) => (d.id === id ? { ...d, ...patch } : d)));
      try {
        await client.updateDashboard(id, patch);
      } catch (err) {
        apply(await load());
        throw err;
      }
    },
    [apply],
  );

  const remove = useCallback(
    async (id: string) => {
      setDashboards((prev) => prev.filter((d) => d.id !== id));
      try {
        await client.deleteDashboard(id);
      } catch (err) {
        apply(await load());
        throw err;
      }
    },
    [apply],
  );

  const addPanels = useCallback(
    async (id: string, panels: Panel[]) => {
      const current = dashboards.find((d) => d.id === id);
      if (!current) throw new Error("Dashboard not found.");
      await update(id, { panels: [...current.panels, ...panels] });
    },
    [dashboards, update],
  );

  const value = useMemo(() => ({ dashboards, loading, error, create, update, remove, addPanels }), [dashboards, loading, error, create, update, remove, addPanels]);
  return <DashboardsCtx.Provider value={value}>{children}</DashboardsCtx.Provider>;
}

export function useDashboards(): Ctx {
  const ctx = useContext(DashboardsCtx);
  if (!ctx) throw new Error("useDashboards must be used inside DashboardsProvider");
  return ctx;
}
