import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";

import { type IdeaInput, createDraft } from "../../api/drafts";
import { type Template, deleteTemplate, listTemplates } from "../../api/templates";
import { loadDefaults, saveDefaults } from "../../lib/composeDefaults";
import { type ComposeSettings, SetupFields } from "../SetupFields";
import { type ComposeMode, ModePicker } from "./ModePicker";
import { VoiceIndicator } from "./VoiceIndicator";

function ideaFrom(settings: ComposeSettings, topic: string, bullets: string[] = [], notes = ""): IdeaInput {
  return { topic, bullets, notes, ...settings };
}

export function ComposeStudio(): JSX.Element {
  const navigate = useNavigate();
  const [mode, setMode] = useState<ComposeMode | null>(null);
  const [settings, setSettings] = useState<ComposeSettings>(() => loadDefaults());
  const [topic, setTopic] = useState("");
  // outlineText will be used in Task 5 (outline, propose, express modes)
  const [outlineText, _setOutlineText] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [templates, setTemplates] = useState<Template[]>([]);
  const [bullets, setBullets] = useState<string[]>([]);
  const [notes, setNotes] = useState("");
  const [advancedOpen, setAdvancedOpen] = useState(false);

  useEffect(() => {
    listTemplates()
      .then(setTemplates)
      .catch(() => {});
  }, []);

  function applyTemplate(t: Template): void {
    setTopic(t.topic);
    setBullets(t.bullets);
    setNotes(t.notes);
    setSettings((prev) => ({
      ...prev,
      pack_slug: t.pack_slug,
      provider: t.provider,
      model: t.model,
      target_words: t.target_words,
      format: t.format,
    }));
  }

  async function removeTemplate(t: Template): Promise<void> {
    try {
      await deleteTemplate(t.id);
      setTemplates((prev) => prev.filter((x) => x.id !== t.id));
    } catch {
      /* ignore — leave list unchanged so the template is not hidden on failure */
    }
  }

  async function runBlank(): Promise<void> {
    setBusy(true);
    setError(null);
    try {
      // TODO (Task 5): outline/express/propose flows should also pass bullets, notes to ideaFrom
      const idea = ideaFrom(settings, topic.trim() || "Untitled", bullets, notes);
      const draft = await createDraft(idea);
      saveDefaults(settings);
      navigate(`/drafts/${draft.id}`);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  // Suppress unused variable warning for outlineText — it will be used in Task 5
  void outlineText;
  void _setOutlineText;

  return (
    <div className="space-y-6">
      {/* Header row */}
      <div className="flex items-center justify-between gap-4">
        <h1 className="text-xl font-bold text-ink">Start a new blog</h1>
        <VoiceIndicator />
      </div>

      {/* Template chips */}
      {templates.length > 0 && (
        <div>
          <p className="nb-label mb-2">Start from template</p>
          <div className="flex flex-wrap gap-2">
            {templates.map((t) => (
              <span
                key={t.id}
                className="glass-card inline-flex items-center gap-1 px-3 py-1.5 text-sm text-ink"
              >
                <button
                  type="button"
                  onClick={() => applyTemplate(t)}
                  className="hover:text-cobalt-700 transition-colors"
                >
                  {t.name}
                </button>
                <button
                  type="button"
                  aria-label={`Remove template ${t.name}`}
                  onClick={() => removeTemplate(t)}
                  className="text-muted hover:text-red-600 transition-colors ml-1"
                >
                  ×
                </button>
              </span>
            ))}
          </div>
        </div>
      )}

      {/* Mode picker */}
      <ModePicker active={mode} onPick={setMode} />

      {/* Active-mode panel */}
      {mode !== null && (
        <div className="glass-card p-4 space-y-3">
          {mode === "blank" && (
            <>
              <div>
                <label htmlFor="compose-title" className="nb-label">
                  Title
                </label>
                <input
                  id="compose-title"
                  type="text"
                  className="nb-input w-full"
                  placeholder="What are you writing about?"
                  value={topic}
                  onChange={(e) => setTopic(e.target.value)}
                />
              </div>
              <button
                type="button"
                className="nb-btn nb-btn-primary"
                onClick={runBlank}
                disabled={busy}
              >
                {busy ? "Opening…" : "Open editor"}
              </button>
            </>
          )}
          {(mode === "outline" || mode === "propose" || mode === "express") && (
            <p className="text-muted text-sm">Coming in the next step.</p>
          )}
        </div>
      )}

      {/* Error banner */}
      {error && (
        <p
          className="px-4 py-3 rounded text-sm"
          style={{ background: "#fde7e2", color: "#b5321b", border: "1px solid #f7c3b6" }}
        >
          {error}
        </p>
      )}

      {/* Advanced settings */}
      <div>
        <button
          type="button"
          className="nb-btn text-sm"
          aria-expanded={advancedOpen}
          onClick={() => setAdvancedOpen((o) => !o)}
        >
          {advancedOpen ? "▲ Hide advanced" : "▼ Advanced"}
        </button>
        {advancedOpen && (
          <div className="glass-card p-4 mt-3">
            <SetupFields value={settings} onChange={setSettings} />
          </div>
        )}
      </div>
    </div>
  );
}
