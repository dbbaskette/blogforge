# Liquid-Glass UI Overhaul — Design Spec

**Date:** 2026-06-16
**Status:** Approved (design), pending implementation plan
**Scope:** Visual re-skin of the BlogForge web app (`packages/web`). Style-only — no layout, IA, copy, or logic changes.

## Goal

Replace the current flat "Notebook" theme (cobalt accent on a flat `#f6f7f9` canvas) with a **vibrant liquid-glass** aesthetic, direction **A2**:

- A cool **blue→teal wash** behind the app, with warm amber/coral accents for contrast.
- **Frosted-glass chrome** (top bar, floating panels, tool cards).
- **Bold primary palette** (no purple): cobalt blue anchor + teal / amber / coral / green accents, color-coded to functions.
- **Prose/content surfaces stay near-solid** so long-form text remains crisp and legible — this is the core readability guardrail.

This is a writing app: glass belongs on the chrome, never behind the prose.

## Approach

**In-place token + class overhaul.** The design system is centralized in two files — `tailwind.config.ts` (design tokens) and `src/index.css` (`nb-*` component classes + `.prose-body`). Every component consumes those tokens/classes, so re-skinning these two files cascades through the whole app with near-zero component churn.

Rejected alternatives:
- *Componentized glass classes* — migrate each component to new semantic classes. Much more churn for no gain when `nb-*` already centralizes everything.
- *Full CSS-variable theme-system refactor* — overkill now. This spec still introduces CSS variables for the key glass/wash values, leaving the door open to a dark mode later without paying the upfront cost.

## 1 · Palette & tokens (`tailwind.config.ts`)

### Retune the `cobalt` scale (keep the name)
Keeping the `cobalt-*` token name means every existing utility class (`bg-cobalt-500`, `text-cobalt-700`, `shadow-nb-cobalt`, the logo gradient, focus rings, etc.) re-skins automatically. Retune values toward the electric blue `#2f6bff`:

| Token | From | To |
|---|---|---|
| `cobalt.DEFAULT` / `500` | `#4f6df0` | `#2f6bff` |
| `cobalt.50` | `#eaeefe` | `#eaf0ff` |
| `cobalt.100` | `#d5dcfc` | `#d6e2ff` |
| `cobalt.200` | `#aebbfa` | `#acc4ff` |
| `cobalt.300` | `#8094f6` | `#7aa0ff` |
| `cobalt.400` | `#5b76f2` | `#4d82ff` |
| `cobalt.600` | `#3a55d8` | `#1f54e6` |
| `cobalt.700` | `#2b40a8` | `#1741b8` |
| `cobalt.800` | `#1e2d76` | `#102e85` |
| `cobalt.900` | `#121a45` | `#0a1c54` |

