import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";

import {
  type IdeaInput,
  type OutlineProposal,
  createDraft,
  expandSections,
  generateOutline,
  updateDraft,
} from "../../api/drafts";
import { type Template, deleteTemplate, listTemplates } from "../../api/templates";
import { loadDefaults, saveDefaults } from "../../lib/composeDefaults";
import { parseOutline } from "../../lib/parseOutline";
import { type ComposeSettings, SetupFields } from "../SetupFields";
import { BlankPanel } from "./BlankPanel";
import { ExpressPanel } from "./ExpressPanel";
import { type ComposeMode, ModePicker } from "./ModePicker";
import { OutlineInPanel } from "./OutlineInPanel";
import { ProposePanel } from "./ProposePanel";
import { VoiceIndicator } from "./VoiceIndicator";

function ideaFrom(settings: ComposeSettings, topic: string, bullets: string[] = [], notes = ""): IdeaInput {
  return { topic, bullets, notes, ...settings };
}

export function ComposeStudio(): JSX.Element {
  const navigate = useNavigate();
  const [mode, setMode] = useState<ComposeMode | null>(null);
  const [settings, setSettings] = useState<ComposeSettings>(() => loadDefaults());
  const [topic, setTopic] = useState("");
  const [outlineText, setOutlineText] = useState("");
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

  // BLANK
  async function runBlank(): Promise<void> {
    setBusy(true);
    setError(null);
    try {
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

  // OUTLINE-IN
  async function runOutline(): Promise<void> {
    const parsed = parseOutline(outlineText);
    if (parsed.sections.length === 0) {
      setError("Add at least one heading or bullet, or use Just write it.");
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const idea = ideaFrom(settings, parsed.title || "Untitled", bullets, notes);
      const draft = await createDraft(idea);
      const outline: OutlineProposal = {
        opening_hook: "",
        sections: parsed.sections.map((s) => ({
          id: crypto.randomUUID().replace(/-/g, ""),
          title: s.title,
          brief: s.brief,
        })),
        estimated_words: 0,
      };
      // Full-replace PUT: updateDraft takes the whole Draft. `draft` is fresh
      // from createDraft, so spreading it back only echoes server values we
      // just received; we override title + inject the parsed outline.
      const withOutline = {
        ...draft,
        title: parsed.title || draft.title,
        outline,
      };
      await updateDraft(draft.id, withOutline);
      await expandSections(draft.id);
      saveDefaults(settings);
      navigate(`/drafts/${draft.id}`);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  // EXPRESS
  // Three sequential server calls under one busy flag. If generateOutline or
  // expandSections fails the draft already exists; the user recovers via the
  // Drafts list. A future retry/job-status flow could smooth this over.
  async function runExpress(): Promise<void> {
    setBusy(true);
    setError(null);
    try {
      const idea = ideaFrom(settings, topic.trim(), bullets, notes);
      const draft = await createDraft(idea);
      await generateOutline(draft.id);
      await expandSections(draft.id);
      saveDefaults(settings);
      navigate(`/drafts/${draft.id}`);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  // PROPOSE
  async function runPropose(): Promise<void> {
    setBusy(true);
    setError(null);
    try {
      const idea = ideaFrom(settings, topic.trim(), bullets, notes);
      const draft = await createDraft(idea);
      saveDefaults(settings);
      navigate(`/drafts/${draft.id}`);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

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
            <BlankPanel topic={topic} onTopic={setTopic} onRun={runBlank} busy={busy} />
          )}
          {mode === "express" && (
            <ExpressPanel topic={topic} onTopic={setTopic} onRun={runExpress} busy={busy} />
          )}
          {mode === "propose" && (
            <ProposePanel topic={topic} onTopic={setTopic} onRun={runPropose} busy={busy} />
          )}
          {mode === "outline" && (
            <OutlineInPanel
              outlineText={outlineText}
              onOutlineText={setOutlineText}
              onRun={runOutline}
              busy={busy}
            />
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
        {/* Always mounted so its load + auto-select effects populate pack/
            provider/model even when collapsed (the quick flows submit these);
            just visually hidden until the user opens Advanced. */}
        <div className={advancedOpen ? "glass-card p-4 mt-3" : "hidden"}>
          <SetupFields value={settings} onChange={setSettings} />
        </div>
      </div>
    </div>
  );
}
