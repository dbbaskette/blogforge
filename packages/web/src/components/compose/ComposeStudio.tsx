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
import { listProviderAvailability } from "../../api/providers";
import { type Template, deleteTemplate, listTemplates } from "../../api/templates";
import { loadDefaults, loadLastMode, saveDefaults, saveLastMode } from "../../lib/composeDefaults";
import { parseOutline } from "../../lib/parseOutline";
import { type ComposeSettings, SetupFields } from "../SetupFields";
import { BlankPanel } from "./BlankPanel";
import { ExpressPanel } from "./ExpressPanel";
import { InlineKeySetup } from "./InlineKeySetup";
import { type ComposeMode, ModePicker } from "./ModePicker";
import { OutlineInPanel } from "./OutlineInPanel";
import { ProposePanel } from "./ProposePanel";
import { SetupSummary } from "./SetupSummary";
import { SparkIdeas } from "./SparkIdeas";
import { type Starter, StarterIdeas } from "./StarterIdeas";
import { VoiceIndicator } from "./VoiceIndicator";

const PROVIDER_LABELS: Record<string, string> = {
  anthropic: "Anthropic",
  openai: "OpenAI",
  google: "Google",
  "claude-cli": "Claude CLI",
  tanzu: "Tanzu",
};

function ideaFrom(
  settings: ComposeSettings,
  topic: string,
  bullets: string[] = [],
  notes = "",
): IdeaInput {
  return { topic, bullets, notes, ...settings };
}

