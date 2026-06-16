# Liquid-Glass UI Overhaul Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Re-skin the BlogForge web app from the flat "Notebook" theme to a vibrant liquid-glass aesthetic (cool blue→teal wash, frosted-glass chrome, cobalt-blue + teal/amber/coral/green accents, near-solid prose).

**Architecture:** In-place token + class overhaul. All design tokens live in `packages/web/tailwind.config.ts`; all component classes live in `packages/web/src/index.css` (`nb-*` + `.prose-body`). Re-skinning these two files cascades through every component. A short list of components with hardcoded colors get a touch-up pass. Style-only — no logic, layout, or copy changes.

**Tech Stack:** React + TypeScript + Vite + Tailwind CSS. Verification via `tsc --noEmit` and `vitest` (existing ≈76 web tests).

> **Note on testing:** This is a CSS/token re-skin — there is no new unit-test surface. "Verification" for each task means: (a) `tsc` typecheck stays clean, (b) the existing test suite stays green (style-only changes must not break any test), and (c) a visual check. Do NOT add or rewrite tests to match new class names; if an existing test breaks, that is a signal to investigate, not to update the test.

> **Reference spec:** `docs/superpowers/specs/2026-06-16-liquid-glass-ui-design.md`

> **Commands** (run from `packages/web`):
> - Typecheck: `./node_modules/.bin/tsc --noEmit` (or `pnpm exec tsc --noEmit`)
> - Tests: `./node_modules/.bin/vitest run` (or `pnpm exec vitest run`)
> - If `pnpm` hits `ECONNRESET` during install, the local `.bin` binaries are already present — use them directly.

---

## File Structure

- **`packages/web/tailwind.config.ts`** — design tokens. Retune `cobalt`, add `teal`/`amber`(retune)/`coral`/`green` accent scales, alias `leaf`/`rose`, add glass shadows, retune `nb-cobalt` shadow, update `ink`.
- **`packages/web/src/index.css`** — `:root` CSS variables, body wash, glass utility classes, near-solid `nb-card`, accent helpers, retuned `nb-pill-*` / `nb-btn-primary`, and a hardcoded-hex sweep (`#4f6df0` / `rgba(79,109,240,…)` / `#2b40a8`).
- **`packages/web/src/components/AppShell.tsx`** — root background → transparent (let body wash show); `TopBar` header → `.glass-bar`.
- **Clash sweep** — `NewDraftDialog.tsx` and other modal/dialog surfaces, `SetupDisclosure.tsx` panels: migrate hardcoded `bg-white`/`bg-card` floating surfaces to `.glass-card` where they would clash on the wash.

---

## Task 1: Tailwind tokens — palette, accents, glass shadows

**Files:**
- Modify: `packages/web/tailwind.config.ts`

- [ ] **Step 1: Retune the `cobalt` scale and `ink`**

In the `colors` block, replace the `cobalt` object and `ink.DEFAULT` with:

```ts
ink: {
  DEFAULT: "#15224a",
  2: "#3a3f47",
},
```
```ts
cobalt: {
  DEFAULT: "#2f6bff",
  50: "#eaf0ff",
  100: "#d6e2ff",
  200: "#adc6ff",
  300: "#7aa3ff",
  400: "#4d84ff",
  500: "#2f6bff",
  600: "#1f54e6",
  700: "#1741b8",
  800: "#102e85",
  900: "#0a1c54",
},
```

- [ ] **Step 2: Replace the status accents with the new color-coded set**

Replace the existing `leaf` / `amber` / `rose` color objects with the four new accent scales plus `leaf`/`rose` aliases (so existing `bg-leaf-soft` / `text-rose-ink` className usages keep resolving):

```ts
// Semantic accents — color-coded to functions.
teal: {
  DEFAULT: "#16c2b3",
  soft: "#dff7f4",
  ink: "#0e7a72",
},
amber: {
  DEFAULT: "#f59e0b",
  soft: "#fbf1de",
  ink: "#92600a",
},
coral: {
  DEFAULT: "#e6492d",
  soft: "#fde7e2",
  ink: "#b5321b",
},
green: {
  DEFAULT: "#15a06b",
  soft: "#e3f5ec",
  ink: "#0e7a50",
},
// Back-compat aliases for existing className usages.
leaf: {
  DEFAULT: "#15a06b",
  soft: "#e3f5ec",
},
rose: {
  DEFAULT: "#e6492d",
  soft: "#fde7e2",
  ink: "#b5321b",
},
```

