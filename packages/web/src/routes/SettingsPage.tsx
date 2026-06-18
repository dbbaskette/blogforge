import { useState } from "react";
import { useNavigate } from "react-router-dom";

import { revokeAllSessions } from "../api/auth";
import { useMe } from "../hooks/useMe";

export function SettingsPage(): JSX.Element {
  const { user } = useMe();

  return (
    <div className="max-w-5xl mx-auto px-6 lg:px-10 py-10 animate-fade-up">
      <header className="mb-6">
        <p className="text-xs font-semibold uppercase tracking-wider text-cobalt-600 mb-2">
          Settings
        </p>
        <h1 className="font-serif text-3xl md:text-4xl font-medium text-ink leading-tight tracking-tight">
          Account
        </h1>
      </header>

      <section>
        <div className="nb-card p-6">
          {user ? (
            <dl className="space-y-2 text-sm">
              <div className="flex gap-2">
                <dt className="text-muted w-28">GitHub</dt>
                <dd className="text-ink font-medium">{user.github_login ?? user.email ?? "—"}</dd>
              </div>
              <div className="flex gap-2">
                <dt className="text-muted w-28">Role</dt>
                <dd className="text-ink font-medium">{user.role}</dd>
              </div>
              <div className="flex gap-2">
                <dt className="text-muted w-28">Last sign-in</dt>
                <dd className="text-ink font-medium">
                  {user.last_login_at ? new Date(user.last_login_at).toLocaleString() : "—"}
                </dd>
              </div>
            </dl>
          ) : (
            <p className="text-center text-muted text-sm py-4">Loading…</p>
          )}
        </div>
      </section>

      <SessionsCard />
    </div>
  );
}

// ────────────────────────────────────────────────────────────────
// Sessions

function SessionsCard(): JSX.Element {
  const navigate = useNavigate();
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const onRevokeAll = async (): Promise<void> => {
    if (!confirm("Sign out of all sessions, including this one?")) return;
    setSubmitting(true);
    setError(null);
    try {
      await revokeAllSessions();
      navigate("/login");
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      setSubmitting(false);
    }
  };

  return (
    <section className="mt-8">
      <h2 className="font-serif text-xl font-medium text-ink mb-3">Sessions</h2>
      <div className="nb-card p-6 max-w-md space-y-3">
        <p className="text-sm text-muted leading-relaxed">
          Sign out everywhere to end every active session, including this one. You'll need to sign
          back in.
        </p>
        {error && (
          <p
            className="text-sm px-3 py-2 rounded-nb-sm"
            style={{ background: "#fde7e2", color: "#b5321b", border: "1px solid #f7c3b6" }}
          >
            {error}
          </p>
        )}
        <button
          type="button"
          onClick={onRevokeAll}
          disabled={submitting}
          className="nb-btn"
          style={{ background: "#e6492d", borderColor: "#e6492d", color: "#fff" }}
        >
          {submitting ? "Signing out…" : "Sign out everywhere"}
        </button>
      </div>
    </section>
  );
}
