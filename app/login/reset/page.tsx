"use client";

import { Suspense, useState } from "react";
import { useSearchParams } from "next/navigation";
import { Footer } from "@/components/Footer";
import { authClient } from "@/lib/auth/client";
import { errorOf, FORGOT_PATH, LOGIN_AFTER_RESET, MIN_PASSWORD_LENGTH, readResetToken, resetFailure } from "@/lib/auth/passwordReset";

/**
 * Leaves this page with a full page load. A client-side navigation would keep this
 * document, and with it the no-referrer policy that the sign-in and forgot forms
 * are not written for (see the comment in NewPasswordForm).
 */
function LeaveLink({ href, className, children }: { href: string; className: string; children: React.ReactNode }) {
  return <a href={href} className={className}>{children}</a>;
}

function ExpiredLink() {
  return (
    <div className="stack" style={{ marginTop: 24 }}>
      <div className="card" role="status">This reset link is missing, already used or expired.</div>
      <div className="row">
        <LeaveLink href={FORGOT_PATH} className="btn btn-primary">Request a new link</LeaveLink>
        <LeaveLink href="/login" className="btn-text">Back to sign in</LeaveLink>
      </div>
    </div>
  );
}

function NewPasswordForm({ token, onExpired }: { token: string; onExpired: () => void }) {
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = async (e: React.SubmitEvent<HTMLFormElement>) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    // This page is served with Referrer-Policy: no-referrer (next.config.ts). Under that policy
    // the Fetch standard has a POST send `Origin: null`, which Better Auth refuses. Chromium sends
    // the real origin anyway; "origin" makes every browser do so, and still keeps the address
    // (and the token in it) out of the Referer.
    const error = await errorOf(() => authClient.resetPassword({ newPassword: password, token }, { referrerPolicy: "origin" }));
    if (error === null) {
      // Full navigation, as after sign-in, so the login page starts clean.
      window.location.assign(LOGIN_AFTER_RESET);
      return;
    }
    const failure = resetFailure(error);
    if (failure.expired) onExpired();
    else setError(failure.message);
    setBusy(false);
  };

  return (
    <form onSubmit={submit} className="stack" style={{ marginTop: 24 }}>
      <label className="field">
        <span className="label">New password</span>
        <input
          className="input"
          type="password"
          required
          minLength={MIN_PASSWORD_LENGTH}
          autoComplete="new-password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
        />
      </label>
      <div className="row">
        <button className="btn btn-primary" disabled={busy || password.length < MIN_PASSWORD_LENGTH}>{busy ? "Working" : "Change password"}</button>
        <LeaveLink href="/login" className="btn-text">Back to sign in</LeaveLink>
      </div>
      {error && <div className="error" role="alert">{error}</div>}
    </form>
  );
}

function ResetPassword() {
  const token = readResetToken(useSearchParams());
  const [expired, setExpired] = useState(false);
  const usable = token !== null && !expired;

  return (
    <main className="page" style={{ maxWidth: 520, paddingTop: 96 }}>
      <div className="label">tickerquill</div>
      <h1 className="display" style={{ marginTop: 12 }}>{usable ? "New password" : "Link expired"}<span className="caret" aria-hidden="true" /></h1>
      <p className="serif muted" style={{ fontSize: 19, marginTop: 16 }}>
        {usable ? `Choose a new password of at least ${MIN_PASSWORD_LENGTH} characters.` : "Reset links work once and expire soon after they are sent."}
      </p>
      {usable ? <NewPasswordForm token={token} onExpired={() => setExpired(true)} /> : <ExpiredLink />}
      <div style={{ marginTop: 48 }}><Footer /></div>
    </main>
  );
}

export default function ResetPasswordPage() {
  return (
    <Suspense>
      <ResetPassword />
    </Suspense>
  );
}