- [ ] **Step 3: Add glass shadows and retune `nb-cobalt`**

In the `boxShadow` block, add the two glass shadows and retune `nb-cobalt` to the new blue:

```ts
nb: "0 1px 2px rgba(15, 23, 42, 0.04), 0 4px 12px -4px rgba(15, 23, 42, 0.06)",
"nb-hover": "0 2px 4px rgba(15, 23, 42, 0.06), 0 12px 32px -8px rgba(15, 23, 42, 0.12)",
"nb-pop": "0 1px 2px rgba(15, 23, 42, 0.04), 0 8px 28px -8px rgba(15, 23, 42, 0.18)",
"nb-cobalt": "0 1px 2px rgba(47, 107, 255, 0.3), 0 4px 12px -2px rgba(47, 107, 255, 0.35)",
glass: "0 4px 16px -8px rgba(30, 60, 110, 0.22)",
"glass-lg": "0 8px 28px -10px rgba(30, 60, 110, 0.28)",
```

- [ ] **Step 4: Typecheck**

Run (from `packages/web`): `./node_modules/.bin/tsc --noEmit`
Expected: PASS (config is `satisfies Config`; a malformed object would error here).

- [ ] **Step 5: Commit**

```bash
git add packages/web/tailwind.config.ts
git commit -m "feat(web): retune palette to electric-blue + primary accents (liquid-glass)"
```

---

## Task 2: index.css — CSS variables, wash, hardcoded-hex sweep

**Files:**
- Modify: `packages/web/src/index.css`

- [ ] **Step 1: Add the `:root` variables**

Immediately after the `@tailwind utilities;` line (and the header comment block), add:

```css
:root {
  /* App wash (cool blue → teal → warm amber) */
  --wash-1: #e6efff;
  --wash-2: #e3f7f4;
  --wash-3: #fff4e0;
  /* Glass surfaces */
  --glass-bg: rgba(255, 255, 255, 0.55);
  --glass-bg-card: rgba(255, 255, 255, 0.65);
  --glass-border: rgba(255, 255, 255, 0.75);
  --glass-blur: 14px;
  --content-bg: rgba(255, 255, 255, 0.92); /* near-solid for prose/content */
}
```

- [ ] **Step 2: Replace the flat body background with the fixed wash**

Replace the existing `body { ... }` rule:

```css
body {
  background: linear-gradient(135deg, var(--wash-1) 0%, var(--wash-2) 55%, var(--wash-3) 100%);
  background-attachment: fixed;
  color: #15224a;
  line-height: 1.55;
}
```

- [ ] **Step 3: Sweep hardcoded blues to the new electric blue**

Update these exact occurrences:
- `::selection` → `background: rgba(47, 107, 255, 0.18);` and `color: #15224a;`
- `:focus-visible` → `outline: 2px solid #2f6bff;`
- `.prose-body code` → `color: #1741b8;`
- `.prose-body a` → `color: #2f6bff;`
- `.prose-body a:hover` → `color: #1741b8;`
- `input[type="range"]` → `accent-color: #2f6bff;`

