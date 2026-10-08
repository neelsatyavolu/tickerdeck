"use client";

import { useState } from "react";
import { useSearchParams } from "next/navigation";
import { Suspense } from "react";
import { supabaseBrowser } from "@/lib/supabase/client";

function LoginForm() {
  const params = useSearchParams();
  const [email, setEmail] = useState("");
  const [sent, setSent] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(params.get("error") ? "That sign-in link expired or was already used. Send a new one." : null);

  const submit = async (e: React.SubmitEvent<HTMLFormElement>) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    const next = params.get("next") ?? "/";
    const { error: err } = await supabaseBrowser().auth.signInWithOtp({
      email: email.trim(),
      options: { emailRedirectTo: `${window.location.origin}/auth/callback?next=${encodeURIComponent(next)}` },
    });
    setBusy(false);
    if (err) setError(err.message);
    else setSent(true);
  };

  return (
    <main className="page" style={{ maxWidth: 520, paddingTop: 96 }}>
      <div className="label">tickerdeck</div>
      <h1 className="display" style={{ marginTop: 12 }}>Sign in<span className="caret" aria-hidden="true" /></h1>
      <p className="serif muted" style={{ fontSize: 19, marginTop: 16 }}>
        Portfolios, live prices and forecasts, with an analyst that runs on your own ChatGPT or Grok subscription.
      </p>
      {sent ? (
        <p className="card" role="status">Check {email} for a sign-in link. You can close this tab.</p>
      ) : (
        <form onSubmit={submit} className="stack" style={{ marginTop: 24 }}>
          <label className="field">
            <span className="label">Email</span>
            <input className="input" type="email" required autoComplete="email" value={email} onChange={(e) => setEmail(e.target.value)} />
          </label>
          <div className="row">
            <button className="btn btn-primary" disabled={busy || !email}>{busy ? "Sending" : "Email me a link"}</button>
          </div>
          {error && <div className="error" role="alert">{error}</div>}
        </form>
      )}
    </main>
  );
}

export default function LoginPage() {
  return (
    <Suspense>
      <LoginForm />
    </Suspense>
  );
}
