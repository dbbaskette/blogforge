import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { type Draft, inlineEdit } from "../../api/drafts";
import {
  type GeoFinding,
  type GeoLever,
  type GeoReport,
  analyzeGeo,
  generateFaq,
  generateOpener,
  generateTable,
  rescoreGeo,
} from "../../api/geo";
import { formatAgo, getCached, hashDraftContent, setCached } from "../../lib/panelCache";
import { useDialogA11y } from "../ui/useDialogA11y";

function gradeColor(grade: string): { bg: string; fg: string; bd: string } {
  if (grade === "A" || grade === "B") return { bg: "#e3f5ec", fg: "#0e7a50", bd: "#bfe8d3" };
  if (grade === "C") return { bg: "#fbf1de", fg: "#92600a", bd: "#f3d89b" };
  return { bg: "#fde7e2", fg: "#b5321b", bd: "#f7c3b6" };
}

function barColor(score: number): string {
  if (score >= 72) return "#15a06b";
  if (score >= 58) return "#f59e0b";
  return "#e6492d";
}

/** Grade thresholds mirror the backend's _grade — used to recompute the letter
 * grade after a targeted per-lever re-score merges new scores in. */
function localGrade(score: number): string {
  if (score >= 85) return "A";
  if (score >= 72) return "B";
  if (score >= 58) return "C";
  if (score >= 45) return "D";
  return "F";
}

/** Which lever each per-finding rewrite affects — so applying it re-scores only
 * that lever. Additive fixes (opener/faq/table/data) pass their lever directly. */
const FIX_LEVER: Record<string, string> = {
  question_heading: "question_headings",
  bullets: "skimmability",
  self_contained: "chunking",
  dedupe_opening: "definitional_opener",
  answer_first: "answer_first",
};

const findingKey = (lever: GeoLever, f: GeoFinding): string =>
  `${lever.key}:${f.section_id || f.target || f.note}`;

/** Scroll the section card into view and hold a green "GEO added/changed"
 * highlight on it for a few seconds — the visual cue that content changed. */
function flashSection(sectionId: string): void {
  const el = document.getElementById(`section-${sectionId}`);
  if (!el) return;
  el.scrollIntoView({ behavior: "smooth", block: "center" });
  el.classList.add("geo-flash");
  window.setTimeout(() => el.classList.remove("geo-flash"), 6000);
}

// ── Persistent record of GEO-added content (opener / FAQ), per draft, so the
// Remove buttons survive closing and reopening the panel. The color highlight
// is editor-chrome only; the saved markdown stays clean for export. ──
export interface Addition {
  sectionId: string;
  text: string;
  /** A duplicated-title heading the opener fix moved out of the way; restored
   * verbatim by Remove. */
  removed?: string;
}
export interface Additions {
  opener?: Addition;
  faq?: Addition;
}

const additionsKey = (draftId: string): string => `bf.geo.additions.${draftId}`;

function loadAdditions(draftId: string): Additions {
  try {
    return JSON.parse(localStorage.getItem(additionsKey(draftId)) ?? "{}") as Additions;
  } catch {
    return {};
  }
}

function saveAdditions(draftId: string, a: Additions): void {
  try {
    localStorage.setItem(additionsKey(draftId), JSON.stringify(a));
  } catch {
    /* storage disabled — Remove just won't survive a reload */
  }
}

/**
 * Carve GEO-added content (opener prefix / FAQ suffix) out of a section body
 * before sending it to the model for a rewrite, so one fix can't mangle or
 * erase what another fix just added — the addition is re-attached verbatim
 * afterwards (`prefix + rewritten + suffix`) and its Remove button keeps
 * working. Pure and exported for tests.
 */
const normalizeTitle = (s: string): string => s.toLowerCase().replace(/[^a-z0-9]+/g, "");

/**
 * Is an equivalent opener already in the content? The tracker (localStorage)
 * can lose its record, but the CONTENT is the source of truth — adding on top
 * of an existing definition produced verbatim back-to-back duplicates.
 * "exact": the sentence is present verbatim (adoptable for Remove tracking);
 * "similar": present modulo quotes/punctuation/case near the top. Pure,
 * exported for tests.
 */
export function openerPresence(opener: string, content: string): "exact" | "similar" | null {
  if (!opener.trim()) return null;
  if (content.includes(opener)) return "exact";
  const n = normalizeTitle(opener);
  if (n && normalizeTitle(content.slice(0, opener.length * 3 + 400)).includes(n)) {
    return "similar";
  }
  return null;
}

