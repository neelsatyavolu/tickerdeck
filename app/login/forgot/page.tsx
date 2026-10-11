"use client";

import { useState } from "react";
import Link from "next/link";
import { Footer } from "@/components/Footer";
import { authClient } from "@/lib/auth/client";
import { errorOf, requestFailure, resetRedirect, SENT_NOTICE } from "@/lib/auth/passwordReset";

export default function ForgotPasswordPage() {
  const [email, setEmail] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [sent, setSent] = useState(false);

  const submit = async (e: React.SubmitEvent<HTMLFormElement>) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    setSent(false);
    const request = () => authClient.requestPasswordReset({ email: email.trim(), redirectTo: resetRedirect(window.location.origin) });
    const failure = requestFailure(await errorOf(request));
    if (failure) setError(failure);
    else setSent(true);
    setBusy(false);
  };

  return (
    <main className="page" style={{ maxWidth: 520, paddingTop: 96 }}>
      <div className="label">tickerquill</div>
      <h1 className="display" style={{ marginTop: 12 }}>Reset password<span className="caret" aria-hidden="true" /></h1>
      <p className="serif muted" style={{ fontSize: 19, marginTop: 16 }}>
        Enter the email you signed up with and we will send you a link to choose a new password.
      </p>
      <form onSubmit={submit} className="stack" style={{ marginTop: 24 }}>
        <label className="field">
          <span className="label">Email</span>
          <input className="input" type="email" required autoComplete="email" value={email} onChange={(e) => setEmail(e.target.value)} />
        </label>
        <div className="row">
          <button className="btn btn-primary" disabled={busy || !email.trim()}>{busy ? "Working" : "Send reset link"}</button>
          <Link href="/login" className="btn-text">Back to sign in</Link>
        </div>
        {error && <div className="error" role="alert">{error}</div>}
        {sent && <div className="card" role="status">{SENT_NOTICE}</div>}
      </form>
      <div style={{ marginTop: 48 }}><Footer /></div>
    </main>
  );
}
