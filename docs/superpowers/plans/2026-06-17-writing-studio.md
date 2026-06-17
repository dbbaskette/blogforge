# Writing Studio (SP-B) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the "New draft" dialog with a full-screen `/compose` Writing Studio offering four entry modes (outline-in, propose, express, blank) that orchestrate the existing generation engine.

**Architecture:** Frontend-only (React + TS + Vite + Tailwind), zero backend changes. A new `/compose` route holds the studio; each mode calls existing `api/drafts` endpoints and navigates to the existing editor (`/drafts/:id`). New pure units: `parseOutline` (markdown/bullets → outline) and `composeDefaults` (localStorage). The dialog's field group is lifted into a shared, controlled `SetupFields`.

**Tech Stack:** React 18, TypeScript, Vite, Tailwind, react-router-dom v6, vitest + @testing-library/react.

> **Reference spec:** `docs/superpowers/specs/2026-06-17-writing-studio-design.md`
> **Commands** (run from `packages/web`):
> - Typecheck: `./node_modules/.bin/tsc --noEmit`
> - Test (one file): `./node_modules/.bin/vitest run tests/path/file.test.ts`
> - Test (all): `./node_modules/.bin/vitest run`
> - If `pnpm` hits `ECONNRESET`, the local `.bin` binaries already exist — use them directly.

> **Verified engine facts (no backend change needed):**
> - Single-pass compose builds its prompt from `draft.outline.sections`/`opening_hook`/`title`/`idea.target_words` (`packages/api/blogforge/generate/document.py:33-41`).
> - `expandSections` backfills `Section` shells from `draft.outline.sections` and sets `stage="sections"` (`packages/api/blogforge/api/expand.py:55-65`, `:212`); it requires `draft.outline` to be non-null (`:45`).
> - `updateDraft` (PUT) persists a set `outline` and never regresses stage (`packages/api/blogforge/api/drafts.py:188-193`).

---

## File Structure

**New:**
- `packages/web/src/lib/parseOutline.ts` — pure markdown/bullet → `{title, sections}`.
- `packages/web/src/lib/composeDefaults.ts` — last-used settings in `localStorage`.
- `packages/web/src/components/SetupFields.tsx` — controlled field group (voice-source, pack, provider, model, length) + cost hint, lifted from `NewDraftDialog`.
- `packages/web/src/components/compose/ComposeStudio.tsx` — studio shell + per-mode orchestration (`useCompose`).
- `packages/web/src/components/compose/ModePicker.tsx` — four mode cards.
- `packages/web/src/components/compose/VoiceIndicator.tsx` — "writing as ‹voice›".
- `packages/web/src/routes/ComposePage.tsx` — route wrapper.
- Tests under `packages/web/tests/lib/` and `packages/web/tests/components/compose/`.

**Modified:**
- `packages/web/src/App.tsx` — add `/compose` route.
- `packages/web/src/routes/DraftsPage.tsx` — "+ New blog" navigates to `/compose`; remove `NewDraftDialog`.
- `packages/web/src/components/draft/SetupDisclosure.tsx` — re-point at `SetupFields` (Task 7).

**Removed:**
- `packages/web/src/components/NewDraftDialog.tsx` + `packages/web/tests/components/NewDraftDialog.test.tsx` (Task 6).

**Shared type (define in `SetupFields.tsx`, import elsewhere):**
```ts
export interface ComposeSettings {
  pack_slug: string;
  format: string | null;
  provider: "anthropic" | "openai" | "google" | "claude-cli";
  model: string;
  target_words: number;
  use_voice_profile: boolean;
}
```

---

## Task 1: `parseOutline` pure parser (TDD)

**Files:**
- Create: `packages/web/src/lib/parseOutline.ts`
- Test: `packages/web/tests/lib/parseOutline.test.ts`

- [ ] **Step 1: Write the failing tests**

