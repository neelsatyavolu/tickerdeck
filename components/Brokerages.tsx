"use client";

import { useCallback, useEffect, useState } from "react";
import { createLinkToken, listBrokerages, syncBrokerage, unlinkBrokerage } from "@/lib/client/plaid";
import { timeAgo } from "@/lib/format";
import { syncSummary } from "@/lib/plaid/summary";
import type { PlaidItem } from "@/lib/plaid/types";
import { PlaidLinkSession, savePendingLink, type PendingLink } from "./PlaidLink";
import { usePortfolios } from "./Portfolios";
import { ErrorText } from "./ui";

const CONNECT = "connect";

function syncedLabel(item: PlaidItem): string {
  if (item.status === "login_required") return "sign-in needed";
  return item.last_synced_at ? `synced ${timeAgo(Date.parse(item.last_synced_at))}` : "not synced yet";
}

/** Settings section for brokerages linked through Plaid. Renders nothing unless this user may link them. */
export function Brokerages() {
  const { refresh: refreshPortfolios } = usePortfolios();
  const [items, setItems] = useState<PlaidItem[] | null>(null);
  const [pending, setPending] = useState<PendingLink | null>(null);
  /** What is in flight: a link's id, or CONNECT. */
  const [busy, setBusy] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  // A failed load leaves the section hidden, the same as for a user who can't link brokerages.
  const load = useCallback(
    () =>
      listBrokerages().then(
        (r) => setItems(r.enabled ? r.items : null),
        () => setItems(null),
      ),
    [],
  );

  useEffect(() => {
    load();
  }, [load]);

  const reload = useCallback(() => Promise.all([load(), refreshPortfolios()]), [load, refreshPortfolios]);

  const start = async (itemId?: string) => {
    setBusy(itemId ?? CONNECT);
    setNotice(null);
    setError(null);
    try {
      const next = { token: await createLinkToken(itemId), itemId };
      savePendingLink(next);
      setPending(next);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not open Plaid.");
      setBusy(null);
    }
  };

  const onSettled = useCallback(
    async (outcome: { message?: string; error?: string }) => {
      setPending(null);
      setNotice(outcome.message ?? null);
      setError(outcome.error ?? null);
      await reload();
      setBusy(null);
    },
    [reload],
  );

  const sync = async (item: PlaidItem) => {
    setBusy(item.id);
    setNotice(null);
    setError(null);
    try {
      setNotice(syncSummary(await syncBrokerage(item.id)));
    } catch (err) {
      setError(err instanceof Error ? err.message : "Sync failed.");
    }
    await reload();
    setBusy(null);
  };

  const unlink = async (item: PlaidItem) => {
    if (!window.confirm(`Unlink ${item.institution}? Its portfolios stay and become editable. A free Plaid plan does not give the link back.`)) return;
    setBusy(item.id);
    setNotice(null);
    setError(null);
    try {
      await unlinkBrokerage(item.id);
      setNotice(`Unlinked ${item.institution}.`);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not unlink.");
    }
    await reload();
    setBusy(null);
  };

  if (!items) return null;

  return (
    <section className="section">
      <div className="spread"><h2 className="display">Brokerages</h2></div>
      <p className="serif muted" style={{ fontSize: 17, maxWidth: "62ch", marginTop: 0 }}>
        Link a brokerage through Plaid and each of its accounts becomes a read-only portfolio that mirrors your positions. Your brokerage password never reaches tickerdeck, and the access Plaid grants is stored encrypted.
      </p>
      {items.length > 0 && (
        <div className="grid-cells cols-2" style={{ marginBottom: 16 }}>
          {items.map((item) => (
            <div key={item.id} className="stack" style={{ gap: 12 }}>
              <div className="spread">
                <div className="label" style={{ color: "var(--fg)" }}>{item.institution}</div>
                <span className="status"><span className={`dot ${item.status === "ok" ? "ok" : "err"}`} />{syncedLabel(item)}</span>
              </div>
              {item.last_error && <p className="notice" style={{ margin: 0 }}>{item.last_error}</p>}
              <div className="row">
                {item.status === "login_required" ? (
                  <button className="btn btn-primary" onClick={() => start(item.id)} disabled={busy !== null}>Reconnect</button>
                ) : (
                  <button className="btn btn-ghost" onClick={() => sync(item)} disabled={busy !== null}>{busy === item.id ? "Syncing" : "Sync now"}</button>
                )}
                <button className="btn-text danger" onClick={() => unlink(item)} disabled={busy !== null}>Unlink</button>
              </div>
            </div>
          ))}
        </div>
      )}
      <div className="row">
        <button className="btn btn-primary" onClick={() => start()} disabled={busy !== null}>{busy === CONNECT ? "Opening Plaid" : "Connect a brokerage"}</button>
      </div>
      {notice && <p className="notice" role="status">{notice}</p>}
      <ErrorText error={error} />
      {pending && <PlaidLinkSession pending={pending} onSettled={onSettled} />}
    </section>
  );
}