/** Keep only the first copy of a back-to-back duplicated opening block (the
 * server identifies the block; sentence boundary mirrors its regex). */
export function dedupeOpeningBlock(block: string): string {
  const m = /(?<=[.!?])["'”’)]*\s+/.exec(block);
  if (!m) return block;
  const trailer = m[0].replace(/\s+$/, "");
  return block.slice(0, m.index + trailer.length);
}

/**
 * If a section body OPENS with a heading (or bold line) that just repeats the
 * draft title, split it off — the definitional-opener fix moves it out of the
 * way so the opener becomes the true first line instead of being wedged
 * between duplicate headings. Pure and exported for tests.
 */
export function stripDuplicateTitleHeading(
  title: string,
  content: string,
): { rest: string; removed: string } {
  const lines = content.split("\n");
  const firstIdx = lines.findIndex((l) => l.trim() !== "");
  if (firstIdx === -1) return { rest: content, removed: "" };
  // Strip heading markers / bold wrapping / quotes, then compare to the title.
  const text = lines[firstIdx]
    .trim()
    .replace(/^#{1,6}\s+/, "")
    .replace(/^\*\*|\*\*$/g, "")
    .trim();
  const duplicatesTitle =
    normalizeTitle(title).length > 0 && normalizeTitle(text) === normalizeTitle(title);
  if (!duplicatesTitle) return { rest: content, removed: "" };
  const rest = lines
    .slice(firstIdx + 1)
    .join("\n")
    .replace(/^\s+/, "");
  return { rest, removed: lines[firstIdx] };
}

export function carveProtectedAdditions(
  additions: Additions,
  sectionId: string,
  content: string,
): { core: string; prefix: string; suffix: string } {
  let core = content;
  let prefix = "";
  let suffix = "";
  const op = additions.opener;
  if (op && op.sectionId === sectionId && core.startsWith(op.text)) {
    prefix = `${op.text}\n\n`;
    core = core.slice(op.text.length).replace(/^\s+/, "");
  }
  const fq = additions.faq;
  if (fq && fq.sectionId === sectionId) {
    const trimmed = core.replace(/\s+$/, "");
    if (trimmed.endsWith(fq.text)) {
      suffix = `\n\n${fq.text}`;
      core = trimmed.slice(0, trimmed.length - fq.text.length).replace(/\s+$/, "");
    }
  }
  return { core, prefix, suffix };
}

/** A rewrite we can undo: a section's content/title, or the article's opening. */
type UndoEntry =
  | { kind: "content"; sectionId: string; prev: string }
  | { kind: "title"; sectionId: string; prev: string }
  | { kind: "opening"; prev: string };

/** Scroll the Intro card into view and hold the green highlight — the opening
 * lives above the sections (outline.opening_hook), not in a section card. */
function flashOpening(): void {
  const el = document.getElementById("opening");
  if (!el) return;
  el.scrollIntoView({ behavior: "smooth", block: "center" });
  el.classList.add("geo-flash");
  window.setTimeout(() => el.classList.remove("geo-flash"), 6000);
}

const REWRITE_INSTRUCTION: Record<string, string> = {
  answer_first:
    "Rewrite this section so it OPENS with a direct, self-contained answer of about 40-60 words, then the supporting detail. Keep the author's voice and all substance. Return only the section body, no heading.",
  // Applied to ONE dense paragraph (the finding's target), not the section.
  bullets:
    "Convert this single dense paragraph into a one-sentence lead-in followed by 3-6 tight bullets (one idea each). Keep the author's voice and every fact. Return only the replacement markdown.",
  self_contained:
    "Rewrite this section so it stands alone: replace back-references like 'as mentioned above' or 'in the previous section' with the actual context in a few words. Keep the author's voice and all substance. Return only the section body, no heading.",
};

const REWRITE_LABEL: Record<string, string> = {
  answer_first: "Rewrite answer-first",
  question_heading: "Rephrase as a question",
  bullets: "Convert to bullets",
  self_contained: "Make self-contained",
  dedupe_opening: "Remove duplicate sentence",
};

export function GeoPanel({
  draft,
  onSectionSave,
  onChange,
  onClose,
}: {
  draft: Draft;
  onSectionSave: (sectionId: string, content_md: string, createVersion?: boolean) => Promise<void>;
  onChange: (next: Draft) => Promise<void>;
  onClose: () => void;
}): JSX.Element {
  const panelRef = useDialogA11y(true, onClose);
  const [report, setReport] = useState<GeoReport | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [applyingKey, setApplyingKey] = useState<string | null>(null);
  // Applied rewrites (keyed by finding) → previous content, so Apply ⇄ Undo.
  const [undoable, setUndoable] = useState<Map<string, UndoEntry>>(new Map());
  // Sibling findings invalidated because a rewrite restructured their section —
  // hidden (with a re-analyze nudge) rather than left actionable on stale info.
  const [hidden, setHidden] = useState<Set<string>>(new Set());
  // Persistent additions (opener / FAQ) → Remove buttons.
  const [additions, setAdditions] = useState<Additions>(() => loadAdditions(draft.id));
  // True while a targeted per-lever re-score is in flight after a fix.
  const [rescoring, setRescoring] = useState(false);
  // When the shown report came from cache (unchanged draft), this is when it
  // was originally scored — surfaced so the writer knows it isn't stale.
  const [cachedAt, setCachedAt] = useState<number | null>(null);
  // "Add data" micro-flow: which factual-density finding has its input open,
  // and the real fact the writer typed (never fabricated by the tool).
  const [addingKey, setAddingKey] = useState<string | null>(null);
  const [factText, setFactText] = useState("");

  const contentHash = useMemo(() => hashDraftContent(draft), [draft]);

  // A notice the writer can't miss: surface it at the top and scroll there.
  const showNotice = useCallback(
    (msg: string): void => {
      setNotice(msg);
      panelRef.current?.scrollTo({ top: 0, behavior: "smooth" });
    },
    [panelRef],
  );

  const run = useCallback(async (): Promise<void> => {
    setBusy(true);
    setError(null);
    setNotice(null);
    setCachedAt(null);
    try {
      const h = hashDraftContent(draft);
      const fresh = await analyzeGeo(draft.id);
      setReport(fresh);
      setCached("geo", draft.id, h, fresh);
      setUndoable(new Map());
      setHidden(new Set());
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }, [draft]);

  // On open: show the last result instantly if the draft hasn't changed since;
  // otherwise run a fresh scan. Re-analyze always bypasses the cache.
  // biome-ignore lint/correctness/useExhaustiveDependencies: run once on mount
  useEffect(() => {
    const hit = getCached<GeoReport>("geo", draft.id, contentHash);
    if (hit) {
      setReport(hit.data);
      setCachedAt(hit.at);
    } else {
      run();
    }
  }, []);

  // ── Targeted re-score: after a fix, re-score ONLY the affected lever(s) and
  // merge them back in, recomputing the total from each lever's weight. Other
  // levers are never re-run. Debounced so a burst of fixes coalesces. ──
  const pendingRescore = useRef<Set<string>>(new Set());
  const rescoreTimer = useRef<number | null>(null);

  const flushRescore = useCallback(async (): Promise<void> => {
    const keys = [...pendingRescore.current].filter(Boolean);
    pendingRescore.current = new Set();
    if (keys.length === 0) return;
    setRescoring(true);
    try {
      const fresh = await rescoreGeo(draft.id, keys);
      setReport((prev) => {
        if (!prev) return prev;
        const levers = prev.levers.map((l) => fresh[l.key] ?? l);
        const score = Math.round(levers.reduce((s, l) => s + l.score * (l.weight ?? 0), 0));
        return { ...prev, levers, score, grade: localGrade(score) };
      });
    } catch (e) {
      showNotice(e instanceof Error ? e.message : String(e));
    } finally {
      setRescoring(false);
    }
  }, [draft.id, showNotice]);

  const queueRescore = useCallback(
    (leverKey: string): void => {
      if (!leverKey) return;
      pendingRescore.current.add(leverKey);
      if (rescoreTimer.current) window.clearTimeout(rescoreTimer.current);
      rescoreTimer.current = window.setTimeout(() => void flushRescore(), 900);
    },
    [flushRescore],
  );

  // Drop stored additions whose text is no longer present (manually edited away).
  // biome-ignore lint/correctness/useExhaustiveDependencies: reconcile whenever sections change
  useEffect(() => {
    const next: Additions = { ...additions };
    let changed = false;
    for (const k of ["opener", "faq"] as const) {
      const a = next[k];
      if (!a) continue;
      const section = draft.sections.find((s) => s.id === a.sectionId);
      if (!section || !section.content_md.includes(a.text)) {
        delete next[k];
        changed = true;
      }
    }
    if (changed) {
      setAdditions(next);
      saveAdditions(draft.id, next);
    }
  }, [draft.sections]);

  function recordAddition(kind: "opener" | "faq", a: Addition | undefined): void {
    const next = { ...additions, [kind]: a };
    if (!a) delete next[kind];
    setAdditions(next);
    saveAdditions(draft.id, next);
    queueRescore(kind === "opener" ? "definitional_opener" : "faq");
  }

  // ── Additive fixes: generate ONLY the new content, insert it, highlight it. ──

  // The opening/lede is a first-class field (outline.opening_hook), edited in
  // the Intro card and scored as the article's true opening — so the opener
  // fixes operate on IT, not on the first section.
  const saveOpening = useCallback(
    async (opening_hook: string): Promise<void> => {
      const outline = draft.outline ?? { opening_hook: "", sections: [], estimated_words: 0 };
      await onChange({ ...draft, outline: { ...outline, opening_hook } });
    },
    [draft, onChange],
  );

  /** No citable opening yet — generate one and set it as the Intro (prepended
   * ahead of any existing lede prose). Undoable. */
  async function addOpener(): Promise<void> {
    const key = "opener-fix";
    setApplyingKey(key);
    setNotice(null);
    try {
      const opener = await generateOpener(draft.id);
      const existing = (draft.outline?.opening_hook ?? "").trim();
      await saveOpening(existing ? `${opener}\n\n${existing}` : opener);
      setUndoable((m) => new Map(m).set(key, { kind: "opening", prev: existing }));
      queueRescore("definitional_opener");
      flashOpening();
    } catch (e) {
      showNotice(e instanceof Error ? e.message : String(e));
    } finally {
      setApplyingKey(null);
    }
  }

  async function removeAddition(kind: "opener" | "faq"): Promise<void> {
    const a = additions[kind];
    if (!a) return;
    const section = draft.sections.find((s) => s.id === a.sectionId);
    if (!section || !section.content_md.includes(a.text)) {
      recordAddition(kind, undefined);
      return;
    }
    setApplyingKey(`remove-${kind}`);
    try {
      let next = section.content_md
        .replace(a.text, "")
        .replace(/\n{3,}/g, "\n\n")
        .trim();
      // Put back the duplicated-title heading the opener fix moved aside.
      if (a.removed) next = `${a.removed}\n\n${next}`.trim();
      await onSectionSave(a.sectionId, next);
      recordAddition(kind, undefined);
    } catch (e) {
      showNotice(e instanceof Error ? e.message : String(e));
    } finally {
      setApplyingKey(null);
    }
  }

  /** A definition exists but is buried — rewrite the INTRO so it LEADS with a
   * clean, standalone, citable definition of the whole subject/thesis. */
  async function improveOpener(): Promise<void> {
    const opening = (draft.outline?.opening_hook ?? "").trim();
    if (!opening) return;
    const key = "opener-fix";
    setApplyingKey(key);
    setNotice(null);
    try {
      const { text } = await inlineEdit(draft.id, {
        text: opening,
        action: "custom",
        instruction:
          "This is the article's OPENING/lede (it sits above the first section). Rewrite it so it OPENS with a single clean, standalone, citable sentence that defines the article's whole subject/thesis — what it is and what it argues — then keep the rest of the opening's substance and order. Keep the author's voice; invent nothing. Return only the opening prose, no heading.",
      });
      await saveOpening(text.trim());
      setUndoable((m) => new Map(m).set(key, { kind: "opening", prev: opening }));
      queueRescore("definitional_opener");
      flashOpening();
    } catch (e) {
      showNotice(e instanceof Error ? e.message : String(e));
    } finally {
      setApplyingKey(null);
    }
  }

  /** Build a grounded comparison table from a section's prose and append it to
   * that section. Undoable (a version is snapshotted before the change). */
  async function addTable(sectionId: string, key: string): Promise<void> {
    const section = draft.sections.find((s) => s.id === sectionId);
    if (!section) {
      showNotice("That section changed — re-analyze and try again.");
      return;
    }
    setApplyingKey(key);
    setNotice(null);
    try {
      const table = await generateTable(draft.id, sectionId);
      if (!table) {
        showNotice("No table came back — try again.");
        return;
      }
      const next = `${section.content_md.trim()}\n\n${table}`;
      await onSectionSave(sectionId, next, true);
      setUndoable((m) =>
        new Map(m).set(key, { kind: "content", sectionId, prev: section.content_md }),
      );
      queueRescore("comparison_table");
      flashSection(sectionId);
    } catch (e) {
      showNotice(e instanceof Error ? e.message : String(e));
    } finally {
      setApplyingKey(null);
    }
  }

  async function addFaq(): Promise<void> {
    const last = draft.sections[draft.sections.length - 1];
    if (!last) return;
    setApplyingKey("faq");
    setNotice(null);
    try {
      const faqs = await generateFaq(draft.id);
      if (faqs.length === 0) {
        showNotice("No FAQ came back — try again.");
        return;
      }
      const block = `### FAQ\n\n${faqs.map((f) => `**${f.q}**\n\n${f.a}`).join("\n\n")}`;
      const next = `${last.content_md.trim()}\n\n${block}`;
      await onSectionSave(last.id, next);
      recordAddition("faq", { sectionId: last.id, text: block });
      flashSection(last.id);
    } catch (e) {
      showNotice(e instanceof Error ? e.message : String(e));
    } finally {
      setApplyingKey(null);
    }
  }

  // ── Rewrite fixes: apply via inline edit, remember the previous content so
  // the button flips to Undo. ──

  async function applyRewrite(
    key: string,
    sectionId: string,
    fix: string,
    target?: string,
  ): Promise<void> {
    const section = draft.sections.find((s) => s.id === sectionId);
    if (!section) {
      showNotice("That section changed — re-analyze and try again.");
      return;
    }
    setApplyingKey(key);
    setNotice(null);
    try {
      if (fix === "question_heading") {
        const { text } = await inlineEdit(draft.id, {
          text: section.title,
          action: "custom",
          instruction:
            "Rephrase this blog section heading as a concise question a reader would ask. End with a question mark. Return only the heading text.",
        });
        const title = text.trim().replace(/^#+\s*/, "");
        await applyTitle(sectionId, title);
        setUndoable((m) => new Map(m).set(key, { kind: "title", sectionId, prev: section.title }));
      } else if (fix === "dedupe_opening" && target) {
        // Deterministic: the server identified the duplicated opening block;
        // keep only its first copy. No model call.
        if (!section.content_md.includes(target)) {
          showNotice("That passage changed — re-analyze and try again.");
          return;
        }
        const next = section.content_md.replace(target, dedupeOpeningBlock(target));
        await onSectionSave(sectionId, next);
        setUndoable((m) =>
          new Map(m).set(key, { kind: "content", sectionId, prev: section.content_md }),
        );
      } else if (fix === "bullets" && target) {
        // Surgical: bulletize ONLY the flagged dense paragraph and splice it
        // back — the rest of the section (and any GEO additions) untouched.
        if (!section.content_md.includes(target)) {
          showNotice("That paragraph changed — re-analyze and try again.");
          return;
        }
        const { text } = await inlineEdit(draft.id, {
          text: target,
          action: "custom",
          instruction: REWRITE_INSTRUCTION.bullets,
        });
        const next = section.content_md.replace(target, text.trim());
        await onSectionSave(sectionId, next);
        setUndoable((m) =>
          new Map(m).set(key, { kind: "content", sectionId, prev: section.content_md }),
        );
      } else {
        // Protect content another fix added: strip the tracked opener/FAQ out
        // of what the model sees, then re-attach it verbatim.
        const { core, prefix, suffix } = carveProtectedAdditions(
          additions,
          sectionId,
          section.content_md,
        );
        if (!core.trim()) {
          showNotice("Nothing to rewrite here besides content GEO already added.");
          return;
        }
        const { text } = await inlineEdit(draft.id, {
          text: core,
          action: "custom",
          instruction: REWRITE_INSTRUCTION[fix],
        });
        await onSectionSave(sectionId, `${prefix}${text.trim()}${suffix}`);
        setUndoable((m) =>
          new Map(m).set(key, { kind: "content", sectionId, prev: section.content_md }),
        );
      }
      // Re-score ONLY this fix's lever — sibling findings stay applicable.
      queueRescore(FIX_LEVER[fix] ?? "");
      flashSection(sectionId);
    } catch (e) {
      showNotice(e instanceof Error ? e.message : String(e));
    } finally {
      setApplyingKey(null);
    }
  }

  async function applyTitle(sectionId: string, title: string): Promise<void> {
    const nextSections = draft.sections.map((s) => (s.id === sectionId ? { ...s, title } : s));
    const nextOutline = draft.outline
      ? {
          ...draft.outline,
          sections: draft.outline.sections.map((o) => (o.id === sectionId ? { ...o, title } : o)),
        }
      : draft.outline;
    await onChange({ ...draft, sections: nextSections, outline: nextOutline });
  }

  /** Weave a real, author-supplied fact into a flagged passage, in voice.
   * The tool never invents the data — the writer provides it here. */
  async function addData(key: string, target: string): Promise<void> {
    const fact = factText.trim();
    if (!fact) return;
    const section = draft.sections.find((s) => s.content_md.includes(target));
    if (!section) {
      showNotice("That passage changed — re-analyze and try again.");
      return;
    }
    setApplyingKey(key);
    setNotice(null);
    try {
      const { text } = await inlineEdit(draft.id, {
        text: target,
        action: "custom",
        instruction: `Weave this real, author-supplied fact into the passage naturally and in the author's voice. Do NOT change the passage's meaning and do NOT invent anything beyond the fact given. Fact to incorporate: "${fact}". Return only the rewritten passage.`,
      });
      const next = section.content_md.replace(target, text.trim());
      await onSectionSave(section.id, next);
      setUndoable((m) =>
        new Map(m).set(key, { kind: "content", sectionId: section.id, prev: section.content_md }),
      );
      setAddingKey(null);
      setFactText("");
      queueRescore("factual_density");
      flashSection(section.id);
    } catch (e) {
      showNotice(e instanceof Error ? e.message : String(e));
    } finally {
      setApplyingKey(null);
    }
  }

  async function undoRewrite(key: string): Promise<void> {
    const entry = undoable.get(key);
    if (!entry) return;
    setApplyingKey(key);
    try {
      if (entry.kind === "title") {
        await applyTitle(entry.sectionId, entry.prev);
      } else if (entry.kind === "opening") {
        await saveOpening(entry.prev);
      } else {
        await onSectionSave(entry.sectionId, entry.prev);
      }
      setUndoable((m) => {
        const next = new Map(m);
        next.delete(key);
        return next;
      });
      // Re-score the reverted lever too. The key is either "opener-fix" or a
      // findingKey ("<lever>:<...>"), so the lever is the part before the ":".
      queueRescore(key === "opener-fix" ? "definitional_opener" : (key.split(":")[0] ?? ""));
      if (entry.kind === "opening") flashOpening();
      else flashSection(entry.sectionId);
    } catch (e) {
      showNotice(e instanceof Error ? e.message : String(e));
    } finally {
      setApplyingKey(null);
    }
  }

  const grade = report ? gradeColor(report.grade) : gradeColor("F");

  return (
    <div
      ref={panelRef}
      role="dialog"
      aria-modal="true"
      aria-label="GEO optimizer"
      className="fixed right-0 top-0 z-30 h-full w-[460px] max-w-full overflow-y-auto glass-card border-l border-rule shadow-glass-lg animate-slide-in-right"
    >
      <header className="px-6 pt-6 pb-4 border-b border-rule glass-bar sticky top-0 z-10">
        <div className="flex items-baseline justify-between">
          <p className="text-xs font-semibold uppercase tracking-wider text-cobalt-600">
            GEO optimizer
          </p>
          <div className="flex items-center gap-1">
            <button
              type="button"
              onClick={run}
              className="nb-btn nb-btn-ghost nb-btn-sm"
              disabled={busy}
            >
              {busy ? "Analyzing…" : "Re-analyze"}
            </button>
            <button type="button" onClick={onClose} className="nb-icon-btn" aria-label="Close">
              ✕
            </button>
          </div>
        </div>
        <div className="mt-2 flex items-center gap-3">
          <div
            className="flex flex-col items-center justify-center rounded-nb-sm px-3 py-1.5 min-w-[4.5rem]"
            style={{ background: grade.bg, border: `1px solid ${grade.bd}`, color: grade.fg }}
          >
            <span className="text-2xl font-bold leading-none tabular-nums">
              {report?.score ?? "—"}
            </span>
            <span className="text-xs font-semibold">Grade {report?.grade ?? "—"}</span>
          </div>
          <p className="text-xs text-muted leading-snug">
            Structural GEO readiness — how extractable this draft is for AI answer engines.{" "}
            <span className="text-muted-2">
              Not a citation guarantee; off-page authority matters more.
            </span>
          </p>
        </div>
        {cachedAt !== null && !busy && (
          <p className="mt-1.5 text-xs text-muted-2">
            Scored {formatAgo(cachedAt)} · draft unchanged since
          </p>
        )}
      </header>

      {error && (
        <div
          className="mx-6 mt-6 px-3 py-2 rounded-nb-sm text-sm"
          style={{ background: "#fde7e2", border: "1px solid #f7c3b6", color: "#b5321b" }}
        >
          {error}
        </div>
      )}
      {notice && (
        <div
          className="mx-6 mt-6 px-3 py-2 rounded-nb-sm text-sm"
          style={{ background: "#fbf1de", border: "1px solid #f3d89b", color: "#92600a" }}
        >
          {notice}
        </div>
      )}
      {rescoring && !busy && (
        <div className="mx-6 mt-6 px-3 py-2 rounded-nb-sm text-sm bg-cobalt-50 text-cobalt-800">
          Re-scoring the changed lever…
        </div>
      )}

      {!error && (
        <div className="p-6 space-y-4">
          {busy && !report && (
            <p className="py-10 text-center text-sm text-muted">Scoring your draft…</p>
          )}

          {report?.levers.map((lever) => {
            const faqAdded = lever.key === "faq" && !!additions.faq;
            return (
              <section key={lever.key} className="glass-card p-3 space-y-2">
                <div className="flex items-center justify-between gap-3">
                  <h3 className="text-sm font-semibold text-ink">{lever.label}</h3>
                  <span
                    className="text-xs font-mono tabular-nums"
                    style={{ color: barColor(lever.score) }}
                  >
                    {lever.score}
                  </span>
                </div>
                <div className="h-1.5 w-full rounded-full bg-rule/60 overflow-hidden">
                  <div
                    className="h-full rounded-full"
                    style={{ width: `${lever.score}%`, background: barColor(lever.score) }}
                  />
                </div>
                <p className="text-xs text-muted leading-snug">{lever.detail}</p>

                {lever.findings.map((f) => {
                  const key = findingKey(lever, f);
                  if (hidden.has(key)) return null;
                  const applying = applyingKey === key;
                  const undone = undoable.has(key);
                  const canFix = !!f.fix && !!f.section_id && !!REWRITE_LABEL[f.fix];
                  return (
                    <div key={key} className="border-l-2 border-rule pl-2 space-y-1">
                      {f.target && (
                        <p className="text-xs italic text-ink-2 leading-snug">
                          “{f.target.length > 180 ? `${f.target.slice(0, 180)}…` : f.target}”
                        </p>
                      )}
                      <p className="text-xs text-muted leading-snug">{f.note}</p>
                      {f.suggestion && (
                        <p className="text-xs leading-snug text-cobalt-700">→ {f.suggestion}</p>
                      )}
                      {canFix &&
                        (undone ? (
                          <button
                            type="button"
                            disabled={applying}
                            onClick={() => undoRewrite(key)}
                            className="nb-btn nb-btn-ghost nb-btn-sm"
                          >
                            {applying ? "Undoing…" : "↩ Undo"}
                          </button>
                        ) : (
                          <button
                            type="button"
                            disabled={applying}
                            onClick={() =>
                              applyRewrite(key, f.section_id as string, f.fix as string, f.target)
                            }
                            className="nb-btn nb-btn-ghost nb-btn-sm"
                          >
                            {applying ? "Applying…" : REWRITE_LABEL[f.fix as string]}
                          </button>
                        ))}

                      {/* Factual density: you supply the real data, the tool
                          weaves it in — it never invents a number or source. */}
                      {lever.key === "factual_density" &&
                        f.target &&
                        (undone ? (
                          <button
                            type="button"
                            disabled={applying}
                            onClick={() => undoRewrite(key)}
                            className="nb-btn nb-btn-ghost nb-btn-sm"
                          >
                            {applying ? "Undoing…" : "↩ Undo"}
                          </button>
                        ) : addingKey === key ? (
                          <div className="space-y-1.5">
                            <textarea
                              className="nb-input w-full text-sm min-h-[3.5rem]"
                              placeholder="Paste the real stat, quote, or source — e.g. “40% fewer incidents (2026 internal audit, n=312)”"
                              value={factText}
                              onChange={(e) => setFactText(e.target.value)}
                              // biome-ignore lint/a11y/noAutofocus: focus the input the writer just opened
                              autoFocus
                            />
                            <div className="flex gap-1.5">
                              <button
                                type="button"
                                disabled={applying || !factText.trim()}
                                onClick={() => addData(key, f.target as string)}
                                className="nb-btn nb-btn-primary nb-btn-sm"
                              >
                                {applying ? "Weaving in…" : "Weave in"}
                              </button>
                              <button
                                type="button"
                                disabled={applying}
                                onClick={() => {
                                  setAddingKey(null);
                                  setFactText("");
                                }}
                                className="nb-btn nb-btn-ghost nb-btn-sm"
                              >
                                Cancel
                              </button>
                            </div>
                          </div>
                        ) : (
                          <button
                            type="button"
                            onClick={() => {
                              setAddingKey(key);
                              setFactText("");
                            }}
                            className="nb-btn nb-btn-ghost nb-btn-sm"
                          >
                            ＋ Add data
                          </button>
                        ))}

                      {/* Comparison table: build a grounded table from this
                          section's prose and append it (undoable). */}
                      {lever.key === "comparison_table" &&
                        f.section_id &&
                        (undone ? (
                          <button
                            type="button"
                            disabled={applying}
                            onClick={() => undoRewrite(key)}
                            className="nb-btn nb-btn-ghost nb-btn-sm"
                          >
                            {applying ? "Undoing…" : "↩ Undo"}
                          </button>
                        ) : (
                          <button
                            type="button"
                            disabled={applying}
                            onClick={() => addTable(f.section_id as string, key)}
                            className="nb-btn nb-btn-primary nb-btn-sm"
                          >
                            {applying ? "Building…" : "Generate a comparison table"}
                          </button>
                        ))}
                    </div>
                  );
                })}

                {lever.key === "definitional_opener" &&
                  // The opener fixes act on the INTRO (outline.opening_hook),
                  // shown/edited in the Intro card above the sections.
                  (undoable.has("opener-fix") ? (
                    <button
                      type="button"
                      disabled={applyingKey === "opener-fix"}
                      onClick={() => undoRewrite("opener-fix")}
                      className="nb-btn nb-btn-ghost nb-btn-sm"
                    >
                      {applyingKey === "opener-fix" ? "Undoing…" : "↩ Undo"}
                    </button>
                  ) : lever.fix === "definitional" ? (
                    <button
                      type="button"
                      disabled={applyingKey === "opener-fix"}
                      onClick={addOpener}
                      className="nb-btn nb-btn-primary nb-btn-sm"
                    >
                      {applyingKey === "opener-fix" ? "Writing…" : "Add a definitional opener"}
                    </button>
                  ) : lever.fix === "definitional_improve" ? (
                    <button
                      type="button"
                      disabled={applyingKey === "opener-fix"}
                      onClick={improveOpener}
                      className="nb-btn nb-btn-primary nb-btn-sm"
                      title="Rewrite the Intro to lead with a clean, standalone opening line"
                    >
                      {applyingKey === "opener-fix" ? "Rewriting…" : "Improve the opener"}
                    </button>
                  ) : null)}

                {lever.key === "faq" &&
                  (faqAdded ? (
                    <div className="space-y-1">
                      <p className="text-xs leading-snug text-green-ink bg-green-soft rounded-nb-sm px-2 py-1">
                        FAQ added to the end of your last section.
                      </p>
                      <button
                        type="button"
                        disabled={applyingKey === "remove-faq"}
                        onClick={() => removeAddition("faq")}
                        className="nb-btn nb-btn-ghost nb-btn-sm"
                      >
                        {applyingKey === "remove-faq" ? "Removing…" : "✕ Remove FAQ"}
                      </button>
                    </div>
                  ) : (
                    lever.fix === "faq" && (
                      <button
                        type="button"
                        disabled={applyingKey === "faq"}
                        onClick={addFaq}
                        className="nb-btn nb-btn-primary nb-btn-sm"
                      >
                        {applyingKey === "faq" ? "Writing…" : "Generate an FAQ section"}
                      </button>
                    )
                  ))}
              </section>
            );
          })}
        </div>
      )}
    </div>
  );
}
