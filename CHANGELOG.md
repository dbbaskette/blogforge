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

[Unreleased]: https://github.com/dbbaskette/blogforge/compare/v0.2.0...HEAD
[0.2.0]: https://github.com/dbbaskette/blogforge/compare/v0.1.0...v0.2.0
[0.1.0]: https://github.com/dbbaskette/blogforge/releases/tag/v0.1.0