export function ComposeStudio(): JSX.Element {
  const navigate = useNavigate();
  // Preselect the fastest mode (Express) for a running start, but honor the
  // mode the writer last used so returning users skip re-picking.
  const [mode, setMode] = useState<ComposeMode | null>(() => loadLastMode() ?? "express");
  const [settings, setSettings] = useState<ComposeSettings>(() => loadDefaults());
  const [topic, setTopic] = useState("");
  const [outlineText, setOutlineText] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // When a multi-step flow fails after the draft is created, offer a way into
  // the half-built draft instead of stranding the writer on the compose page.
  const [resumeDraftId, setResumeDraftId] = useState<string | null>(null);
  const [templates, setTemplates] = useState<Template[]>([]);
  const [bullets, setBullets] = useState<string[]>([]);
  const [notes, setNotes] = useState("");
  const [advancedOpen, setAdvancedOpen] = useState(false);
  const [providers, setProviders] = useState<Record<string, boolean>>({});

  useEffect(() => {
    listTemplates()
      .then(setTemplates)
      .catch(() => {});
  }, []);

  function refreshProviders(): void {
    listProviderAvailability()
      .then(setProviders)
      .catch(() => {});
  }

  // biome-ignore lint/correctness/useExhaustiveDependencies: one-shot on mount; refreshProviders is stable enough for this use
  useEffect(() => {
    refreshProviders();
  }, []);

  const canRun = !!settings.model && providers[settings.provider] === true;
  const providersLoaded = Object.keys(providers).length > 0;
  const hasAnyProvider = Object.values(providers).some(Boolean);
  const providerLabel = PROVIDER_LABELS[settings.provider] ?? settings.provider;

  function applyStarter(s: Starter): void {
    setMode(s.mode);
    if (s.mode === "outline") {
      setOutlineText(s.outline);
    } else {
      setTopic(s.topic);
    }
  }

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
    setResumeDraftId(null);
    try {
      const idea = ideaFrom(settings, topic.trim() || "Untitled", bullets, notes);
      const draft = await createDraft(idea);
      saveDefaults(settings);
      saveLastMode("blank");
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
    setResumeDraftId(null);
    let createdId: string | null = null;
    try {
      const idea = ideaFrom(settings, parsed.title || "Untitled", bullets, notes);
      const draft = await createDraft(idea);
      createdId = draft.id;
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
      saveLastMode("outline");
      navigate(`/drafts/${draft.id}`);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      if (createdId) setResumeDraftId(createdId);
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
    setResumeDraftId(null);
    let createdId: string | null = null;
    try {
      const idea = ideaFrom(settings, topic.trim(), bullets, notes);
      const draft = await createDraft(idea);
      createdId = draft.id;
      await generateOutline(draft.id);
      await expandSections(draft.id);
      saveDefaults(settings);
      saveLastMode("express");
      navigate(`/drafts/${draft.id}`);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      if (createdId) setResumeDraftId(createdId);
    } finally {
      setBusy(false);
    }
  }

  // PROPOSE
  // Generate an outline so the user lands on the Outline stage to tweak, then
  // AI writes it — generateOutline returns the updated draft and (server-side)
  // advances stage to "outline", so no separate setDraftStage call is needed.
  async function runPropose(): Promise<void> {
    setBusy(true);
    setError(null);
    setResumeDraftId(null);
    let createdId: string | null = null;
    try {
      const idea = ideaFrom(settings, topic.trim(), bullets, notes);
      const draft = await createDraft(idea);
      createdId = draft.id;
      await generateOutline(draft.id);
      saveDefaults(settings);
      saveLastMode("propose");
      navigate(`/drafts/${draft.id}`);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      if (createdId) setResumeDraftId(createdId);
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

      {/* Template chips, or curated starters for first-timers with none saved */}
      {templates.length > 0 ? (
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
      ) : (
        <StarterIdeas onPick={applyStarter} />
      )}

      {/* Mode picker */}
      <ModePicker active={mode} onPick={setMode} />

      {/* Setup summary (canRun) surfaces the auto-picked voice/model/length with
          a one-click Edit. When nothing is ready, offer the fix inline instead
          of a dead-end: add a key right here if truly none, else point to
          Advanced to pick a model. */}
      {canRun ? (
        <SetupSummary
          settings={settings}
          providerLabel={providerLabel}
          onEdit={() => setAdvancedOpen(true)}
        />
      ) : providersLoaded && !hasAnyProvider ? (
        <InlineKeySetup onSaved={refreshProviders} />
      ) : providersLoaded ? (
        <p className="text-sm text-muted">
          Almost ready — pick a model under{" "}
          <button
            type="button"
            className="text-cobalt-600 hover:text-cobalt-700 underline underline-offset-2"
            onClick={() => setAdvancedOpen(true)}
          >
            Advanced
          </button>
          .
        </p>
      ) : null}

      {/* Active-mode panel */}
      {mode !== null && (
        <div className="glass-card p-4 space-y-3">
          {mode === "blank" && (
            <BlankPanel
              topic={topic}
              onTopic={setTopic}
              onRun={runBlank}
              busy={busy}
              disabled={!canRun}
            />
          )}
          {mode === "express" && (
            <>
              <ExpressPanel
                topic={topic}
                onTopic={setTopic}
                onRun={runExpress}
                busy={busy}
                disabled={!canRun}
              />
              <SparkIdeas seed={topic} settings={settings} disabled={!canRun} onPick={setTopic} />
            </>
          )}
          {mode === "propose" && (
            <>
              <ProposePanel
                topic={topic}
                onTopic={setTopic}
                onRun={runPropose}
                busy={busy}
                disabled={!canRun}
              />
              <SparkIdeas seed={topic} settings={settings} disabled={!canRun} onPick={setTopic} />
            </>
          )}
          {mode === "outline" && (
            <OutlineInPanel
              outlineText={outlineText}
              onOutlineText={setOutlineText}
              onRun={runOutline}
              busy={busy}
              disabled={!canRun}
            />
          )}
        </div>
      )}

      {/* Error banner — if a draft was created before the failure, offer a way
          into it rather than stranding the writer here with a phantom draft. */}
      {error && (
        <div
          className="px-4 py-3 rounded text-sm space-y-2"
          style={{ background: "#fde7e2", color: "#b5321b", border: "1px solid #f7c3b6" }}
        >
          <p>{error}</p>
          {resumeDraftId && (
            <button
              type="button"
              className="nb-btn text-sm"
              onClick={() => navigate(`/drafts/${resumeDraftId}`)}
            >
              Continue to your draft →
            </button>
          )}
        </div>
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
