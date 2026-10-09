"use client";
import type { Dashboard, Panel } from "../dashboard/schema";
import { api } from "./api";

const json = { "Content-Type": "application/json" };
// keepalive: a save still completes if the user navigates away right after it
// (dashboard payloads stay well under keepalive's 64 KB limit).
const keep = { keepalive: true } as const;

export const listDashboards = () => api<Dashboard[]>("/api/dashboards");
export const createDashboard = async (name: string, panels: Panel[] = []) =>
  (await api<{ id: string }>("/api/dashboards", { method: "POST", headers: json, body: JSON.stringify({ name, panels }) })).id;
export const updateDashboard = (id: string, patch: { name?: string; panels?: Panel[] }) =>
  api<null>(`/api/dashboards/${id}`, { ...keep, method: "PATCH", headers: json, body: JSON.stringify(patch) });
export const deleteDashboard = (id: string) => api<null>(`/api/dashboards/${id}`, { ...keep, method: "DELETE" });
