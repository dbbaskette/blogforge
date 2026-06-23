# BlogForge UX Improvements — batch plan

Source: the 18-item UX review (compose, draft editor, voice/onboarding/settings, cross-cutting). Each batch is one shippable PR (tests green + deployed) before the next starts.

## Batch 1 — Navigation & quick wins ✅ (PR pending)
- [x] #9 Top-nav **Drafts** + primary **Compose** links with active highlighting (`AppShell.tsx`, `index.css` aria-current)
- [x] #3 `KeysBanner` → Settings → Provider API keys (drop removed `/admin` + "ask an admin"); already Tanzu-aware
- [x] #5 Login recourse copy (`not_allowed`/`github_not_configured`) + hide the dead retry button when unconfigured
- [x] #14 Global `prefers-reduced-motion` opt-out

## Batch 2 — Shared primitives (foundation for later batches)
- [ ] #15 `ConfirmDialog` (wire the orphaned `DeleteDraftDialog`), `.nb-btn-danger`, shared `ErrorBanner`; replace native `confirm()` (Drafts/Trash/Settings/Voice)
- [ ] #7 toast/notification context + `ErrorBoundary` + global 401 handling in `api/client.ts`
- [ ] #13 modal primitive (focus trap, `aria-modal`, Escape, restore focus) applied to dialogs + side panels; mode picker as radiogroup

## Batch 3 — Data-loss & save model (critical)
- [ ] #1 section editor dirty-tracking + autosave + `beforeunload` guard; honest global "saved" indicator (`MarkdownEditor`, `DraftWorkspace`)

## Batch 4 — Onboarding & first-run
- [ ] #2 first-run setup checklist on Drafts (key/Tanzu → voice → first piece)
- [ ] #4 pre-flight provider/model guard in compose (disable run + inline hint)
- [ ] #12 Distill clarity + confirm-before-overwrite of hand edits
- [ ] #17 voice concepts: explain "exemplar", single persona save model, key validation feedback

## Batch 5 — Generation feedback & recovery
- [ ] #6 long-op feedback (elapsed/cancel) for hero/repurpose/fact-check/distill; honest express busy labels
- [ ] #8 bulk-compose partial-failure recovery ("compose remaining")
- [ ] #11 `propose` mode actually generates an outline (or merge with blank)

## Batch 6 — Lists, discoverability & polish
- [ ] #16 Drafts list: sort control + per-draft voice pill + SSE auto-reconnect
- [ ] #10 persistent tools affordance (inline AI / repurpose / headline lab discoverability)
- [ ] loading skeletons on list/settings/admin routes; compose cost/length summary surfaced

## Batch 7 — Docs & smaller wins
- [ ] #18 README rewrite (GitHub OAuth + per-user keys; drop email/password + `/admin` keys)
- [ ] `Template.provider` type widened to include `tanzu`/`claude-cli`; topic/title label consistency; section-reorder optimistic UI + surfaced errors

## Queued (separate, pre-approved)
- [ ] Built-in **Blog post** format, default in voice-profile mode (`voice/pack.py` materialize + compose defaults)