```ts
// packages/web/tests/lib/parseOutline.test.ts
import { describe, expect, it } from "vitest";

import { parseOutline } from "../../src/lib/parseOutline";

describe("parseOutline", () => {
  it("parses an H1 title + H2 sections with briefs", () => {
    const r = parseOutline(
      "# The cost of convenience\n## The promise\nWhat we were sold\n## The reckoning\n",
    );
    expect(r.title).toBe("The cost of convenience");
    expect(r.sections).toEqual([
      { title: "The promise", brief: "What we were sold" },
      { title: "The reckoning", brief: "" },
    ]);
  });

  it("treats top-level bullets as sections and nested bullets as brief", () => {
    const r = parseOutline("My topic\n- First point\n  - detail a\n  - detail b\n- Second point");
    expect(r.title).toBe("My topic");
    expect(r.sections).toEqual([
      { title: "First point", brief: "detail a\ndetail b" },
      { title: "Second point", brief: "" },
    ]);
  });

  it("supports numbered lists as sections", () => {
    const r = parseOutline("Title line\n1. Alpha\n2. Beta");
    expect(r.sections.map((s) => s.title)).toEqual(["Alpha", "Beta"]);
  });

  it("falls back to each non-empty line as a section when no markers", () => {
    const r = parseOutline("My title\nPlain one\nPlain two");
    expect(r.title).toBe("My title");
    expect(r.sections.map((s) => s.title)).toEqual(["Plain one", "Plain two"]);
  });

  it("returns the single line as title with zero sections", () => {
    const r = parseOutline("  Just a topic  ");
    expect(r.title).toBe("Just a topic");
    expect(r.sections).toEqual([]);
  });

  it("handles empty input", () => {
    expect(parseOutline("   \n  ")).toEqual({ title: "", sections: [] });
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `./node_modules/.bin/vitest run tests/lib/parseOutline.test.ts`
Expected: FAIL — `parseOutline` is not defined / module not found.

- [ ] **Step 3: Implement `parseOutline`**

```ts
// packages/web/src/lib/parseOutline.ts
export interface ParsedSection {
  title: string;
  brief: string;
}
export interface ParsedOutline {
  title: string;
  sections: ParsedSection[];
}

const H1_RE = /^#\s+(.+?)\s*$/;
const H_RE = /^#{2,3}\s+(.+?)\s*$/; // H2/H3 → section
// A top-level bullet: no leading whitespace, then -, * or "N." then text.
const TOP_BULLET_RE = /^(?:[-*]|\d+\.)\s+(.+?)\s*$/;

