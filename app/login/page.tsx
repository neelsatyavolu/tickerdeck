"use client";

import { Suspense, useState } from "react";
import { useSearchParams } from "next/navigation";
import { Footer } from "@/components/Footer";
import { authClient } from "@/lib/auth/client";

type Mode = "sign-in" | "sign-up";

function sameOriginPath(next: string | null): string {
  try {
    const url = new URL(next ?? "/", window.location.origin);
    return url.origin === window.location.origin ? url.pathname + url.search : "/";
  } catch {
    return "/";
  }
}

function LoginForm() {
  const params = useSearchParams();
  const [mode, setMode] = useState<Mode>("sign-in");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const submit = async (e: React.SubmitEvent<HTMLFormElement>) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      const result =
        mode === "sign-in"
          ? await authClient.signIn.email({ email: email.trim(), password })
          : await authClient.signUp.email({ email: email.trim(), password, name: email.trim().split("@")[0] });
      if (result.error) {
        setError(result.error.message ?? "Sign-in failed.");
        return;
      }
      const session = await authClient.getSession();
      if (!session.data?.user) {
        setNotice("Check your email to verify the account, then sign in.");
        setMode("sign-in");
        return;
      }
      // Full navigation so the proxy sees the new session cookie.
      window.location.assign(sameOriginPath(params.get("next")));
    } catch {
      setError("Could not reach the sign-in service. Try again.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <main className="page" style={{ maxWidth: 520, paddingTop: 96 }}>
      <div className="label">tickerquill</div>
      <h1 className="display" style={{ marginTop: 12 }}>{mode === "sign-in" ? "Sign in" : "Create account"}<span className="caret" aria-hidden="true" /></h1>
      <p className="serif muted" style={{ fontSize: 19, marginTop: 16 }}>
        Portfolios, live prices and forecasts, with an analyst that runs on your own ChatGPT or Grok subscription.
      </p>
      <form onSubmit={submit} className="stack" style={{ marginTop: 24 }}>
        <label className="field">
          <span className="label">Email</span>
          <input className="input" type="email" required autoComplete="email" value={email} onChange={(e) => setEmail(e.target.value)} />
        </label>
        <label className="field">
          <span className="label">Password</span>
          <input
            className="input"
            type="password"
            required
            minLength={8}
            autoComplete={mode === "sign-in" ? "current-password" : "new-password"}
            value={password}
            onChange={(e) => setPassword(e.target.value)}
          />
        </label>
        <div className="row">
          <button className="btn btn-primary" disabled={busy || !email || password.length < 8}>
            {busy ? "Working" : mode === "sign-in" ? "Sign in" : "Create account"}
          </button>
          <button type="button" className="btn-text" onClick={() => { setMode(mode === "sign-in" ? "sign-up" : "sign-in"); setError(null); }}>
            {mode === "sign-in" ? "Create an account instead" : "I already have an account"}
          </button>
        </div>
        {error && <div className="error" role="alert">{error}</div>}
        {notice && <div className="card" role="status">{notice}</div>}
      </form>
      <div style={{ marginTop: 48 }}><Footer /></div>
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
