"use client";

type Envelope<T> = { ok: true; data: T } | { ok: false; error: string };

/** Calls one of our API routes and unwraps the { ok, data | error } envelope. */
export async function api<T>(url: string, init?: RequestInit): Promise<T> {
  let res: Response;
  try {
    res = await fetch(url, init);
  } catch {
    throw new Error("Network error. Check your connection.");
  }
  let body: Envelope<T> | null = null;
  try {
    body = (await res.json()) as Envelope<T>;
  } catch {
    /* non-JSON */
  }
  if (res.status === 401) {
    // Full reload on purpose: /login lives outside the signed-in app shell.
    // eslint-disable-next-line @next/next/no-location-assign-relative-destination
    window.location.href = `/login?next=${encodeURIComponent(window.location.pathname)}`;
    throw new Error("Signed out.");
  }
  if (!body) throw new Error(`Request failed (${res.status}).`);
  if (!body.ok) throw new Error(body.error);
  return body.data;
}

export function postJson<T>(url: string, payload: unknown): Promise<T> {
  return api<T>(url, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload) });
}
