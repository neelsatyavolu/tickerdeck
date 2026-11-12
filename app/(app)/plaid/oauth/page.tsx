"use client";

import Link from "next/link";
import { useCallback, useState, useSyncExternalStore } from "react";
import { PlaidLinkSession, usePendingLink } from "@/components/PlaidLink";
import { usePortfolios } from "@/components/Portfolios";
import { ErrorText } from "@/components/ui";

// Brokerages that use OAuth send the browser here after their own sign-in.
// The page reopens Plaid Link with the address it was sent back to, and Link
// carries on from where it left off.

const never = () => () => {};
const href = () => window.location.href;

export default function PlaidOAuthPage() {
  const { refresh } = usePortfolios();
  const pending = usePendingLink();
  /** Empty until the page is running in the browser. */
  const returnedTo = useSyncExternalStore(never, href, () => "");
  const [outcome, setOutcome] = useState<{ message?: string; error?: string } | null>(null);

  const onSettled = useCallback(
    async (settled: { message?: string; error?: string }) => {
      setOutcome(settled);
      await refresh();
    },
    [refresh],
  );

  const resumable = pending !== null && returnedTo.includes("oauth_state_id=");
  const waiting = returnedTo === "" || (resumable && !outcome);

  return (
    <div>
      <h1 className="display">Brokerage sign-in</h1>
      <section className="section">
        {waiting ? (
          <p className="notice">Finishing the sign-in<span className="caret" aria-hidden="true" /></p>
        ) : outcome ? (
          <>
            {outcome.message && <p className="notice" role="status">{outcome.message}</p>}
            {!outcome.message && !outcome.error && <p className="notice">The sign-in was closed before it finished.</p>}
            <ErrorText error={outcome.error ?? null} />
          </>
        ) : (
          <p className="notice">There is no brokerage sign-in to finish.</p>
        )}
        {!waiting && <p><Link className="btn btn-ghost" href="/settings">Back to settings</Link></p>}
        {resumable && !outcome && <PlaidLinkSession pending={pending} receivedRedirectUri={returnedTo} onSettled={onSettled} />}
      </section>
    </div>
  );
}
