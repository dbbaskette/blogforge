# BlogForge UX Improvements — batch plan

Source: the 18-item UX review (compose, draft editor, voice/onboarding/settings, cross-cutting). Each batch is one shippable PR (tests green + deployed) before the next starts.

## Batch 1 — Navigation & quick wins ✅ (PR pending)
- [x] #9 Top-nav **Drafts** + primary **Compose** links with active highlighting (`AppShell.tsx`, `index.css` aria-current)
- [x] #3 `KeysBanner` → Settings → Provider API keys (drop removed `/admin` + "ask an admin"); already Tanzu-aware
- [x] #5 Login recourse copy (`not_allowed`/`github_not_configured`) + hide the dead retry button when unconfigured
- [x] #14 Global `prefers-reduced-motion` opt-out

## Batch 2 — Shared primitives (foundation for later batches)
- [x] #15 `ConfirmDialog` + `useConfirm` (promise-based, focus-trapped); `.nb-btn-danger`; replaced native `confirm()` (Drafts/Trash/Settings/SamplesList/SourcesCard); retired orphaned `DeleteDraftDialog`. (2a)
- [x] #7 `ErrorBoundary` at root + global 401 handling in `api/client.ts`. (2a) — *toast/notification context deferred to a later batch where success feedback is wired (5/6).*
- [x] #13 `useDialogA11y` (focus trap + Escape + restore focus) applied to RepurposePanel/HeadlineLab/LintPanel; ModePicker → radiogroup. (2b)
- [ ] *Deferred:* shared `ErrorBanner` + dedup of the per-screen red banners → folded into Batch 6 polish.

## Batch 3 — Data-loss & save model (critical) ✅
- [x] #1 `MarkdownEditor` rewritten: debounced **autosave** + **guard** (never clobbers unsaved edits; ignores the save echo) + per-section save status + `beforeunload`; Save button retired. Inline-AI edits now persist (they autosave). Backend `save_section` gains `create_version` (autosave passes false after the first session save → no version-history spam). Tests: web autosave/guard + backend create_version.
- [x] **3b restore prior version** — *already built* (`SectionVersionHistory` + `onRevert` + `revert_section_version`, behind the per-section **History** link). Surfacing it better folds into Batch 6 discoverability.

## Batch 4 — Onboarding & first-run ✅
- [x] #2 dismissible first-run checklist on Drafts (provider/Tanzu → voice → first piece), driven by provider availability + voice-profile state
- [x] #4 pre-flight provider/model guard in compose (run buttons disabled + inline "add a key / pick under Advanced" notice; chosen provider·model shown even when Advanced collapsed)
- [x] #12 Distill: clearer explainer, confirm-before-overwrite (useConfirm), "Reading your samples…" busy state, no-key hint → Settings
- [x] #17 voice concepts: exemplar helper line; single persona save model (blur-save + persistent dirty/saved status, redundant button removed); provider-key validation (Valid ✓ / Key rejected) + per-provider "what it powers" note feedback

## Batch 5 — Generation feedback & recovery ✅
- [x] #6 elapsed-time counter on the slow ops (hero/repurpose/fact-check/distill) via `useElapsed`, + "~20–30s" hint on hero. (Request *cancel* deferred — needs AbortSignal plumbing through `api()`.)
- [x] #8 bulk-compose partial-failure recovery: failure banner now summarizes "Composed N of M, then failed" + a "Compose remaining →" button (reuses the existing only-unfilled `expandSections` path).
- [x] #11 `propose` mode now generates the outline (`generateOutline` already advances stage→outline) so it lands on the Outline stage to tweak — fulfilling its promise instead of duplicating Blank.

## Batch 6 — Lists, discoverability & polish ✅
- [x] #16 Drafts list **sort** (Recently updated / Title A–Z / Most words); **SSE auto-reconnect** (backoff + refresh on tab refocus) instead of dying on the first blip. (Per-draft voice pill deferred — needs a backend `DraftSummary` field.)
- [x] #10 tools discoverability: labeled **Draft tools** bar (Headlines/Repurpose/Copy/Review/Download) with the Headline lab now reachable from the sections workspace; one-time dismissible inline-AI hint.
- [x] **Toast system** (deferred #7): `ToastProvider` + `useToast` (graceful no-op without provider), wired success toasts on key save/remove, sign-out-everywhere, and admin approve/role actions.
- [ ] *Deferred:* loading skeletons + compose cost/length summary + ErrorBanner dedup → Batch 7 / future polish.

## Batch 7 — Docs & smaller wins
- [ ] #18 README rewrite (GitHub OAuth + per-user keys; drop email/password + `/admin` keys)
- [ ] `Template.provider` type widened to include `tanzu`/`claude-cli`; topic/title label consistency; section-reorder optimistic UI + surfaced errors

## Queued (separate, pre-approved)
- [ ] Built-in **Blog post** format, default in voice-profile mode (`voice/pack.py` materialize + compose defaults)
