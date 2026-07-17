import { type RefObject, useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { Link } from "react-router-dom";

import type { ApiError } from "../../api/client";
import { type Draft, type GitHubPublishResult, publishDraftToGitHub } from "../../api/drafts";
import { type PublishingSettings, getPublishingSettings } from "../../api/publishing";
import { buildGeoSetup } from "../../lib/geoSetup";
import { buildFilename, slugify } from "../../lib/publish";
import { useDialogA11y } from "../ui/useDialogA11y";

const ERROR_COPY: Record<string, string> = {
  publish_path_exists:
    "A file already exists at that path. Change the content folder in Settings or move the existing file.",
  publish_conflict:
    "The GitHub file changed since BlogForge last published it. Review the repository copy before retrying.",
  github_rate_limited: "GitHub is rate limiting requests. Wait a moment, then retry.",
  github_write_forbidden:
    "The saved token cannot write to this repository. Replace it in Settings and retry.",
  github_token_invalid: "GitHub rejected the saved token. Replace it in Settings and retry.",
};

function errorMessage(reason: unknown): string {
  const error = reason as Partial<ApiError>;
  return (
    (error.code && ERROR_COPY[error.code]) ||
    (reason instanceof Error ? reason.message : String(reason))
  );
}

export function PublishDialog({
  draft,
  onClose,
}: { draft: Draft; onClose: () => void }): JSX.Element {
  const ref = useDialogA11y(true, onClose);
  const [settings, setSettings] = useState<PublishingSettings | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<GitHubPublishResult | null>(null);

  useEffect(() => {
    getPublishingSettings()
      .then(setSettings)
      .catch((reason: unknown) => setError(errorMessage(reason)))
      .finally(() => setLoading(false));
  }, []);

  function downloadGeoSetup(): void {
    if (!settings) return;
    const blob = new Blob(
      [
        buildGeoSetup({
          owner: settings.owner,
          repo: settings.repo,
        }),
      ],
      { type: "text/markdown" },
    );
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = "GEO-SETUP.md";
    anchor.click();
    URL.revokeObjectURL(url);
  }

  async function publish(): Promise<void> {
    setBusy(true);
    setError(null);
    try {
      setResult(await publishDraftToGitHub(draft.id));
    } catch (reason) {
      setError(errorMessage(reason));
    } finally {
      setBusy(false);
    }
  }

  const expectedPath = settings
    ? draft.published_path ||
      [
        settings.content_dir,
        buildFilename(
          settings.frontmatter_preset,
          slugify(draft.title || draft.idea.topic),
          new Date().toISOString().slice(0, 10),
        ),
      ]
        .filter(Boolean)
        .join("/")
    : "";
  const unavailable = settings && (!settings.configured || !settings.token_set);

  return createPortal(
    <div className="fixed inset-0 z-40 flex items-center justify-center p-4">
      <button
        type="button"
        aria-hidden
        tabIndex={-1}
        onClick={onClose}
        className="fixed inset-0 bg-ink/20 backdrop-blur-sm cursor-default"
      />
      <dialog
        ref={ref as unknown as RefObject<HTMLDialogElement>}
        open
        aria-modal="true"
        aria-label="Publish to GitHub"
        className="relative z-10 w-full max-w-md nb-card shadow-nb-pop p-6 space-y-4 animate-fade-up"
      >
        <div className="flex items-baseline justify-between">
          <h2 className="font-serif text-2xl font-medium text-ink tracking-tight">
            Publish to GitHub
          </h2>
          <button type="button" onClick={onClose} className="nb-icon-btn" aria-label="Close">
            ✕
          </button>
        </div>
        <p className="text-sm text-muted leading-snug">
          Commit this finished post directly to your configured content repository.
        </p>
        <p className="text-xs text-muted leading-snug">
          First time?{" "}
          <button
            type="button"
            onClick={downloadGeoSetup}
            disabled={!settings}
            className="text-cobalt-600 hover:text-cobalt-700 underline underline-offset-2 disabled:text-muted"
          >
            Download the one-time GEO site setup guide
          </button>{" "}
          — crawler access, SSR, schema, author bio, freshness.
        </p>

        {loading && <p className="text-sm text-muted">Loading publishing settings…</p>}

        {!loading && unavailable && (
          <div className="space-y-3">
            <p className="text-sm text-ink-2">
              {!settings.configured
                ? "GitHub publishing is not configured."
                : "GitHub publishing token is not set."}
            </p>
            <Link to="/settings" className="nb-btn nb-btn-primary nb-btn-sm inline-flex">
              Open Settings
            </Link>
          </div>
        )}

        {!loading && settings && !unavailable && (
          <>
            <div className="rounded-nb-sm border border-line bg-paper-2 px-3 py-3 space-y-1">
              <p className="text-sm font-semibold text-ink">
                {settings.owner}/{settings.repo}
              </p>
              <p className="text-xs text-muted font-mono">
                {settings.branch} · {settings.content_dir || "/"}
              </p>
              {!result && <p className="text-xs text-muted break-all">{expectedPath}</p>}
            </div>

            {result && (
              <div
                className="px-3 py-3 rounded-nb-sm text-sm space-y-2"
                style={{ background: "#e3f5ec", border: "1px solid #bfe8d3", color: "#0e7a50" }}
              >
                <p className="font-semibold">Published to GitHub ✓</p>
                <p className="font-mono text-xs break-all">{result.path}</p>
                <div className="flex gap-3 flex-wrap">
                  <a href={result.file_url} target="_blank" rel="noreferrer" className="underline">
                    View published file
                  </a>
                  <a
                    href={result.commit_url}
                    target="_blank"
                    rel="noreferrer"
                    className="underline"
                  >
                    View commit
                  </a>
                </div>
              </div>
            )}

            {error && (
              <p
                className="px-3 py-2 rounded-nb-sm text-sm"
                style={{ background: "#fde7e2", border: "1px solid #f7c3b6", color: "#b5321b" }}
              >
                {error}
              </p>
            )}

            {!result && (
              <div className="flex justify-end gap-2">
                <button type="button" onClick={onClose} className="nb-btn nb-btn-sm">
                  Cancel
                </button>
                <button
                  type="button"
                  onClick={() => void publish()}
                  disabled={busy}
                  className="nb-btn nb-btn-primary nb-btn-sm"
                >
                  {busy ? "Publishing…" : error ? "Retry" : "Publish"}
                </button>
              </div>
            )}
          </>
        )}

        {!loading && !settings && error && (
          <div className="space-y-3">
            <p className="text-sm text-rose">{error}</p>
            <Link to="/settings" className="nb-btn nb-btn-primary nb-btn-sm inline-flex">
              Open Settings
            </Link>
          </div>
        )}
      </dialog>
    </div>,
    document.body,
  );
}
