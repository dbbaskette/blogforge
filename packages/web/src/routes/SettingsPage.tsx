import { type FormEvent, useState } from "react";
import { useNavigate } from "react-router-dom";

import { changePassword, revokeAllSessions } from "../api/auth";
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
                <dt className="text-muted w-28">Email</dt>
                <dd className="text-ink font-medium">{user.email}</dd>
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

      <ChangePasswordCard />
      <SessionsCard />
    </div>
  );
}

// ────────────────────────────────────────────────────────────────
// Change password

function ChangePasswordCard(): JSX.Element {
  const [oldPassword, setOldPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);

  const submit = async (e: FormEvent): Promise<void> => {
    e.preventDefault();
    setError(null);
    setSuccess(false);
    if (newPassword.length < 8) {
      setError("New password must be at least 8 characters.");
      return;
    }
    if (newPassword !== confirm) {
      setError("New passwords don't match.");
      return;
    }
    setSubmitting(true);
    try {
      await changePassword(oldPassword, newPassword);
      setSuccess(true);
      setOldPassword("");
      setNewPassword("");
      setConfirm("");
    } catch (err) {
      if (err instanceof Error && err.message.includes("invalid_old_password")) {
        setError("Current password is incorrect.");
      } else {
        setError(err instanceof Error ? err.message : String(err));
      }
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <section className="mt-8">
      <h2 className="font-serif text-xl font-medium text-ink mb-3">Change password</h2>
      <form onSubmit={submit} className="nb-card p-6 space-y-4 max-w-md">
        <div>
          <label htmlFor="cp-old" className="nb-label">
            Current password
          </label>
          <input
            id="cp-old"
            type="password"
            required
            value={oldPassword}
            onChange={(e) => setOldPassword(e.target.value)}
            className="nb-input"
          />
        </div>
        <div>
          <label htmlFor="cp-new" className="nb-label">
            New password
          </label>
          <input
            id="cp-new"
            type="password"
            required
            value={newPassword}
            onChange={(e) => setNewPassword(e.target.value)}
            className="nb-input"
          />
        </div>
        <div>
          <label htmlFor="cp-confirm" className="nb-label">
            Confirm new password
          </label>
          <input
            id="cp-confirm"
            type="password"
            required
            value={confirm}
            onChange={(e) => setConfirm(e.target.value)}
            className="nb-input"
          />
        </div>
        {success && (
          <p
            className="text-sm px-3 py-2 rounded-nb-sm"
            style={{ background: "#e3f5ec", color: "#1f7752", border: "1px solid #cde9da" }}
          >
            Password changed
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
        <button type="submit" disabled={submitting} className="nb-btn nb-btn-primary">
          {submitting ? "Saving…" : "Update password"}
        </button>
      </form>
    </section>
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
            style={{ background: "#fde9ec", color: "#94293c", border: "1px solid #f7c7cf" }}
          >
            {error}
          </p>
        )}
        <button
          type="button"
          onClick={onRevokeAll}
          disabled={submitting}
          className="nb-btn"
          style={{ background: "#d4546b", borderColor: "#d4546b", color: "#fff" }}
        >
          {submitting ? "Signing out…" : "Sign out everywhere"}
        </button>
      </div>
    </section>
  );
}