function stripMarkers(line: string): string {
  return line
    .replace(/^\s*#{1,6}\s+/, "")
    .replace(/^\s*(?:[-*]|\d+\.)\s+/, "")
    .trim();
}

/**
 * Parse a pasted outline (markdown headings, bullets, numbered list, or plain
 * lines) into a title + ordered sections. Honors the user's structure exactly;
 * no network, no LLM.
 */
export function parseOutline(text: string): ParsedOutline {
  const rawLines = text.split("\n");
  const nonEmpty = rawLines.filter((l) => l.trim() !== "");
  if (nonEmpty.length === 0) return { title: "", sections: [] };

  // Title: first H1 if present, else the first non-empty line (markers stripped).
  let title = "";
  let titleIdx = -1;
  for (let i = 0; i < rawLines.length; i++) {
    const m = H1_RE.exec(rawLines[i].trim());
    if (m) {
      title = m[1].trim();
      titleIdx = i;
      break;
    }
  }
  if (titleIdx === -1) {
    titleIdx = rawLines.findIndex((l) => l.trim() !== "");
    title = stripMarkers(rawLines[titleIdx]);
  }

  // Sections: H2/H3 or top-level (unindented) bullets after the title line.
  const sections: ParsedSection[] = [];
  const briefLines: string[][] = [];
  const isSection = (line: string): string | null => {
    const h = H_RE.exec(line.trim());
    if (h) return h[1].trim();
    if (/^\S/.test(line)) {
      const b = TOP_BULLET_RE.exec(line);
      if (b) return b[1].trim();
    }
    return null;
  };

  let sawMarker = false;
  for (let i = titleIdx + 1; i < rawLines.length; i++) {
    const line = rawLines[i];
    if (line.trim() === "") continue;
    const sec = isSection(line);
    if (sec !== null) {
      sawMarker = true;
      sections.push({ title: sec, brief: "" });
      briefLines.push([]);
    } else if (sections.length > 0) {
      briefLines[briefLines.length - 1].push(stripMarkers(line));
    }
  }

  // Fallback: no markers at all → each remaining non-empty line is a section.
  if (!sawMarker) {
    for (let i = titleIdx + 1; i < rawLines.length; i++) {
      const line = rawLines[i];
      if (line.trim() === "") continue;
      sections.push({ title: stripMarkers(line), brief: "" });
      briefLines.push([]);
    }
  }

  for (let i = 0; i < sections.length; i++) {
    sections[i].brief = briefLines[i].join("\n").trim();
  }
  return { title, sections };
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `./node_modules/.bin/vitest run tests/lib/parseOutline.test.ts`
Expected: PASS (6 tests).

- [ ] **Step 5: Commit**

```bash
git add packages/web/src/lib/parseOutline.ts packages/web/tests/lib/parseOutline.test.ts
git commit -m "feat(web): parseOutline — pasted outline → structured sections"
```

---

## Task 2: `composeDefaults` localStorage helper (TDD)

**Files:**
- Create: `packages/web/src/lib/composeDefaults.ts`
- Test: `packages/web/tests/lib/composeDefaults.test.ts`

- [ ] **Step 1: Write the failing tests**

```ts
// packages/web/tests/lib/composeDefaults.test.ts
import { beforeEach, describe, expect, it } from "vitest";

import { type ComposeSettings, loadDefaults, saveDefaults } from "../../src/lib/composeDefaults";

const sample: ComposeSettings = {
  pack_slug: "house",
  format: "essay",
  provider: "openai",
  model: "gpt-x",
  target_words: 2000,
  use_voice_profile: false,
};

describe("composeDefaults", () => {
  beforeEach(() => localStorage.clear());

  it("returns the fallback when nothing is stored", () => {
    expect(loadDefaults()).toEqual({
      pack_slug: "",
      format: null,
      provider: "anthropic",
      model: "",
      target_words: 1500,
      use_voice_profile: true,
    });
  });

  it("round-trips saved settings", () => {
    saveDefaults(sample);
    expect(loadDefaults()).toEqual(sample);
  });

  it("returns the fallback when stored JSON is corrupt", () => {
    localStorage.setItem("bf.compose.defaults", "{not json");
    expect(loadDefaults().target_words).toBe(1500);
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `./node_modules/.bin/vitest run tests/lib/composeDefaults.test.ts`
Expected: FAIL — module not found.

> Note: `ComposeSettings` is defined in `SetupFields.tsx` per the File Structure, but Task 3 has not run yet. To keep tasks independently runnable, define `ComposeSettings` in `composeDefaults.ts` and re-export it from `SetupFields.tsx` in Task 3. Update the import in the File Structure mentally: the canonical declaration lives in `composeDefaults.ts`.

- [ ] **Step 3: Implement `composeDefaults`**

```ts
// packages/web/src/lib/composeDefaults.ts
export interface ComposeSettings {
  pack_slug: string;
  format: string | null;
  provider: "anthropic" | "openai" | "google" | "claude-cli";
  model: string;
  target_words: number;
  use_voice_profile: boolean;
}

const KEY = "bf.compose.defaults";

const FALLBACK: ComposeSettings = {
  pack_slug: "",
  format: null,
  provider: "anthropic",
  model: "",
  target_words: 1500,
  use_voice_profile: true,
};

export function loadDefaults(): ComposeSettings {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return { ...FALLBACK };
    const parsed = JSON.parse(raw) as Partial<ComposeSettings>;
    return { ...FALLBACK, ...parsed };
  } catch {
    return { ...FALLBACK };
  }
}

export function saveDefaults(s: ComposeSettings): void {
  try {
    localStorage.setItem(KEY, JSON.stringify(s));
  } catch {
    /* storage disabled — non-fatal */
  }
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `./node_modules/.bin/vitest run tests/lib/composeDefaults.test.ts`
Expected: PASS (3 tests).

- [ ] **Step 5: Commit**

```bash
git add packages/web/src/lib/composeDefaults.ts packages/web/tests/lib/composeDefaults.test.ts
git commit -m "feat(web): composeDefaults — persist last-used compose settings"
```

---

## Task 3: `SetupFields` controlled field group

Lift the field UI (voice-source toggle, pack picker + preview + auto-select, provider/model selectors with loading/error, model cost hint, target-length slider) out of `NewDraftDialog.tsx` into a reusable controlled component. `NewDraftDialog` is NOT removed yet (Task 6) — this task only creates the shared component and proves it renders.

**Files:**
- Create: `packages/web/src/components/SetupFields.tsx`
- Test: `packages/web/tests/components/SetupFields.test.tsx`

- [ ] **Step 1: Create `SetupFields.tsx`**

Define the controlled component. Its props:
```ts
import { type ComposeSettings } from "../lib/composeDefaults";
export type { ComposeSettings }; // re-export so existing imports of ComposeSettings can use this module too

interface SetupFieldsProps {
  value: ComposeSettings;
  onChange: (next: ComposeSettings) => void;
}
```

Lift these pieces VERBATIM from `NewDraftDialog.tsx` into `SetupFields.tsx` (they are currently module-private there):
- `ModelCostHint` (lines 439-464), `formatRateSuffix` (432-437), `WORDS_TO_OUT_TOKENS`/`ASSUMED_INPUT_TOKENS` (428-430), `PackPreview` (393-406), `AutoSelectPack` (379-391), and the local `Field` helper (408-425).

The component body adapts `NewDraftDialog`'s internal state to controlled props:
- Replace the individual `useState` (`pack`, `provider`, `model`, `targetWords`, `useVoiceProfile`, `format`) with reads from `value` and writes via `onChange({ ...value, <field>: ... })`.
- Keep the data-fetching state (`packs`, `providers`, `models`, `modelsError`) and the two effects that load providers/packs on mount and models when `value.provider` changes (lines 37-48 and 68-99), plus the effect that auto-picks the first model when the current one is invalid (92-99) — but have the auto-pick call `onChange({ ...value, model: models[0].id })` instead of `setModel`.
- Render, in order: the **Voice source** toggle (NewDraftDialog 204-232, driving `value.use_voice_profile`), the **pack** block (234-281, driving `value.pack_slug`, including hidden picker + `AutoSelectPack` in profile mode), the **Format** select (a new field; options come from the selected pack's manifest — reuse the manifest-fetch pattern from `SetupDisclosure.tsx:40-61`, writing `value.format`), the **Provider**/**Model** grid (283-315), `ModelCostHint` (317), the `modelsError` banner (319-326), and the **Target length** slider (328-345, driving `value.target_words`).

Do NOT include: the topic input, templates, submit button, dialog chrome, or `createDraft` — those stay with the caller.

- [ ] **Step 2: Write a render/interaction test**

```tsx
// packages/web/tests/components/SetupFields.test.tsx
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../../src/api/packs", () => ({
  listPacks: vi.fn().mockResolvedValue([{ slug: "house", valid: true }]),
  getManifest: vi.fn().mockResolvedValue({ formats: [] }),
}));
vi.mock("../../src/api/providers", () => ({
  listProviderAvailability: vi.fn().mockResolvedValue({ anthropic: true }),
  listModels: vi.fn().mockResolvedValue([{ id: "m1", label: "Model One" }]),
}));

import { type ComposeSettings, SetupFields } from "../../src/components/SetupFields";

const base: ComposeSettings = {
  pack_slug: "house",
  format: null,
  provider: "anthropic",
  model: "m1",
  target_words: 1500,
  use_voice_profile: true,
};

describe("SetupFields", () => {
  beforeEach(() => vi.clearAllMocks());

  it("renders the model and emits target_words changes", async () => {
    const onChange = vi.fn();
    render(<SetupFields value={base} onChange={onChange} />);
    await waitFor(() => expect(screen.getByText(/Model One/)).toBeInTheDocument());
    fireEvent.change(screen.getByLabelText(/Target length/i), { target: { value: "2000" } });
    expect(onChange).toHaveBeenCalledWith(expect.objectContaining({ target_words: 2000 }));
  });

  it("emits use_voice_profile=false when 'A voice pack' is chosen", async () => {
    const onChange = vi.fn();
    render(<SetupFields value={base} onChange={onChange} />);
    fireEvent.click(screen.getByRole("button", { name: /a voice pack/i }));
    expect(onChange).toHaveBeenCalledWith(expect.objectContaining({ use_voice_profile: false }));
  });
});
```
(If the existing pack/providers API exports differ, match the real export names from `src/api/packs.ts` and `src/api/providers.ts`; adjust the `vi.mock` factory accordingly. Give the target-length slider `aria-label="Target length"` so the test can select it.)

- [ ] **Step 3: Run the test to verify it fails, then passes**

Run: `./node_modules/.bin/vitest run tests/components/SetupFields.test.tsx`
First expected: FAIL (component missing). After Step 1 is complete: PASS (2 tests).

- [ ] **Step 4: Typecheck**

Run: `./node_modules/.bin/tsc --noEmit`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/web/src/components/SetupFields.tsx packages/web/tests/components/SetupFields.test.tsx
git commit -m "feat(web): extract shared SetupFields (voice/pack/provider/model/length + cost)"
```

---

## Task 4: `ComposeStudio` shell — mode picker, voice indicator, advanced settings, Blank flow

Build the studio page with mode selection, the voice indicator, the Advanced (collapsible `SetupFields`) panel seeded from `composeDefaults`, an optional "Start from template" row, and the simplest mode (Blank) wired end-to-end. Other modes are added in Task 5.

**Files:**
- Create: `packages/web/src/components/compose/ModePicker.tsx`
- Create: `packages/web/src/components/compose/VoiceIndicator.tsx`
- Create: `packages/web/src/components/compose/ComposeStudio.tsx`
- Create: `packages/web/src/routes/ComposePage.tsx`
- Test: `packages/web/tests/components/compose/ComposeStudio.test.tsx`

- [ ] **Step 1: `ModePicker.tsx`**

```tsx
// packages/web/src/components/compose/ModePicker.tsx
export type ComposeMode = "outline" | "propose" | "express" | "blank";

const MODES: { id: ComposeMode; accent: string; icon: string; title: string; blurb: string }[] = [
  { id: "outline", accent: "accent-blue", icon: "📋", title: "I have an outline", blurb: "Paste your structure — AI writes the full draft from it." },
  { id: "propose", accent: "accent-teal", icon: "💬", title: "Help me shape it", blurb: "Describe the topic — get an outline to tweak, then AI writes it." },
  { id: "express", accent: "accent-amber", icon: "⚡", title: "Just write it", blurb: "A topic in, a full draft out — one shot." },
  { id: "blank", accent: "accent-green", icon: "📝", title: "Blank page", blurb: "Start empty and write yourself, with inline AI tools." },
];

export function ModePicker({
  active,
  onPick,
}: {
  active: ComposeMode | null;
  onPick: (m: ComposeMode) => void;
}): JSX.Element {
  return (
    <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
      {MODES.map((m) => (
        <button
          key={m.id}
          type="button"
          onClick={() => onPick(m.id)}
          aria-pressed={active === m.id}
          className={`glass-card ${m.accent} text-left p-4 transition-shadow hover:shadow-glass-lg ${
            active === m.id ? "ring-2 ring-cobalt-400" : ""
          }`}
        >
          <p className="font-semibold text-ink">{m.icon} {m.title}</p>
          <p className="text-sm text-muted mt-1 leading-snug">{m.blurb}</p>
        </button>
      ))}
    </div>
  );
}
```

- [ ] **Step 2: `VoiceIndicator.tsx`**

```tsx
// packages/web/src/components/compose/VoiceIndicator.tsx
import { useEffect, useState } from "react";
import { Link } from "react-router-dom";

import { getVoiceProfile } from "../../api/voice";

export function VoiceIndicator(): JSX.Element {
  const [name, setName] = useState<string | null>(null);
  useEffect(() => {
    getVoiceProfile()
      .then((p) => setName(p?.name ?? null))
      .catch(() => setName(null));
  }, []);
  return (
    <span className="glass-card inline-flex items-center gap-1.5 px-3 py-1.5 text-xs text-ink">
      ✍ writing as <b className="text-cobalt-700">{name ?? "your voice"}</b>
      <Link to="/voice" className="text-cobalt-600 hover:text-cobalt-700">· edit</Link>
    </span>
  );
}
```
(Match the real export in `src/api/voice.ts` for fetching the profile — if it is named e.g. `getProfile`, use that. If the profile can be absent, the `?? "your voice"` fallback covers it.)

- [ ] **Step 3: `ComposeStudio.tsx` shell + Blank flow + `useCompose`**

Create the studio. It owns: `mode` (`ComposeMode | null`), `settings` (`ComposeSettings`, init `loadDefaults()`), `topic`/`outlineText` inputs, `busy`, `error`. Include a collapsible **Advanced** `<SetupFields value={settings} onChange={setSettings} />`, the `VoiceIndicator`, the `ModePicker`, and a "Start from template" row (reuse `listTemplates`/`deleteTemplate` from `src/api/templates.ts`; applying a template sets `topic` and merges its `{pack_slug, provider, model, target_words, format}` into `settings`).

Add a `useCompose` helper in this file that builds the `IdeaInput` and runs each flow. Blank flow only for this task:

```tsx
// inside ComposeStudio.tsx
import { useNavigate } from "react-router-dom";
import { type IdeaInput, createDraft } from "../../api/drafts";
import { type ComposeSettings, SetupFields } from "../SetupFields";
import { loadDefaults, saveDefaults } from "../../lib/composeDefaults";

function ideaFrom(settings: ComposeSettings, topic: string, bullets: string[] = [], notes = ""): IdeaInput {
  return { topic, bullets, notes, ...settings };
}

// blank:
async function runBlank(): Promise<void> {
  setBusy(true); setError(null);
  try {
    const idea = ideaFrom(settings, topic.trim() || "Untitled");
    const draft = await createDraft(idea);
    saveDefaults(settings);
    navigate(`/drafts/${draft.id}`);
  } catch (e) {
    setError(e instanceof Error ? e.message : String(e));
  } finally {
    setBusy(false);
  }
}
```

Render the active mode's panel area; for this task, when `mode === "blank"` show a title input + an "Open editor" button calling `runBlank`. For the other three modes, render a placeholder `<p className="text-muted text-sm">Coming in the next step.</p>` (this placeholder is removed in Task 5). Error renders in a coral `.nb-note`-style banner: `style={{ background: "#fde7e2", color: "#b5321b", border: "1px solid #f7c3b6" }}`.

- [ ] **Step 4: `ComposePage.tsx`**

```tsx
// packages/web/src/routes/ComposePage.tsx
import { ComposeStudio } from "../components/compose/ComposeStudio";

export function ComposePage(): JSX.Element {
  return (
    <div className="max-w-3xl mx-auto px-6 py-8">
      <ComposeStudio />
    </div>
  );
}
```

- [ ] **Step 5: Test — renders modes + Blank creates and navigates**

```tsx
// packages/web/tests/components/compose/ComposeStudio.test.tsx
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";

const navigate = vi.fn();
vi.mock("react-router-dom", async (orig) => ({
  ...(await orig<typeof import("react-router-dom")>()),
  useNavigate: () => navigate,
}));
vi.mock("../../../src/api/drafts", () => ({
  createDraft: vi.fn().mockResolvedValue({ id: "d1" }),
}));
vi.mock("../../../src/api/templates", () => ({
  listTemplates: vi.fn().mockResolvedValue([]),
  deleteTemplate: vi.fn(),
}));
vi.mock("../../../src/api/voice", () => ({ getVoiceProfile: vi.fn().mockResolvedValue({ name: "Dan" }) }));
vi.mock("../../../src/api/packs", () => ({
  listPacks: vi.fn().mockResolvedValue([{ slug: "house", valid: true }]),
  getManifest: vi.fn().mockResolvedValue({ formats: [] }),
}));
vi.mock("../../../src/api/providers", () => ({
  listProviderAvailability: vi.fn().mockResolvedValue({ anthropic: true }),
  listModels: vi.fn().mockResolvedValue([{ id: "m1", label: "Model One" }]),
}));

import { createDraft } from "../../../src/api/drafts";
import { ComposeStudio } from "../../../src/components/compose/ComposeStudio";

const renderStudio = () => render(<MemoryRouter><ComposeStudio /></MemoryRouter>);

describe("ComposeStudio", () => {
  beforeEach(() => { vi.clearAllMocks(); localStorage.clear(); });

  it("shows the four modes", () => {
    renderStudio();
    expect(screen.getByText(/I have an outline/)).toBeInTheDocument();
    expect(screen.getByText(/Help me shape it/)).toBeInTheDocument();
    expect(screen.getByText(/Just write it/)).toBeInTheDocument();
    expect(screen.getByText(/Blank page/)).toBeInTheDocument();
  });

  it("Blank mode creates a draft and navigates to the editor", async () => {
    renderStudio();
    fireEvent.click(screen.getByText(/Blank page/));
    fireEvent.click(screen.getByRole("button", { name: /open editor/i }));
    await waitFor(() => expect(createDraft).toHaveBeenCalled());
    expect(navigate).toHaveBeenCalledWith("/drafts/d1");
  });
});
```

- [ ] **Step 6: Run tests + typecheck**

Run: `./node_modules/.bin/vitest run tests/components/compose/ComposeStudio.test.tsx` → PASS (2).
Run: `./node_modules/.bin/tsc --noEmit` → PASS.

- [ ] **Step 7: Commit**

```bash
git add packages/web/src/components/compose packages/web/src/routes/ComposePage.tsx packages/web/tests/components/compose
git commit -m "feat(web): compose studio shell + mode picker + blank flow"
```

---

## Task 5: Outline-in, Express, and Propose flows

Add the three remaining mode panels and their orchestration to `ComposeStudio.tsx`, replacing the Task-4 placeholders.

**Files:**
- Modify: `packages/web/src/components/compose/ComposeStudio.tsx`
- Modify: `packages/web/tests/components/compose/ComposeStudio.test.tsx`

- [ ] **Step 1: Add the three flow functions to `ComposeStudio.tsx`**

```tsx
import { createDraft, expandSections, generateOutline, getDraft, updateDraft } from "../../api/drafts";
import { parseOutline } from "../../lib/parseOutline";

// OUTLINE-IN
async function runOutline(): Promise<void> {
  const parsed = parseOutline(outlineText);
  if (parsed.sections.length === 0) {
    setError("Add at least one heading or bullet, or use Just write it.");
    return;
  }
  setBusy(true); setError(null);
  try {
    const idea = ideaFrom(settings, parsed.title || "Untitled");
    const draft = await createDraft(idea);
    const withOutline = {
      ...draft,
      title: parsed.title || draft.title,
      outline: {
        opening_hook: "",
        sections: parsed.sections.map((s) => ({ id: crypto.randomUUID().replace(/-/g, ""), title: s.title, brief: s.brief })), // dash-less hex to match backend _uuid (see OutlinePanel.tsx:9)
        estimated_words: 0,
      },
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
async function runExpress(): Promise<void> {
  setBusy(true); setError(null);
  try {
    const idea = ideaFrom(settings, topic.trim());
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
  setBusy(true); setError(null);
  try {
    const idea = ideaFrom(settings, topic.trim());
    const draft = await createDraft(idea);
    saveDefaults(settings);
    navigate(`/drafts/${draft.id}`); // editor opens at the ideation/research stage
  } catch (e) {
    setError(e instanceof Error ? e.message : String(e));
  } finally {
    setBusy(false);
  }
}
```
Notes: the `Draft` shape requires `outline` to be an `OutlineProposal | null`; the object above matches `OutlineProposal` (`opening_hook`, `sections[{id,title,brief}]`, `estimated_words`). `updateDraft(id, draft)` takes the full `Draft` (see `api/drafts.ts:68`) — spread the created `draft` so required fields (`stage`, `idea`, `sections`, etc.) are present. `getDraft` import is available if you prefer to refetch before PUT, but spreading the create response is sufficient.

- [ ] **Step 2: Render the three panels**

Replace the Task-4 placeholders so that:
- `mode === "outline"` → a `<textarea>` bound to `outlineText` (label "Your outline", `aria-label="Your outline"`), a live parsed-section preview (`parseOutline(outlineText).sections` as a bulleted list), and a "Write draft →" primary button → `runOutline` (disabled while `busy` or when `parseOutline(outlineText).sections.length === 0`).
- `mode === "express"` → a topic `<input>` bound to `topic` + "Outline & write →" button → `runExpress` (disabled while `busy` or `!topic.trim()`); while `busy`, the button reads "Outlining → writing…".
- `mode === "propose"` → a topic `<input>` bound to `topic` + "Start →" button → `runPropose` (disabled while `busy` or `!topic.trim()`).

- [ ] **Step 3: Extend the test with the three flows**

Add to `ComposeStudio.test.tsx` (extend the existing `vi.mock("../../../src/api/drafts", …)` to include the new functions):
```tsx
vi.mock("../../../src/api/drafts", () => ({
  createDraft: vi.fn().mockResolvedValue({ id: "d1", title: "", stage: "research", idea: {}, sections: [], outline: null }),
  updateDraft: vi.fn().mockResolvedValue({}),
  expandSections: vi.fn().mockResolvedValue({ job_id: "j1" }),
  generateOutline: vi.fn().mockResolvedValue({}),
  getDraft: vi.fn(),
}));
```
```tsx
import { createDraft, expandSections, generateOutline, updateDraft } from "../../../src/api/drafts";

it("Outline-in parses, injects outline, expands, navigates", async () => {
  renderStudio();
  fireEvent.click(screen.getByText(/I have an outline/));
  fireEvent.change(screen.getByLabelText(/your outline/i), {
    target: { value: "# T\n## One\n## Two" },
  });
  fireEvent.click(screen.getByRole("button", { name: /write draft/i }));
  await waitFor(() => expect(expandSections).toHaveBeenCalledWith("d1"));
  expect(createDraft).toHaveBeenCalled();
  expect(updateDraft).toHaveBeenCalledWith("d1", expect.objectContaining({
    outline: expect.objectContaining({ sections: expect.arrayContaining([expect.objectContaining({ title: "One" })]) }),
  }));
  expect(navigate).toHaveBeenCalledWith("/drafts/d1");
});

it("Express creates, outlines, expands, navigates", async () => {
  renderStudio();
  fireEvent.click(screen.getByText(/Just write it/));
  fireEvent.change(screen.getByLabelText(/topic/i), { target: { value: "My topic" } });
  fireEvent.click(screen.getByRole("button", { name: /outline & write/i }));
  await waitFor(() => expect(expandSections).toHaveBeenCalledWith("d1"));
  expect(generateOutline).toHaveBeenCalledWith("d1");
  expect(navigate).toHaveBeenCalledWith("/drafts/d1");
});

it("Propose creates and navigates to the editor", async () => {
  renderStudio();
  fireEvent.click(screen.getByText(/Help me shape it/));
  fireEvent.change(screen.getByLabelText(/topic/i), { target: { value: "My topic" } });
  fireEvent.click(screen.getByRole("button", { name: /start/i }));
  await waitFor(() => expect(navigate).toHaveBeenCalledWith("/drafts/d1"));
});
```
(Give the express/propose topic input `aria-label="Topic"`.)

- [ ] **Step 4: Run tests + typecheck**

Run: `./node_modules/.bin/vitest run tests/components/compose/ComposeStudio.test.tsx` → PASS (5).
Run: `./node_modules/.bin/tsc --noEmit` → PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/web/src/components/compose/ComposeStudio.tsx packages/web/tests/components/compose/ComposeStudio.test.tsx
git commit -m "feat(web): outline-in, express, and propose compose flows"
```

---

## Task 6: Route wiring + retire `NewDraftDialog`

**Files:**
- Modify: `packages/web/src/App.tsx`
- Modify: `packages/web/src/routes/DraftsPage.tsx`
- Delete: `packages/web/src/components/NewDraftDialog.tsx`
- Delete: `packages/web/tests/components/NewDraftDialog.test.tsx`

- [ ] **Step 1: Add the `/compose` route**

In `App.tsx`, import `ComposePage` and add inside the `AppShell` route group (alongside the others):
```tsx
import { ComposePage } from "./routes/ComposePage";
// ...
<Route
  path="/compose"
  element={
    <RequireAuth>
      <ComposePage />
    </RequireAuth>
  }
/>
```

- [ ] **Step 2: Point the dashboard CTA at `/compose` and remove the dialog**

In `DraftsPage.tsx`:
- Remove `import { NewDraftDialog } from "../components/NewDraftDialog";`, the `<NewDraftDialog open={newOpen} … />` usage (line ~209), and the `const [newOpen, setNewOpen] = useState(false)` state (line ~34).
- There are two `onNew` call sites — `<Hero onNew={() => setNewOpen(true)} />` (line ~100) and `<EmptyState onNew={() => setNewOpen(true)} />` (line ~189). Add `const navigate = useNavigate();` (DraftsPage already imports from react-router-dom — confirm/extend the import) and change both to `onNew={() => navigate("/compose")}`. Keep the "New piece" button label/styling inside `Hero`/`EmptyState` unchanged.

- [ ] **Step 3: Delete the dialog + its test**

```bash
git rm packages/web/src/components/NewDraftDialog.tsx packages/web/tests/components/NewDraftDialog.test.tsx
```
(The cost-hint/field logic now lives in `SetupFields`; the creation flow lives in `ComposeStudio`. No assertions are lost that aren't covered by `SetupFields.test.tsx` + `ComposeStudio.test.tsx`.)

- [ ] **Step 4: Verify the whole suite + typecheck + build**

Run (from `packages/web`):
- `./node_modules/.bin/tsc --noEmit` → PASS (no dangling `NewDraftDialog` imports).
- `./node_modules/.bin/vitest run` → all pass (the removed dialog test is gone; the new tests cover creation).
- `./node_modules/.bin/vite build` → clean.

- [ ] **Step 5: Commit**

```bash
git add packages/web/src/App.tsx packages/web/src/routes/DraftsPage.tsx
git commit -m "feat(web): route /compose to the studio; retire NewDraftDialog"
```

---

## Task 7: Re-point `SetupDisclosure` at `SetupFields` (DRY)

Remove the duplicated field rendering in the in-editor Setup so the studio and the editor share one field group.

**Files:**
- Modify: `packages/web/src/components/draft/SetupDisclosure.tsx`

- [ ] **Step 1: Replace the inner fields with `SetupFields`**

`SetupDisclosure` is controlled via `onChange(idea: IdeaInput)` and renders the collapsible "Setup" header + summary. Keep the header/summary/disclosure behavior. Replace the inner grid of fields (the voice toggle, pack, format, provider, model selects, and target-words slider — `SetupDisclosure.tsx:119-231`) with:
```tsx
import { type ComposeSettings, SetupFields } from "../SetupFields";

// derive settings from the draft's idea:
const settings: ComposeSettings = {
  pack_slug: idea.pack_slug,
  format: idea.format ?? null,
  provider: idea.provider,
  model: idea.model,
  target_words: idea.target_words ?? 1500,
  use_voice_profile: idea.use_voice_profile ?? true,
};
// ...
<SetupFields
  value={settings}
  onChange={(next) => onChange({ ...idea, ...next })}
/>
```
Keep the existing `summary` line and the `PackPreview` if you wish (it now also lives in `SetupFields`; remove the local duplicate in `SetupDisclosure` to avoid two copies).

- [ ] **Step 2: Verify the editor still works**

Run (from `packages/web`):
- `./node_modules/.bin/tsc --noEmit` → PASS.
- `./node_modules/.bin/vitest run` → all pass (DraftPage and any SetupDisclosure-touching tests stay green; if a test asserted a now-relocated label, update the selector — not the behavior).

- [ ] **Step 3: Commit**

```bash
git add packages/web/src/components/draft/SetupDisclosure.tsx
git commit -m "refactor(web): SetupDisclosure reuses shared SetupFields (DRY)"
```

---

## Self-Review Notes

- **Spec coverage:** route/components → Tasks 4-6; per-mode data flow → Tasks 4-5; outline parser → Task 1; settings/defaults → Task 2 + Task 4; voice indicator → Task 4; `SetupFields` extraction + `NewDraftDialog` retirement → Tasks 3, 6; SetupDisclosure reuse → Task 7; testing → embedded per task. No backend tasks (spec: zero backend).
- **Type consistency:** `ComposeSettings` declared in `composeDefaults.ts`, re-exported from `SetupFields.tsx`; `ComposeMode` in `ModePicker.tsx`; `parseOutline`→`ParsedOutline`. Flow functions use `createDraft`/`updateDraft`/`expandSections`/`generateOutline` exactly as exported in `api/drafts.ts`.
- **Known adapt-on-contact points (call out, don't guess):** exact export names in `src/api/voice.ts` (profile fetch), `src/api/packs.ts`, `src/api/providers.ts`, and the `DraftsPage` "new" control — each task says to match the real symbol and adjust the mock/handler accordingly.
- **YAGNI:** no studio-hosted chat (Propose reuses the editor ideation stage); no backend; templates preserved (not expanded).
