"use client";

import { Suspense, useEffect, useState } from "react";
import { useSearchParams } from "next/navigation";
import { isSuccess, xanomMessage } from "@/lib/xanom/messages";

type Status = { linked: boolean; email: string | null; manageUrl: string };

/** Settings → Account: link this account to Xanom, or show that it is linked. */
export function XanomAccount() {
  return (
    <Suspense>
      <XanomAccountInner />
    </Suspense>
  );
}

function XanomAccountInner() {
  const [status, setStatus] = useState<Status | null>(null);
  const [failed, setFailed] = useState(false);
  // The outcome of a link or convert that just came back from accounts.xanom.co.
  const result = useSearchParams().get("xanom");

  useEffect(() => {
    let cancelled = false;
    fetch("/api/xanom/status")
      .then((r) => r.json())
      .then((body) => {
        if (cancelled) return;
        if (body?.ok) setStatus(body.data as Status);
        else setFailed(true);
      })
      .catch(() => !cancelled && setFailed(true));
    return () => {
      cancelled = true;
    };
  }, []);

  const message = xanomMessage(result);

  return (
    <div className="stack" style={{ marginTop: 16 }}>
      {status?.linked ? (
        <div className="row">
          <span>Signed in with Xanom · <span className="mono">{status.email}</span></span>
          <a className="btn-text" href={status.manageUrl} target="_blank" rel="noopener noreferrer">
            Manage at accounts.xanom.co <span aria-hidden="true">↗</span>
          </a>
        </div>
      ) : status ? (
        <>
          <p className="serif muted" style={{ fontSize: 17, maxWidth: "62ch", margin: 0 }}>
            A Xanom account signs you in to TickerQuill and the other Xanom apps with one click. Your email and password keep working.
          </p>
          <div className="row">
            <a className="btn btn-primary" href="/api/xanom/start?intent=convert&return=/settings">Convert to Xanom account</a>
            <a className="btn btn-ghost" href="/api/xanom/start?intent=link&return=/settings">Link an existing Xanom account</a>
          </div>
        </>
      ) : failed ? (
        <p className="muted" style={{ margin: 0 }}>Couldn&apos;t load your Xanom status.</p>
      ) : null}
      {message && <div className={isSuccess(result) ? "card" : "error"} role={isSuccess(result) ? "status" : "alert"}>{message}</div>}
    </div>
  );
}
