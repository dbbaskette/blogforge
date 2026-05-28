import { useCallback, useEffect, useState } from "react";

import {
  type LinkedInStatus,
  connectLinkedIn,
  disconnectLinkedIn,
  getLinkedInStatus,
} from "../api/linkedin";

export function SettingsPage(): JSX.Element {
  const [status, setStatus] = useState<LinkedInStatus | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const reload = useCallback(() => {
    getLinkedInStatus()
      .then(setStatus)
      .catch((e: Error) => setError(e.message));
  }, []);
  useEffect(() => {
    reload();
  }, [reload]);

  const handleConnect = async (): Promise<void> => {
    setError(null);
    setBusy(true);
    try {
      const { authorize_url } = await connectLinkedIn();
      // Full-page redirect kicks off the OAuth dance with LinkedIn.
      window.location.href = authorize_url;
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      setBusy(false);
    }
  };

  const handleDisconnect = async (): Promise<void> => {
    setError(null);
    setBusy(true);
    try {
      await disconnectLinkedIn();
      reload();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

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

      {error && (
        <div
          className="mb-6 p-4 rounded-nb"
          style={{ background: "#fde9ec", border: "1px solid #f7c7cf", color: "#94293c" }}
        >
          {error}
        </div>
      )}

      <section>
        <h2 className="font-serif text-xl font-medium text-ink mb-3">LinkedIn</h2>
        <div className="nb-card p-6">
          {status === null ? (
            <p className="text-center text-muted text-sm py-4">Loading…</p>
          ) : status.connected ? (
            <div className="flex items-center justify-between gap-4">
              <div>
                <div className="flex items-center gap-2">
                  <span className="nb-pill nb-pill-ready">
                    <span className="dot" />
                    Connected
                  </span>
                  <span className="font-medium text-ink">
                    {status.member_name ? `as ${status.member_name}` : ""}
                  </span>
                </div>
                {status.expires_at && (
                  <div className="text-xs text-muted mt-1">
                    Token expires {new Date(status.expires_at).toLocaleDateString()}
                  </div>
                )}
              </div>
              <button
                type="button"
                onClick={handleDisconnect}
                disabled={busy}
                className="nb-btn nb-btn-sm"
              >
                Disconnect
              </button>
            </div>
          ) : (
            <div className="flex items-center justify-between gap-4">
              <p className="text-sm text-muted">
                Connect your LinkedIn account to publish finished drafts to your feed.
              </p>
              <button
                type="button"
                onClick={handleConnect}
                disabled={busy}
                className="nb-btn nb-btn-primary nb-btn-sm"
              >
                Connect LinkedIn
              </button>
            </div>
          )}
        </div>
      </section>
    </div>
  );
}
