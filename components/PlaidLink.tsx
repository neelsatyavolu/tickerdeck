"use client";

import { useCallback, useEffect, useMemo, useSyncExternalStore } from "react";
import { usePlaidLink, type PlaidLinkError, type PlaidLinkOnSuccessMetadata } from "react-plaid-link";
import { finishLink, syncBrokerage } from "@/lib/client/plaid";
import { syncSummary } from "@/lib/plaid/summary";

// Plaid Link is Plaid's own sign-in window. A brokerage that uses OAuth can
// send the browser away to its site mid-way, so the session in progress is
// kept in localStorage and picked up again on /plaid/oauth.

/** A Link session in progress. With itemId it signs in again to that link instead of adding one. */
export type PendingLink = { token: string; itemId?: string };

const KEY = "tickerdeck.plaid-link";

export function savePendingLink(pending: PendingLink): void {
  try {
    localStorage.setItem(KEY, JSON.stringify(pending));
  } catch {
    /* storage unavailable: brokerages that redirect away can't be finished */
  }
}

function readRaw(): string {
  try {
    return localStorage.getItem(KEY) ?? "";
  } catch {
    return "";
  }
}

function parse(raw: string): PendingLink | null {
  try {
    const v = raw ? JSON.parse(raw) : null;
    return typeof v?.token === "string" ? { token: v.token, itemId: typeof v.itemId === "string" ? v.itemId : undefined } : null;
  } catch {
    return null;
  }
}

const never = () => () => {};

/** The Link session this browser left unfinished, if any. Null while the page is still server-rendered. */
export function usePendingLink(): PendingLink | null {
  const raw = useSyncExternalStore(never, readRaw, () => "");
  return useMemo(() => parse(raw), [raw]);
}

function clearPendingLink(): void {
  try {
    localStorage.removeItem(KEY);
  } catch {
    /* nothing to clear */
  }
}

async function finish(pending: PendingLink, publicToken: string | null, metadata: PlaidLinkOnSuccessMetadata): Promise<string> {
  if (pending.itemId) return `Signed in again. ${syncSummary(await syncBrokerage(pending.itemId))}`;
  if (!publicToken || !metadata.institution) throw new Error("Plaid didn't return a brokerage. Try again.");
  const result = await finishLink({ publicToken, institutionId: metadata.institution.institution_id, institutionName: metadata.institution.name });
  return result.sync ? `Linked ${metadata.institution.name}. ${syncSummary(result.sync)}` : `Linked ${metadata.institution.name}, but the first sync failed: ${result.error}`;
}

type Props = {
  pending: PendingLink;
  /** Set on /plaid/oauth: the address the brokerage sent the browser back to. */
  receivedRedirectUri?: string;
  /** The session ended: linked (message), failed (error), or closed by the user (neither). */
  onSettled: (outcome: { message?: string; error?: string }) => void;
};

/** Opens Plaid Link as soon as it has loaded. Renders nothing itself. */
export function PlaidLinkSession({ pending, receivedRedirectUri, onSettled }: Props) {
  const onSuccess = useCallback(
    (publicToken: string | null, metadata: PlaidLinkOnSuccessMetadata) => {
      finish(pending, publicToken, metadata)
        .then(
          (message) => ({ message }),
          (err) => ({ error: err instanceof Error ? err.message : "Could not finish linking." }),
        )
        .then((outcome) => {
          clearPendingLink();
          onSettled(outcome);
        });
    },
    [pending, onSettled],
  );
  const onExit = useCallback(
    (err: PlaidLinkError | null) => {
      clearPendingLink();
      onSettled(err ? { error: err.display_message ?? err.error_message ?? "The brokerage sign-in didn't finish." } : {});
    },
    [onSettled],
  );
  const { open, ready, error } = usePlaidLink({ token: pending.token, receivedRedirectUri, onSuccess, onExit });

  useEffect(() => {
    if (ready) open();
  }, [ready, open]);

  // Plaid's script never loaded (offline, or a content blocker): say so instead of waiting forever.
  useEffect(() => {
    if (!error) return;
    clearPendingLink();
    onSettled({ error: "Plaid's sign-in window couldn't load. Turn off any content blocker for this site and try again." });
  }, [error, onSettled]);

  return null;
}
