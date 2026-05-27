import { type FormEvent, useState } from "react";
import { useNavigate } from "react-router-dom";

import { login, requestAccess } from "../api/auth";

type Tab = "signin" | "request";

export function LoginPage(): JSX.Element {
  const navigate = useNavigate();
  const [tab, setTab] = useState<Tab>("signin");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [info, setInfo] = useState<string | null>(null);

  const onSignIn = async (e: FormEvent): Promise<void> => {
    e.preventDefault();
    setSubmitting(true);
    setError(null);
    try {
      await login(email, password);
      navigate("/");
    } catch (err) {
      setError(_friendlyAuthError(err));
    } finally {
      setSubmitting(false);
    }
  };

  const onRequest = async (e: FormEvent): Promise<void> => {
    e.preventDefault();
    setError(null);
    setInfo(null);
    if (password.length < 8) {
      setError("Password must be at least 8 characters.");
      return;
    }
    if (password !== confirm) {
      setError("Passwords don't match.");
      return;
    }
    setSubmitting(true);
    try {
      await requestAccess(email, password);
      setInfo("Request sent. An admin will review and approve your account.");
      setEmail("");
      setPassword("");
      setConfirm("");
    } catch (err) {
      setError(_friendlyAuthError(err));
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="min-h-screen flex items-center justify-center px-4 bg-canvas">
      <div className="nb-card w-full max-w-md p-8 animate-fade-up">
        <header className="mb-6 text-center">
          <div className="w-10 h-10 mx-auto rounded-[10px] bg-gradient-to-br from-cobalt-500 to-cobalt-300 grid place-items-center text-white font-serif italic font-semibold text-lg shadow-nb-cobalt mb-3">
            P
          </div>
          <h1 className="font-serif text-2xl font-medium text-ink tracking-tight">Pencraft</h1>
          <p className="text-sm text-muted mt-1">A workshop for long-form writing.</p>
        </header>

        <div className="flex border-b border-rule mb-6" role="tablist">
          <button
            type="button"
            role="tab"
            aria-selected={tab === "signin"}
            onClick={() => {
              setTab("signin");
              setError(null);
              setInfo(null);
            }}
            className={`flex-1 py-2 text-sm font-medium border-b-2 transition-colors ${
              tab === "signin"
                ? "border-cobalt-500 text-cobalt-700"
                : "border-transparent text-muted hover:text-ink"
            }`}
          >
            Sign in
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={tab === "request"}
            onClick={() => {
              setTab("request");
              setError(null);
              setInfo(null);
            }}
            className={`flex-1 py-2 text-sm font-medium border-b-2 transition-colors ${
              tab === "request"
                ? "border-cobalt-500 text-cobalt-700"
                : "border-transparent text-muted hover:text-ink"
            }`}
          >
            Request access
          </button>
        </div>

        {tab === "signin" ? (
          <form onSubmit={onSignIn} className="space-y-4">
            <div>
              <label htmlFor="login-email" className="nb-label">
                Email
              </label>
              <input
                id="login-email"
                type="email"
                required
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                className="nb-input"
              />
            </div>
            <div>
              <label htmlFor="login-password" className="nb-label">
                Password
              </label>
              <input
                id="login-password"
                type="password"
                required
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                className="nb-input"
              />
            </div>
            {error && (
              <p
                className="text-sm px-3 py-2 rounded-nb-sm"
                style={{ background: "#fde9ec", color: "#94293c", border: "1px solid #f7c7cf" }}
              >
                {error}
              </p>
            )}
            <button type="submit" disabled={submitting} className="nb-btn nb-btn-primary w-full">
              {submitting ? "Signing in…" : "Sign in"}
            </button>
          </form>
        ) : (
          <form onSubmit={onRequest} className="space-y-4">
            <div>
              <label htmlFor="req-email" className="nb-label">
                Email
              </label>
              <input
                id="req-email"
                type="email"
                required
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                className="nb-input"
              />
            </div>
            <div>
              <label htmlFor="req-password" className="nb-label">
                Password
              </label>
              <input
                id="req-password"
                type="password"
                required
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                className="nb-input"
              />
            </div>
            <div>
              <label htmlFor="req-confirm" className="nb-label">
                Confirm password
              </label>
              <input
                id="req-confirm"
                type="password"
                required
                value={confirm}
                onChange={(e) => setConfirm(e.target.value)}
                className="nb-input"
              />
            </div>
            {info && (
              <p
                className="text-sm px-3 py-2 rounded-nb-sm"
                style={{ background: "#e3f5ec", color: "#1f7752", border: "1px solid #cde9da" }}
              >
                {info}
              </p>
            )}
            {error && (
              <p
                className="text-sm px-3 py-2 rounded-nb-sm"
                style={{ background: "#fde9ec", color: "#94293c", border: "1px solid #f7c7cf" }}
              >
                {error}
              </p>
            )}
            <button type="submit" disabled={submitting} className="nb-btn nb-btn-primary w-full">
              {submitting ? "Submitting…" : "Submit request"}
            </button>
          </form>
        )}
      </div>
    </div>
  );
}

function _friendlyAuthError(e: unknown): string {
  if (e instanceof Error) {
    if (e.message.includes("status_pending")) {
      return "Your account is still pending admin approval.";
    }
    if (e.message.includes("status_rejected")) {
      return "Your access request was rejected.";
    }
    if (e.message.includes("status_disabled")) {
      return "This account has been disabled.";
    }
    if (e.message.includes("invalid_credentials")) {
      return "Email or password is incorrect.";
    }
    if (e.message.includes("email_already_exists")) {
      return "An account with that email already exists.";
    }
    return e.message;
  }
  return String(e);
}
