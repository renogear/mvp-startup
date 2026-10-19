"use client";
import { useState } from "react";
import { ArrowUpRight, ShieldCheck } from "lucide-react";
import { Button } from "./ui/button";
import { Logo } from "./shared";
import { browserDb, configured } from "@/lib/supabase";
export function AuthScreen({
  onAuthenticated,
  demoStart,
  initialError,
}: {
  onAuthenticated: () => Promise<void>;
  demoStart: () => void;
  initialError: string;
}) {
  const [email, setEmail] = useState(""),
    [password, setPassword] = useState(""),
    [signup, setSignup] = useState(false),
    [busy, setBusy] = useState(false),
    [error, setError] = useState(initialError);
  async function auth(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError("");
    try {
      const db = browserDb();
      const result = signup
        ? await db.auth.signUp({
            email,
            password,
            options: {
              emailRedirectTo: `${window.location.origin}/auth/callback`,
            },
          })
        : await db.auth.signInWithPassword({ email, password });
      if (result.error) throw result.error;
      if (!result.data.session) {
        setError("Check your email to confirm your account, then sign in.");
        return;
      }
      await onAuthenticated();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <div className="auth">
      <div className="auth-brand">
        <Logo />
        <div>
          <span className="eyebrow">BUILT FOR RESIDENTIAL BUILDERS</span>
          <h1>
            Less paperwork.
            <br />
            More progress.
          </h1>
          <p>
            A clear path from project scope to a better prepared permit
            application.
          </p>
          <div className="auth-proof">
            <ShieldCheck /> Source-backed requirements. Human-reviewed details.
          </div>
        </div>
        <small>
          PermitPilot · Residential permitting, thoughtfully organized.
        </small>
      </div>
      <form onSubmit={auth} className="auth-form">
        <span className="eyebrow">YOUR NEXT PROJECT STARTS HERE</span>
        <h2>{signup ? "Create your workspace" : "Welcome to PermitPilot"}</h2>
        <p>Bring your projects, documents, and next steps together.</p>
        {error && (
          <div role="alert" className="notice">
            {error}
          </div>
        )}
        <label>
          Work email
          <input
            type="email"
            required
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder="you@yourcompany.com"
          />
        </label>
        <label>
          Password
          <input
            type="password"
            minLength={8}
            required
            value={password}
            onChange={(e) => setPassword(e.target.value)}
          />
        </label>
        <Button disabled={!configured || busy}>
          {busy ? "Please wait…" : signup ? "Create account" : "Sign in"}{" "}
          <ArrowUpRight size={16} />
        </Button>
        <button
          type="button"
          className="text-button"
          onClick={() => setSignup(!signup)}
        >
          {signup
            ? "Already have an account? Sign in"
            : "New here? Create an account"}
        </button>
        {!configured && (
          <p className="notice">
            Live accounts need Supabase configuration. Explore the local demo
            below; it stores project details only in this browser.
          </p>
        )}
        <Button type="button" variant="outline" onClick={demoStart}>
          Explore local demo <ArrowUpRight size={16} />
        </Button>
      </form>
    </div>
  );
}
