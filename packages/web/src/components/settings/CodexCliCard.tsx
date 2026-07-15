import { useCallback, useEffect, useState } from "react";

import { type CliStatus, getCodexCliStatus } from "../../api/providers";

export function CodexCliCard(): JSX.Element {
  const [status, setStatus] = useState<CliStatus | null>(null);
  const [checking, setChecking] = useState(true);

  const check = useCallback(() => {
    setChecking(true);
    getCodexCliStatus()
      .then(setStatus)
      .catch((error: Error) =>
        setStatus({
          installed: false,
          authenticated: false,
          detail: error.message,
          resolve: "",
        }),
      )
      .finally(() => setChecking(false));
  }, []);

  useEffect(() => check(), [check]);

  const badge = ((): { text: string; cls: string } => {
    if (checking) return { text: "Checking…", cls: "text-muted" };
    if (!status) return { text: "Unknown", cls: "text-muted" };
    if (status.installed && status.authenticated)
      return { text: "Installed · logged in ✓", cls: "text-green-700" };
    if (status.installed) return { text: "Installed · not logged in", cls: "text-rose" };
    return { text: "Not installed", cls: "text-rose" };
  })();

  return (
    <section className="mt-8">
      <h2 className="font-serif text-xl font-medium text-ink mb-3">Codex CLI (subscription)</h2>
      <div className="nb-card p-6 space-y-4">
        <p className="text-sm text-muted leading-snug">
          Generate through your locally logged-in <code className="font-mono">codex</code> CLI
          instead of an API key. Available only where BlogForge runs on a host with the CLI (not on
          cloud deploys).
        </p>

        <div className="flex items-center justify-between gap-3 flex-wrap">
          <span className={`text-sm font-medium ${badge.cls}`}>{badge.text}</span>
          <button type="button" onClick={check} disabled={checking} className="nb-btn nb-btn-sm">
            {checking ? "Checking…" : "Refresh"}
          </button>
        </div>

        {status && !checking && (status.detail || status.resolve) && (
          <div
            className="text-xs px-3 py-2 rounded-nb-sm leading-snug"
            style={
              status.authenticated
                ? { background: "#e8f5ee", color: "#1a7a44", border: "1px solid #b9e2ca" }
                : { background: "#fbf1de", color: "#92600a", border: "1px solid #f3d89b" }
            }
          >
            {status.detail}
            {status.resolve && (
              <>
                {" "}
                <span className="font-medium">{status.resolve}</span>
              </>
            )}
          </div>
        )}
      </div>
    </section>
  );
}