(Exact intermediate stops are the implementer's to tune for a smooth ramp; the anchor `500 = #2f6bff` and a darker, more saturated `700` for hover/active are the requirements.)

### Add accent scales (semantic, color-coded)
Add four accent colors, each with `DEFAULT` + a `soft` tint for chip backgrounds (mirroring the existing `leaf`/`amber`/`rose` pattern). Keep `amber` but retune. **Keep `leaf` and `rose` as aliases** pointing at the new `green`/`coral` values so existing `bg-leaf-soft` / `text-rose-ink` usages keep working without a className sweep — they can be migrated opportunistically, not as a blocking step.

| Token | DEFAULT | soft | Function |
|---|---|---|---|
| `teal` | `#16c2b3` | `#dff7f4` | repurpose, hero image, info |
| `amber` | `#f59e0b` | `#fbf1de` | voice profile, warnings, "generating" |
| `coral` | `#e6492d` | `#fde7e2` | fact-check, destructive/failed |
| `green` | `#15a06b` | `#e3f5ec` | proofreader, "ready"/clean, success |

Provide a `.ink` deep value for accent text where needed (e.g. `coral.ink #b5321b`, `amber.ink #92600a`, `green.ink #0e7a50`) so tinted chips have accessible text contrast.

### Ink & neutrals
- `ink.DEFAULT`: `#1f2328` → `#15224a` (deep blue-slate, warmer against the wash).
- `ink.2`: keep `#3a3f47` (prose body) — already legible on near-solid cards.
- `muted`, `rule`, `card`, `card-2`: unchanged.
- `canvas`: keep `#f6f7f9` as a **solid fallback** (used if the wash gradient can't render).

### Glass shadows
Add soft, slightly blue-tinted floating shadows for chrome, alongside the existing crisp `nb` shadows for content:
- `shadow-glass`: `0 4px 16px -8px rgba(30, 60, 110, 0.22)`
- `shadow-glass-lg`: `0 8px 28px -10px rgba(30, 60, 110, 0.28)`
- Retune `shadow-nb-cobalt` to the new blue (`rgba(47,107,255,…)`).

## 2 · Glass system (`src/index.css`)

### CSS variables (top of file, `:root`)
Centralize the tunable values so future theming is a variable swap:

```css
:root {
  --wash-1: #e6efff;   /* blue tint   */
  --wash-2: #e3f7f4;   /* teal tint   */
  --wash-3: #fff4e0;   /* warm amber tint */
  --glass-bg: rgba(255, 255, 255, 0.55);
  --glass-bg-card: rgba(255, 255, 255, 0.65);
  --glass-border: rgba(255, 255, 255, 0.75);
  --glass-blur: 14px;
  --content-bg: rgba(255, 255, 255, 0.90); /* near-solid for prose/content */
}
```

### App background wash
Replace the flat `body { background-color: #f6f7f9 }` with a **fixed cool wash**:

```css
body {
  background: linear-gradient(135deg, var(--wash-1) 0%, var(--wash-2) 55%, var(--wash-3) 100%);
  background-attachment: fixed;
  color: #15224a;
}
```

`AppShell`'s root currently sets `bg-canvas`; change it to be transparent (let the `body` wash show through) or to a `.app-wash` helper. The wash must sit behind everything and not scroll.

### Glass utilities (new component classes)
- **`.glass-bar`** — sticky top nav / chrome. `background: var(--glass-bg)`, `backdrop-filter: blur(var(--glass-blur))` (+ `-webkit-` prefix), `border-bottom: 1px solid var(--glass-border)`, `shadow-glass`. Replaces the inline `bg-white/60 backdrop-blur-sm` in `AppShell.tsx`'s `TopBar`.
- **`.glass-card`** — floating side panels, tool cards, dialogs. `background: var(--glass-bg-card)`, medium blur, `1px solid var(--glass-border)`, `shadow-glass`.
- **`nb-card` (content/prose) → near-solid frosted.** `background: var(--content-bg)`, light blur (≤6px) so text underneath the glass never smears. Keep the `1px` border + crisp `nb` shadow. **This is the readability guardrail.**

### Accent helpers (color-coded chrome)
Add `.accent-{teal,amber,coral,green,blue}` modifiers that apply a colored left-or-top border + matching `*-soft` tint, for tool cards / panels to be readable at a glance per the function mapping above. Update the existing `.nb-pill-*` status pills to the new accent tokens (`ready`→green, `gen`→amber, `failed`→coral, `edited`→cobalt).

### Buttons & controls
- `.nb-btn-primary`: background `#2f6bff`, hover `cobalt-700`, shadow retuned to the new blue. (Cascades from the token retune; verify the hardcoded hex in `index.css` is updated too.)
- Focus ring (`:focus-visible`, input focus `box-shadow`), `::selection`, and `input[type=range] { accent-color }` — update the hardcoded `#4f6df0` / `rgba(79,109,240,…)` occurrences to the new blue.
- Form controls (`.nb-input/.nb-select/.nb-textarea`): keep near-solid white (they hold user input — legibility first). Optionally a subtle glass treatment on their containers, not the fields themselves.

## 3 · Typography (unchanged)

Keep **Inter** (UI) and **Lora** (`.prose-body`). A serif body suits a long-form writing tool and stays fully legible on the near-solid content card. Update only the hardcoded accent hexes inside `.prose-body` (link color `#4f6df0` → new blue; `code` color `#2b40a8` → new `cobalt-700`).

## 4 · Scope & files

**Primary edits (the bulk of the work):**
- `packages/web/tailwind.config.ts` — token retune + new accent scales + glass shadows.
- `packages/web/src/index.css` — CSS variables, wash, glass utilities, accent helpers, retuned `nb-*` classes, hardcoded-hex sweep.

**Light component touch-ups (no logic/structure changes):**
- `src/components/AppShell.tsx` — root bg → wash (transparent root); `TopBar` `header` → `.glass-bar`.
- A targeted pass over components with **hardcoded `bg-white` / inline colors** that would clash on glass — dialogs (`NewDraftDialog.tsx` and other modals), `SetupDisclosure.tsx` panels (`bg-card`/`bg-card-2`). Migrate clashing surfaces to `.glass-card` or the new accent helpers; leave functional inline colors (e.g. the `VersionBanner` amber warning) as-is unless they clash.

**Out of scope:**
- Dark mode (deferred; the CSS variables leave the door open).
- Any layout / information-architecture / wizard-flow change (that is sub-project B).
- Copy changes.
- Backend (`packages/api`) — untouched.

## 5 · Testing & verification

- **`tsc` typecheck** clean.
- **`vitest`** — the existing web test suite (≈76 tests) stays green. This is a style-only change; no test should need to change. If a snapshot/className assertion breaks, that's a signal to review, not to blindly update.
- **Manual visual pass** across the key screens to confirm legibility and that no text renders unreadable on glass:
  - Login / auth
  - Dashboard (draft list)
  - Compose / draft editor (the prose card — the critical legibility check)
  - Your Voice
  - Settings, Admin
- **Regression check:** status pills, primary/ghost buttons, form focus states, and the logo all re-skin correctly via the token cascade.

## Success criteria

1. App shows the cool blue→teal→amber wash behind frosted-glass chrome; no purple anywhere.
2. Palette is the cobalt-blue anchor + teal/amber/coral/green accents, color-coded to functions.
3. Prose and form inputs remain crisp and fully legible (near-solid surfaces).
4. No component churn beyond the targeted touch-up list; all existing tests green.
5. Glass/wash values live in CSS variables + Tailwind tokens (one place to tune, dark-mode-ready).
