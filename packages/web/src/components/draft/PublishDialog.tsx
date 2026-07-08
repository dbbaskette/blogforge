import { useState } from "react";
import { createPortal } from "react-dom";

import { type Draft, downloadDraftUrl } from "../../api/drafts";
import { buildGeoSetup } from "../../lib/geoSetup";
import {
  type FrontmatterPreset,
  type PublishConfig,
  buildFilename,
  loadPublishConfig,
  newFileUrl,
  savePublishConfig,
  slugify,
  willPrefillContent,
} from "../../lib/publish";
import { useDialogA11y } from "../ui/useDialogA11y";

const PRESETS: { value: FrontmatterPreset; label: string; dir: string }[] = [
  { value: "hugo", label: "Hugo", dir: "content/posts" },
  { value: "jekyll", label: "Jekyll", dir: "_posts" },
  { value: "plain", label: "Plain markdown", dir: "posts" },
];

/**
 * One-click publish to the writer's blog repo. Since the GitHub login is
 * read-only, we don't push server-side — we open GitHub's new-file editor at
 * the right path with the post prefilled (and on the clipboard as a fallback),
 * so the writer reviews and commits in GitHub.
 */
export function PublishDialog({
  draft,
  onClose,
}: { draft: Draft; onClose: () => void }): JSX.Element {
  const ref = useDialogA11y(true, onClose);
  const [config, setConfig] = useState<PublishConfig>(() => loadPublishConfig());
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<{ prefilled: boolean } | null>(null);

  const patch = (p: Partial<PublishConfig>): void => setConfig((c) => ({ ...c, ...p }));

  // One-time, site-level GEO setup (crawler access, SSR, schema, E-E-A-T,
  // freshness) — the signals the per-post GEO panel can't see.
  function downloadGeoSetup(): void {
    const blob = new Blob([buildGeoSetup(config)], { type: "text/markdown" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "GEO-SETUP.md";
    a.click();
    URL.revokeObjectURL(url);
  }

  const onPreset = (preset: FrontmatterPreset): void => {
    const pres = PRESETS.find((p) => p.value === preset);
    // Adopt the preset's default dir only if the writer hadn't customized it.
    const wasDefault = PRESETS.some((p) => p.dir === config.dir);
    patch({ preset, dir: wasDefault && pres ? pres.dir : config.dir });
  };

  async function publish(): Promise<void> {
    if (!config.owner.trim() || !config.repo.trim()) {
      setError("Enter your repo owner and name.");
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(
        downloadDraftUrl(draft.id, { format: "md", frontmatter: config.preset !== "plain" }),
        { credentials: "include" },
      );
      if (!res.ok) {
        throw new Error(
          res.status === 401
            ? "Session expired — sign in again, then retry."
            : `Export failed (HTTP ${res.status}).`,
        );
      }
      const md = await res.text();
      const isoDate = new Date().toISOString().slice(0, 10);
      const filename = buildFilename(
        config.preset,
        slugify(draft.title || draft.idea.topic),
        isoDate,
      );
      try {
        await navigator.clipboard.writeText(md);
      } catch {
        /* clipboard blocked — the prefill / manual paste still works */
      }
      savePublishConfig(config);
      window.open(newFileUrl(config, filename, md), "_blank", "noopener");
      setDone({ prefilled: willPrefillContent(md) });
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  // Portal to <body>: mounted in the transformed floating toolbar, this fixed
  // overlay would resolve `inset-0` against the toolbar's box instead of the
  // viewport (its `-translate-x-1/2` establishes a containing block for fixed
  // descendants), collapsing the centered modal into that sliver.
  return createPortal(
    <div className="fixed inset-0 z-40 flex items-center justify-center p-4">
      <button
        type="button"
        aria-hidden
        tabIndex={-1}
        onClick={onClose}
        className="fixed inset-0 bg-ink/20 backdrop-blur-sm cursor-default"
      />
      <div
        ref={ref}
        role="dialog"
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
          Opens your repo's new-file editor with this post ready to commit — review and open the PR
          from there. The post is copied to your clipboard too.
        </p>
        <p className="text-xs text-muted leading-snug">
          First time?{" "}
          <button
            type="button"
            onClick={downloadGeoSetup}
            className="text-cobalt-600 hover:text-cobalt-700 underline underline-offset-2"
          >
            Download the one-time GEO site setup guide
          </button>{" "}
          — crawler access, SSR, schema, author bio, freshness.
        </p>

        {done ? (
          <div
            className="px-3 py-2 rounded-nb-sm text-sm"
            style={{ background: "#e3f5ec", border: "1px solid #bfe8d3", color: "#0e7a50" }}
          >
            Opened GitHub in a new tab.{" "}
            {done.prefilled
              ? "The post is prefilled — review and commit."
              : "The post is long, so it's on your clipboard — paste it (⌘V) into the editor and commit."}
          </div>
        ) : (
          <>
            <div className="grid grid-cols-2 gap-3">
              <label className="block">
                <span className="nb-label">Owner</span>
                <input
                  className="nb-input w-full"
                  placeholder="your-org"
                  value={config.owner}
                  onChange={(e) => patch({ owner: e.target.value.trim() })}
                />
              </label>
              <label className="block">
                <span className="nb-label">Repo</span>
                <input
                  className="nb-input w-full"
                  placeholder="blog"
                  value={config.repo}
                  onChange={(e) => patch({ repo: e.target.value.trim() })}
                />
              </label>
              <label className="block">
                <span className="nb-label">Branch</span>
                <input
                  className="nb-input w-full"
                  value={config.branch}
                  onChange={(e) => patch({ branch: e.target.value.trim() })}
                />
              </label>
              <label className="block">
                <span className="nb-label">Preset</span>
                <select
                  className="nb-select w-full"
                  value={config.preset}
                  onChange={(e) => onPreset(e.target.value as FrontmatterPreset)}
                >
                  {PRESETS.map((p) => (
                    <option key={p.value} value={p.value}>
                      {p.label}
                    </option>
                  ))}
                </select>
              </label>
              <label className="block col-span-2">
                <span className="nb-label">Folder</span>
                <input
                  className="nb-input w-full font-mono text-sm"
                  value={config.dir}
                  onChange={(e) => patch({ dir: e.target.value.trim() })}
                />
              </label>
            </div>

            {error && (
              <p
                className="px-3 py-2 rounded-nb-sm text-sm"
                style={{ background: "#fde7e2", border: "1px solid #f7c3b6", color: "#b5321b" }}
              >
                {error}
              </p>
            )}

            <div className="flex justify-end gap-2">
              <button type="button" onClick={onClose} className="nb-btn nb-btn-sm">
                Cancel
              </button>
              <button
                type="button"
                onClick={publish}
                disabled={busy}
                className="nb-btn nb-btn-primary nb-btn-sm"
              >
                {busy ? "Preparing…" : "Publish →"}
              </button>
            </div>
          </>
        )}
      </div>
    </div>,
    document.body,
  );
}
