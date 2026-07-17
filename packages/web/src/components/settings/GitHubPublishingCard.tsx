import { useEffect, useState } from "react";

import {
  type PublishingDestination,
  type PublishingPreset,
  type PublishingValidation,
  clearPublishingToken,
  getPublishingSettings,
  savePublishingSettings,
  savePublishingToken,
  validatePublishingSettings,
} from "../../api/publishing";
import { loadPublishConfig, savePublishConfig } from "../../lib/publish";

const EMPTY_DESTINATION: PublishingDestination = {
  owner: "",
  repo: "",
  branch: "main",
  content_dir: "content/posts",
  frontmatter_preset: "hugo",
};

function message(reason: unknown): string {
  return reason instanceof Error ? reason.message : String(reason);
}

export function GitHubPublishingCard(): JSX.Element {
  const [destination, setDestination] = useState<PublishingDestination>(EMPTY_DESTINATION);
  const [token, setToken] = useState("");
  const [tokenSet, setTokenSet] = useState(false);
  const [validation, setValidation] = useState<PublishingValidation | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    getPublishingSettings()
      .then((settings) => {
        if (settings.configured) {
          setDestination({
            owner: settings.owner,
            repo: settings.repo,
            branch: settings.branch,
            content_dir: settings.content_dir,
            frontmatter_preset: settings.frontmatter_preset,
          });
        } else {
          const old = loadPublishConfig();
          setDestination({
            owner: old.owner,
            repo: old.repo,
            branch: old.branch,
            content_dir: old.dir,
            frontmatter_preset: old.preset,
          });
        }
        setTokenSet(settings.token_set);
        if (settings.ready && settings.validated_login) {
          setValidation({
            ready: true,
            validated_login: settings.validated_login,
            private: false,
          });
        }
      })
      .catch((reason: unknown) => setError(message(reason)))
      .finally(() => setLoading(false));
  }, []);

  const update = (field: keyof PublishingDestination, value: string): void => {
    setDestination((current) => ({ ...current, [field]: value }));
    setValidation(null);
  };

  const onSave = async (): Promise<void> => {
    setSaving(true);
    setError(null);
    setValidation(null);
    try {
      if (token.trim()) {
        await savePublishingToken(token.trim());
        setToken("");
        setTokenSet(true);
      }
      const saved = await savePublishingSettings(destination);
      setDestination({
        owner: saved.owner,
        repo: saved.repo,
        branch: saved.branch,
        content_dir: saved.content_dir,
        frontmatter_preset: saved.frontmatter_preset,
      });
      setTokenSet((current) => current || saved.token_set);
      savePublishConfig({
        owner: saved.owner,
        repo: saved.repo,
        branch: saved.branch,
        dir: saved.content_dir,
        preset: saved.frontmatter_preset,
      });
      setValidation(await validatePublishingSettings());
    } catch (reason) {
      setError(message(reason));
    } finally {
      setSaving(false);
    }
  };

  const onClearToken = async (): Promise<void> => {
    setSaving(true);
    setError(null);
    try {
      await clearPublishingToken();
      setToken("");
      setTokenSet(false);
      setValidation(null);
    } catch (reason) {
      setError(message(reason));
    } finally {
      setSaving(false);
    }
  };

  const canSave =
    destination.owner.trim() !== "" &&
    destination.repo.trim() !== "" &&
    destination.branch.trim() !== "" &&
    (tokenSet || token.trim() !== "");

  return (
    <section className="mt-8">
      <h2 className="font-serif text-xl font-medium text-ink mb-3">Publish to GitHub</h2>
      <div className="nb-card p-6 space-y-5">
        <p className="text-sm text-muted leading-snug">
          Commit finished posts directly to one private or public content repository. These settings
          and the encrypted token belong only to your BlogForge user.
        </p>

        {loading ? (
          <p className="text-sm text-muted">Loading…</p>
        ) : (
          <>
            <div className="grid sm:grid-cols-2 gap-4">
              <Field label="Repository owner">
                <input
                  aria-label="Repository owner"
                  value={destination.owner}
                  onChange={(event) => update("owner", event.target.value)}
                  className="nb-input w-full"
                  autoComplete="off"
                />
              </Field>
              <Field label="Repository">
                <input
                  aria-label="Repository"
                  value={destination.repo}
                  onChange={(event) => update("repo", event.target.value)}
                  className="nb-input w-full"
                  autoComplete="off"
                />
              </Field>
              <Field label="Branch">
                <input
                  aria-label="Branch"
                  value={destination.branch}
                  onChange={(event) => update("branch", event.target.value)}
                  className="nb-input w-full font-mono"
                  autoComplete="off"
                />
              </Field>
              <Field label="Content folder">
                <input
                  aria-label="Content folder"
                  value={destination.content_dir}
                  onChange={(event) => update("content_dir", event.target.value)}
                  className="nb-input w-full font-mono"
                  autoComplete="off"
                />
              </Field>
              <Field label="Frontmatter preset">
                <select
                  aria-label="Frontmatter preset"
                  value={destination.frontmatter_preset}
                  onChange={(event) =>
                    update("frontmatter_preset", event.target.value as PublishingPreset)
                  }
                  className="nb-input w-full"
                >
                  <option value="hugo">hugo</option>
                  <option value="jekyll">jekyll</option>
                  <option value="plain">plain</option>
                </select>
              </Field>
            </div>

            <div className="space-y-2">
              <div className="flex items-end gap-2 flex-wrap">
                <Field label="GitHub publishing token" className="grow min-w-64">
                  <input
                    type="password"
                    aria-label="GitHub publishing token"
                    value={token}
                    onChange={(event) => setToken(event.target.value)}
                    placeholder={tokenSet ? "Paste a replacement token" : "Paste fine-grained PAT"}
                    className="nb-input w-full font-mono"
                    autoComplete="off"
                    spellCheck={false}
                  />
                </Field>
                {tokenSet && (
                  <button
                    type="button"
                    onClick={() => void onClearToken()}
                    disabled={saving}
                    className="nb-btn nb-btn-sm"
                  >
                    Clear token
                  </button>
                )}
              </div>
              <div className="flex items-center justify-between gap-3 flex-wrap">
                <p className={`text-xs font-medium ${tokenSet ? "text-green-700" : "text-muted"}`}>
                  {tokenSet ? "Token saved ✓" : "Token not set"}
                </p>
                <p className="text-xs text-muted">
                  Use a fine-grained PAT with Contents read/write for this repository.
                </p>
              </div>
            </div>

            {validation?.ready && (
              <div
                className="text-sm px-3 py-2 rounded-nb-sm"
                style={{ background: "#e8f5ee", color: "#1a7a44", border: "1px solid #b9e2ca" }}
              >
                <span className="font-medium">Ready as {validation.validated_login} ✓</span>
                {validation.private && <span> Private repository access confirmed.</span>}
              </div>
            )}
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
              onClick={() => void onSave()}
              disabled={saving || !canSave}
              className="nb-btn nb-btn-primary"
            >
              {saving ? "Saving and testing…" : "Save and test"}
            </button>
          </>
        )}
      </div>
    </section>
  );
}

function Field({
  label,
  className = "",
  children,
}: {
  label: string;
  className?: string;
  children: React.ReactNode;
}): JSX.Element {
  return (
    <div className={`block space-y-1 ${className}`}>
      <span className="text-xs font-semibold text-ink-2">{label}</span>
      {children}
    </div>
  );
}
