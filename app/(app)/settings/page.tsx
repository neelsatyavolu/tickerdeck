"use client";

import { useEffect, useState } from "react";
import { useAssistant } from "@/components/Assistant";
import { AssistantDefaults } from "@/components/AssistantDefaults";
import { ThemePicker } from "@/components/Theme";
import { ErrorText } from "@/components/ui";
import { authClient } from "@/lib/auth/client";

type Provider = "codex" | "grok";

const INFO: Record<Provider, { name: string; plan: string; paste: string }> = {
  codex: {
    name: "ChatGPT",
    plan: "Uses your ChatGPT Plus or Pro subscription through the Codex sign-in.",
    paste: "After you approve, the tab lands on a localhost page that won't load. Copy the full address from that tab's address bar and paste it here.",
  },
  grok: {
    name: "Grok",
    plan: "Uses your SuperGrok or X Premium subscription through the Grok CLI sign-in.",
    paste: "After you approve, copy the code xAI shows (or the full address of the page it redirects to) and paste it here.",
  },
};

async function post(url: string, body?: object): Promise<{ ok?: boolean; error?: string; authorizeUrl?: string }> {
  const res = await fetch(url, { method: "POST", headers: { "Content-Type": "application/json" }, body: body ? JSON.stringify(body) : undefined });
  const json = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(json.error ?? `Request failed (${res.status}).`);
  return json;
}

const PREPARE_EVERY = 8 * 60_000; // the server keeps a sign-in attempt for 10 minutes

function Connection({ provider, connected, onChange }: { provider: Provider; connected: boolean; onChange: () => Promise<void> }) {
  const [pending, setPending] = useState(false);
  const [pasted, setPasted] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [signInUrl, setSignInUrl] = useState<string | null>(null);
  const info = INFO[provider];

  // Prepare the sign-in link ahead of time so "Connect" is a real link that
  // opens a new tab (no popup blockers, and this page never navigates away).
  // Not refreshed while a sign-in is in progress, or the pasted code wouldn't match.
  useEffect(() => {
    if (connected || pending) return;
    let cancelled = false;
    const prepare = () =>
      post(`/api/ai/${provider}/start`)
        .then(({ authorizeUrl }) => !cancelled && authorizeUrl && setSignInUrl(authorizeUrl))
        .catch((err) => !cancelled && setError(err instanceof Error ? err.message : "Could not prepare sign-in."));
    prepare();
    const id = setInterval(prepare, PREPARE_EVERY);
    return () => {
      cancelled = true;
      clearInterval(id);
    };
  }, [provider, connected, pending]);

  const complete = async () => {
    setBusy(true);
    setError(null);
    try {
      await post(`/api/ai/${provider}/complete`, { callback: pasted.trim() });
      setPending(false);
      setPasted("");
      setSignInUrl(null);
      await onChange();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Sign-in failed.");
    } finally {
      setBusy(false);
    }
  };

  const disconnect = async () => {
    setBusy(true);
    try {
      await post(`/api/ai/${provider}/logout`);
      await onChange();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not disconnect.");
    } finally {
      setBusy(false);
    }
  };

  const signInLink = (label: string, className: string) =>
    signInUrl ? (
      <a className={className} href={signInUrl} target="_blank" rel="noopener noreferrer" onClick={() => setPending(true)}>
        {label} <span aria-hidden="true">↗</span>
      </a>
    ) : (
      <button className={className} disabled>Preparing sign-in…</button>
    );

  return (
    <div className="stack" style={{ gap: 12 }}>
      <div className="spread">
        <div className="label" style={{ color: "var(--fg)" }}>{info.name}</div>
        <span className="status"><span className={`dot ${connected ? "ok" : ""}`} />{connected ? "connected" : "not connected"}</span>
      </div>
      <p className="serif muted" style={{ margin: 0, fontSize: 17 }}>{info.plan}</p>
      {connected ? (
        <div><button className="btn btn-ghost" onClick={disconnect} disabled={busy}>Disconnect</button></div>
      ) : pending ? (
        <form className="stack" style={{ gap: 8 }} onSubmit={(e) => { e.preventDefault(); complete(); }}>
          <p className="notice" style={{ margin: 0 }}>Sign-in opened in a new tab. {info.paste}</p>
          <input className="input mono" value={pasted} onChange={(e) => setPasted(e.target.value)} placeholder="Paste the address or code" autoFocus spellCheck={false} autoComplete="off" />
          <div className="row">
            <button className="btn btn-primary" disabled={busy || !pasted.trim()}>{busy ? "Connecting" : "Finish connecting"}</button>
            {signInLink("Open sign-in again", "btn-text")}
            <button type="button" className="btn-text" onClick={() => setPending(false)}>Cancel</button>
          </div>
        </form>
      ) : (
        <div>{signInLink(`Connect ${info.name}`, "btn btn-primary")}</div>
      )}
      <ErrorText error={error} />
    </div>
  );
}

export default function SettingsPage() {
  const { status, refreshStatus } = useAssistant();
  const session = authClient.useSession();
  const email = session.data?.user?.email ?? null;
  const [signingOut, setSigningOut] = useState(false);

  const signOut = async () => {
    setSigningOut(true);
    // Drop AI tokens first, while the session still lets the request through the proxy.
    await fetch("/auth/signout", { method: "POST" }).catch(() => {});
    await authClient.signOut().catch(() => {});
    // Full reload on purpose: /login lives outside the signed-in app shell.
    // eslint-disable-next-line @next/next/no-location-assign-relative-destination
    window.location.assign("/login");
  };

  return (
    <div>
      <h1 className="display">Settings</h1>

      <section className="section">
        <div className="spread"><h2 className="display">AI subscriptions</h2></div>
        <p className="serif muted" style={{ fontSize: 17, maxWidth: "62ch", marginTop: 0 }}>
          The assistant runs on your own subscription. Sign-in tokens are kept in secure cookies in this browser only and are never saved to the database.
        </p>
        <div className="grid-cells cols-2">
          {(["codex", "grok"] as const).map((p) => (
            <Connection key={p} provider={p} connected={Boolean(status?.[p])} onChange={refreshStatus} />
          ))}
        </div>
      </section>

      <section className="section">
        <div className="spread"><h2 className="display">Assistant defaults</h2></div>
        <AssistantDefaults connected={status} />
      </section>

      <section className="section">
        <div className="spread"><h2 className="display">Appearance</h2></div>
        <p className="serif muted" style={{ fontSize: 17, maxWidth: "62ch", marginTop: 0 }}>
          The theme is saved in this browser, so a wall display can look different from your laptop.
        </p>
        <ThemePicker />
      </section>

      <section className="section">
        <div className="spread"><h2 className="display">Account</h2></div>
        <div className="row">
          <span className="mono">{email ?? "…"}</span>
          <button className="btn btn-ghost" onClick={signOut} disabled={signingOut}>Sign out</button>
        </div>
      </section>
    </div>
  );
}
