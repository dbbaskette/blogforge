# Changelog

All notable changes to BlogForge are recorded here. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and the project uses
[Semantic Versioning](https://semver.org/spec/v2.0.0.html):

- **MAJOR** — breaking changes.
- **MINOR** — backwards-compatible features.
- **PATCH** — backwards-compatible bug fixes.

Bump the version with `scripts/version.sh <major|minor|patch>` (it moves the web
bundle and the API in lockstep). Pre-`1.0.0`, the API is still evolving.

## [Unreleased]

## [0.8.1] — 2026-07-17

### Added
- Generated hero graphics now publish beside their Markdown posts with portable relative references
  for Hugo, Jekyll, and plain Markdown repositories.

### Changed
- Posts with hero graphics are committed as one atomic GitHub change. Republishing verifies both
  stored blob revisions before updating, preventing BlogForge from overwriting remote edits.

## [0.8.0] — 2026-07-17

### Added
- **Per-user GitHub publishing** — each writer can configure one public or private content
  repository in Settings and publish a draft with a direct server-side commit.
- Fine-grained GitHub PATs are validated before storage, encrypted at rest, scoped to the current
  BlogForge user, replaceable/clearable, and never returned by the API.
- First publishes reject existing paths; republishes retain the original path and use the last
  confirmed content SHA so title changes cannot create duplicate posts or overwrite remote edits.
- The publish dialog now reports authoritative file and commit links plus actionable conflict,
  permission, token, and rate-limit recovery messages.

### Changed
- The browser-only GitHub new-file editor, clipboard fallback, and per-publish repository form were
  replaced by a saved Settings destination and one-click direct commit.

### Fixed
- Draft editors now receive their section content when each TipTap instance is
  created, preventing the intro and early sections from appearing blank until a
  browser refresh after React replaces an editor during the initial load.

## [0.3.0] — 2026-07-08

Editing, GEO, and voice improvements from real use of v0.2.0.

### Added
- **Fix-preview modal** — clicking **AI fix** on any GEO, Proofread, or Humanize
  finding now opens a side-by-side compare (original vs rewrite, word-level
  change highlighting) *before* anything is saved. Apply, Edit rewrite, or
  Cancel; nothing touches the draft until you Apply.
- **Eight new GEO levers** — stat attribution, follow-up-question coverage,
  liftable sound bites, entity-name consistency, first-hand experience
  (E-E-A-T), jargon defined on first use, worked examples, and title shape.
  Weights rebalanced to sum to 1.0.
- **GEO impact lines** — every finding now shows a concrete "GEO: …" line
  explaining what the change does for being quoted by an answer engine, and
  each lever header shows its point stakes ("up to N pts").
- **Source-aware citations** — the citations lever now sees the draft's
  attached references (and profile background sources) and, when a claim
  matches one, offers a one-click cite that splices the real markdown link in;
  only genuinely uncovered claims prompt for outside sourcing, naming the
  specific kind needed.
- **Voice fingerprint feeds composition** — the measured sentence-rhythm mix,
  signature phrases, and vocabulary now ride into every draft/humanize prompt;
  the distill pass extracts richer traits (opener style, transitions, opinion
  strength, anecdote frequency, humor).

### Changed
- The Humanize AI-fix flow is preview-first: applying from the modal resolves
  the finding in one step (no separate amber review), with Undo on the card.

### Fixed
- New "staccato paired-list run" AI tell — flags chopped-up "X and Y." sentence
  runs (and "As well as …" fragments) in Proofread and the anti-robot score.
- The citation splice and other model-generated link insertions are now
  `$`-safe (no `String.replace` substitution artifacts).
- Only the topmost dialog responds to Escape — the fix-preview modal no longer
  closes the review panel underneath it.

## [0.2.0] — 2026-07-08

First release cut under the new versioning workflow.

### Added
- **Humanize pass** — a review lens that rewrites robotic prose toward a human
  voice: 7 techniques as 4 lenses (Flow & Rhythm, De-robot/Soul, Voice & POV,
  Imperfections) with a Light/Medium/Strong intensity dial, guardrails, a
  unified "reads human" score, and four visualizations.
- **Persistent review sessions** — GEO, Shape, Humanize, and Checkup now save
  their findings *and* per-item accept/dismiss decisions, and reload them on
  reopen instead of silently re-running a paid scan. An "edited since scan"
  nudge offers a manual re-analyze when the draft has changed.
- **Manuscript design pass** — draft cards render as ruled manuscript leaves
  (margin gutter, marginalia), a hand-drawn hero underline, and a serif
  wordmark; command-palette keyboard a11y; stage-aware quick actions and
  whole-card navigation on the drafts list; an outline↔draft drift badge.
- Versioning system: `scripts/version.sh`, a `CHANGELOG.md`, and the UI badge
  now baked from `package.json` at build time so it can never drift.

### Changed
- Review/improve tools (GEO, Voice, lint, Humanize, Export, Checkup) are now
  available whenever a draft has composed content — not only on the Draft
  stage tab.
- Compose shows live per-section progress immediately instead of leaving the
  writer on a frozen outline.
- Large performance pass: code-split the review/editor overlays and the TipTap
  stack (main bundle 867 → 384 kB gzip), memoized section rendering and
  decorations, gated the humanness-pulse animation on visibility, cached
  style-pack reads, and parallelized per-section voice-rule enforcement.

### Fixed
- Humanize "AI fix" no longer silently does nothing when a finding's target has
  drifted from the draft — it applies via a whitespace-tolerant match, or
  surfaces a clear "re-analyze / Manual fix" message. Applied across the GEO
  and Proofread rails too.
- GEO "Undo" restores the prior score instantly instead of re-running a scan.
- Drafts-list search box no longer collapses; count copy agrees with the total.

## [0.1.0]

Initial BlogForge: idea → outline → single-pass compose, voice packs and the
"Your Voice" profile, GEO optimization, Proofreader, Shape assistant, section
version history, hero images, export, and GitHub-only auth.

[Unreleased]: https://github.com/dbbaskette/blogforge/compare/v0.8.1...HEAD
[0.8.1]: https://github.com/dbbaskette/blogforge/compare/v0.8.0...v0.8.1
[0.8.0]: https://github.com/dbbaskette/blogforge/compare/v0.7.2...v0.8.0
[0.2.0]: https://github.com/dbbaskette/blogforge/compare/v0.1.0...v0.2.0
[0.1.0]: https://github.com/dbbaskette/blogforge/releases/tag/v0.1.0
