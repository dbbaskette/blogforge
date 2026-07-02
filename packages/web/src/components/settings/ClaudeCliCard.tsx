import { useCallback, useEffect, useState } from "react";

import { type ClaudeCliStatus, getClaudeCliStatus } from "../../api/providers";
import { loadDefaults, saveDefaults } from "../../lib/composeDefaults";

/**
 * Settings card for the keyless Claude CLI provider: a live login-status check
 * (installed + logged in?, with a `claude /login` fix) and a "use as default"
 * toggle that sets the compose default provider for new drafts (browser-local).
 */
export function ClaudeCliCard(): JSX.Element {
  const [status, setStatus] = useState<ClaudeCliStatus | null>(null);
  const [checking, setChecking] = useState(true);
  const [isDefault, setIsDefault] = useState<boolean>(
    () => loadDefaults().provider === "claude-cli",
  );

  const check = useCallback(() => {
    setChecking(true);
    getClaudeCliStatus()
      .then(setStatus)
      .catch((e: Error) =>
        setStatus({
          installed: false,
          authenticated: false,
          detail: e.message,
          resolve: "",
        }),
      )
      .finally(() => setChecking(false));
  }, []);

  useEffect(() => check(), [check]);

  const toggleDefault = (next: boolean): void => {
    setIsDefault(next);
    const cur = loadDefaults();
    // Clearing the model lets the picker auto-select a valid one for the provider.
    saveDefaults({ ...cur, provider: next ? "claude-cli" : "anthropic", model: "" });
  };

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
      <h2 className="font-serif text-xl font-medium text-ink mb-3">Claude CLI (subscription)</h2>
      <div className="nb-card p-6 space-y-4">
        <p className="text-sm text-muted leading-snug">
          Generate through your locally logged-in <code className="font-mono">claude</code> CLI
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

        <label className="flex items-center gap-2 text-sm text-ink-2 cursor-pointer">
          <input
            type="checkbox"
            checked={isDefault}
            onChange={(e) => toggleDefault(e.target.checked)}
          />
          Use Claude CLI as the default provider for new drafts (this browser)
        </label>
      </div>
    </section>
  );
}