- [ ] **Step 4: Typecheck (sanity — CSS doesn't typecheck, this confirms nothing else broke)**

Run: `./node_modules/.bin/tsc --noEmit`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/web/src/index.css
git commit -m "feat(web): cool blue-teal wash + CSS-variable glass tokens"
```

---

## Task 3: index.css — glass utilities, near-solid card, accent helpers, pills/buttons

**Files:**
- Modify: `packages/web/src/index.css`

- [ ] **Step 1: Make `nb-card` a near-solid frosted surface**

Replace the `.nb-card` rule's `background`:

```css
.nb-card {
  background: var(--content-bg);
  backdrop-filter: blur(4px);
  -webkit-backdrop-filter: blur(4px);
  border: 1px solid #e6e8ed;
  border-radius: 12px;
  box-shadow: 0 1px 2px rgba(15, 23, 42, 0.04), 0 4px 12px -4px rgba(15, 23, 42, 0.06);
  transition: box-shadow 0.2s ease-out, border-color 0.2s ease-out;
}
```

- [ ] **Step 2: Add glass chrome utilities**

In the Components section, add:

```css
/* Frosted chrome — sticky top bar / nav */
.glass-bar {
  background: var(--glass-bg);
  backdrop-filter: blur(var(--glass-blur));
  -webkit-backdrop-filter: blur(var(--glass-blur));
  border-bottom: 1px solid var(--glass-border);
  box-shadow: 0 4px 16px -8px rgba(30, 60, 110, 0.22);
}

/* Frosted floating surface — side panels, tool cards, dialogs */
.glass-card {
  background: var(--glass-bg-card);
  backdrop-filter: blur(var(--glass-blur));
  -webkit-backdrop-filter: blur(var(--glass-blur));
  border: 1px solid var(--glass-border);
  border-radius: 12px;
  box-shadow: 0 4px 16px -8px rgba(30, 60, 110, 0.22);
}
```

- [ ] **Step 3: Add accent helpers (color-coded chrome)**

```css
/* Color-coded accents — left border + soft tint */
.accent-blue  { border-left: 3px solid #2f6bff; }
.accent-teal  { border-left: 3px solid #16c2b3; }
.accent-amber { border-left: 3px solid #f59e0b; }
.accent-coral { border-left: 3px solid #e6492d; }
.accent-green { border-left: 3px solid #15a06b; }
```

- [ ] **Step 4: Retune status pills and primary button to the new accents**

Replace the pill color rules:

```css
.nb-pill-ready  { background: #e3f5ec; color: #0e7a50; }
.nb-pill-empty  { background: #f6f7f9; color: #6e7682; border: 1px dashed #d0d4dc; padding-block: 1px; }
.nb-pill-failed { background: #fde7e2; color: #b5321b; }
.nb-pill-gen    { background: #fbf1de; color: #92600a; }
.nb-pill-edited { background: #eaf0ff; color: #1741b8; }
```

Replace `.nb-btn-primary` (and its hover/disabled/focus hexes):

```css
.nb-btn-primary {
  background: #2f6bff;
  border-color: #2f6bff;
  color: #ffffff;
  box-shadow: 0 1px 2px rgba(47, 107, 255, 0.3), 0 4px 12px -2px rgba(47, 107, 255, 0.35);
}
.nb-btn-primary:hover:not(:disabled) {
  background: #1741b8;
  border-color: #1741b8;
}
.nb-btn-primary:disabled {
  background: #adc6ff;
  border-color: #adc6ff;
  color: #ffffff;
  box-shadow: none;
}
```

Also update the form-control focus rule:

```css
.nb-input:focus,
.nb-select:focus,
.nb-textarea:focus {
  outline: none;
  border-color: #2f6bff;
  box-shadow: 0 0 0 3px rgba(47, 107, 255, 0.12);
}
```

- [ ] **Step 5: Verify build + tests**

Run (from `packages/web`):
- `./node_modules/.bin/tsc --noEmit` → PASS
- `./node_modules/.bin/vitest run` → all existing tests PASS (≈76)

- [ ] **Step 6: Commit**

```bash
git add packages/web/src/index.css
git commit -m "feat(web): glass utilities, near-solid cards, accent-coded pills"
```

---

## Task 4: AppShell — wash root + glass top bar

**Files:**
- Modify: `packages/web/src/components/AppShell.tsx`

- [ ] **Step 1: Make the root transparent so the body wash shows through**

In `AppShell()`, change the root `div` className from:

```tsx
<div className="min-h-screen bg-canvas text-ink flex flex-col">
```
to:
```tsx
<div className="min-h-screen text-ink flex flex-col">
```

- [ ] **Step 2: Convert the top bar to glass**

In `TopBar()`, change the `header` className from:

```tsx
<header className="border-b border-rule bg-white/60 backdrop-blur-sm sticky top-0 z-30">
```
to:
```tsx
<header className="glass-bar sticky top-0 z-30">
```

- [ ] **Step 3: Verify build + tests**

Run (from `packages/web`):
- `./node_modules/.bin/tsc --noEmit` → PASS
- `./node_modules/.bin/vitest run` → all PASS

- [ ] **Step 4: Commit**

```bash
git add packages/web/src/components/AppShell.tsx
git commit -m "feat(web): wash background + glass top bar in AppShell"
```

---

## Task 5: Clash sweep — dialogs & setup panels on glass

**Files:**
- Modify: `packages/web/src/components/NewDraftDialog.tsx` (and any sibling modal components found in `src/components`)
- Modify: `packages/web/src/components/draft/SetupDisclosure.tsx`

> **Goal of this task:** find floating surfaces that hardcode an opaque `bg-white`/`bg-card`/`bg-card-2` and would read as a flat white slab on the wash, and migrate the *outer floating container* to `.glass-card`. Do NOT glass-ify form fields, the prose card, or inline functional colors (e.g. the `VersionBanner` amber strip) — those stay solid for legibility.

- [ ] **Step 1: Inventory hardcoded surfaces**

Run (from repo root):

```bash
grep -rn "bg-white\|bg-card-2\|bg-card\b" packages/web/src/components
```

Expected: a list of components. The floating/modal **outer containers** in that list are the candidates (e.g. the dialog panel in `NewDraftDialog.tsx`). Inner inputs, the prose editor card, and small inline tints are NOT candidates.

- [ ] **Step 2: Migrate the dialog panel(s) to glass**

For each modal's outer panel container, replace the opaque surface class (e.g. `bg-white ... rounded-nb shadow-nb-pop`) with `glass-card` (drop the now-redundant `bg-white` and `shadow-*`; keep sizing/padding/`max-w-*`/`overflow` classes). Example transform:

```tsx
// before
<div className="bg-white rounded-nb shadow-nb-pop w-full max-w-lg p-6">
// after
<div className="glass-card w-full max-w-lg p-6">
```

Keep the modal **backdrop/overlay** (the dimmed full-screen layer) unchanged.

- [ ] **Step 3: Soften the SetupDisclosure inner panels if they clash**

In `SetupDisclosure.tsx`, the expanded `Setup` section sits inside an `nb-card` (now near-solid frosted — fine). Leave its `hover:bg-card-2` toggle and form fields as-is. Only change a surface here if Step 1 surfaced a hardcoded opaque slab that visibly clashes; otherwise make no change in this file and note it.

- [ ] **Step 4: Verify build + tests**

Run (from `packages/web`):
- `./node_modules/.bin/tsc --noEmit` → PASS
- `./node_modules/.bin/vitest run` → all PASS

- [ ] **Step 5: Commit**

```bash
git add packages/web/src
git commit -m "feat(web): migrate floating dialog surfaces to glass"
```

---

## Task 6: Visual verification pass

**Files:** none (verification only)

- [ ] **Step 1: Build the web bundle and serve**

Run the host serve script (serves API on host + builds web bundle into static):

```bash
./scripts/serve-host.sh
```

(Or `pnpm -C packages/web dev` for a live Vite server if the API is already up.)

- [ ] **Step 2: Walk the key screens and confirm legibility**

Visit each and confirm: the wash shows behind frosted chrome, no purple anywhere, accent colors read correctly, and **all text/inputs are crisp** (no smearing through glass):
- Login / auth
- Dashboard (draft list)
- Compose / draft editor — **the prose card is the critical legibility check**
- Your Voice
- Settings, Admin

- [ ] **Step 3: Regression spot-check**

Confirm these re-skinned via the cascade: status pills (ready=green, generating=amber, failed=coral, edited=blue), primary + ghost buttons, form focus rings, the logo gradient, range slider.

- [ ] **Step 4: Final commit (if any visual fixes were needed)**

```bash
git add packages/web
git commit -m "fix(web): visual-pass legibility tweaks"
```

---

## Self-Review Notes

- **Spec coverage:** §1 palette/tokens → Task 1; §2 glass system (variables, wash, utilities, near-solid card, accent helpers, pills/buttons, hex sweep) → Tasks 2–3; §3 typography unchanged (only hex sweep, covered in Task 2/3); §4 scope (AppShell + clash sweep) → Tasks 4–5; §5 verification → embedded per-task + Task 6.
- **No new tests** by design (style-only); existing suite must stay green — enforced in Tasks 3–5 verify steps.
- **Type consistency:** class names introduced (`.glass-bar`, `.glass-card`, `.accent-*`) are referenced consistently across Tasks 3–5. Token names (`cobalt`, `teal`, `amber`, `coral`, `green`, `leaf`, `rose`) defined in Task 1 and used thereafter.
