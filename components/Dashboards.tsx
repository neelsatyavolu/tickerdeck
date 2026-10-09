"use client";

import { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react";
import * as client from "@/lib/client/dashboards";
import { createSerialQueue } from "@/lib/client/serial";
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
  /** The dashboard one-click actions go to: the last one opened or changed. */
  lastUsedId: string | null;
  markUsed: (id: string) => void;
};

const DashboardsCtx = createContext<Ctx | null>(null);
const saves = createSerialQueue();

const LAST_KEY = "tickerdeck.lastDashboard";

function readLast(): string | null {
  try {
    return localStorage.getItem(LAST_KEY);
  } catch {
    return null;
  }
}

function load(): Promise<Dashboard[] | Error> {
  return client.listDashboards().catch((err) => new Error(err instanceof Error ? err.message : "Could not load dashboards."));
}

/** Read once after mount (not during render) so server and client markup match. */
function setLastFromStorage(set: (v: string | null) => void) {
  set(readLast());
}

export function DashboardsProvider({ children }: { children: React.ReactNode }) {
  const [dashboards, setDashboards] = useState<Dashboard[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [last, setLast] = useState<string | null>(null);

  useEffect(() => {
    setLastFromStorage(setLast);
  }, []);

  const markUsed = useCallback((id: string) => {
    setLast(id);
    try {
      localStorage.setItem(LAST_KEY, id);
    } catch {
      /* storage unavailable */
    }
  }, []);

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
        await saves(() => client.updateDashboard(id, patch));
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

  // Fall back to the most recently updated dashboard when the remembered one is gone.
  const lastUsedId = useMemo(() => {
    if (last && dashboards.some((d) => d.id === last)) return last;
    return [...dashboards].sort((a, b) => b.updated_at.localeCompare(a.updated_at))[0]?.id ?? null;
  }, [last, dashboards]);

  const value = useMemo(
    () => ({ dashboards, loading, error, create, update, remove, addPanels, lastUsedId, markUsed }),
    [dashboards, loading, error, create, update, remove, addPanels, lastUsedId, markUsed],
  );
  return <DashboardsCtx.Provider value={value}>{children}</DashboardsCtx.Provider>;
}

export function useDashboards(): Ctx {
  const ctx = useContext(DashboardsCtx);
  if (!ctx) throw new Error("useDashboards must be used inside DashboardsProvider");
  return ctx;
}
