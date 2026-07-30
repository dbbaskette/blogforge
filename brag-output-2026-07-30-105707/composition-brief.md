# Hyperframes Composition Brief: BlogForge

## Objective
Create a polished 24-second launch film for the whole BlogForge product: a voice-to-publication workshop, not a single-feature demo.

## Output
- Composition directory: `brag-output-2026-07-30-105707/composition/`
- Rendered video: `brag-output-2026-07-30-105707/brag.mp4`
- Format: landscape — 1920×1080
- Duration: 24 seconds

## Source Material
- Project root: `/Users/dbbaskette/Projects/BlogForge`
- Shipped app source: `.worktrees/source-material-outline/packages/web/src/`
- Primary product surfaces: AppShell, ModePicker, VoicePage, VoiceFingerprint, VoiceAudition, StageNav, DraftWorkspace, RepurposePanel
- Product name: BlogForge
- Strongest claim: “A workshop for long-form writing — that sounds like you, not a language model.”
- UI to reconstruct: Voice Fingerprint, six starting modes, Talk it through / Outline / Draft, manuscript editor and review rail, repurpose/export/GitHub publish

## Copy that must appear verbatim
- A generate button makes text. A workshop makes writing.
- Your voice is an input, not an afterthought.
- Talk it through
- Outline
- Draft
- All changes saved
- Proofreader
- Humanization Check
- Fact-check
- GEO
- Shape
- Version history
- Suggestions are visible. Decisions stay yours.
- Atomize all
- Publish to GitHub
- Published to GitHub ✓
- Your voice. One coherent argument. Ready to publish.
- A workshop for long-form writing
- BlogForge v0.10

## Creative Direction
- Tone preset: polished
- Direction: The Workshop Journey
- Angle: show a single connected craft loop from voice and source material to a finished, intentionally distributed article
- Hook: distinguish generated text from a writing workshop
- Outro: resolve all product artifacts into one whole-product lockup
- Avoid generic SaaS language, abstract filler, AI-authorship detection claims, factual guarantees, autonomous publishing, and performance/adoption claims

## Visual Identity
- Canvas: `#e6efff`, `#e3f7f4`, `#fff4e0`
- Text: `#15224a`
- Accent: `#2f6bff`, `#16c2b3`
- UI font: Inter
- Editorial font: Lora
- Metadata font: JetBrains Mono
- Surfaces: glass-white panels, precise one-pixel borders, small cobalt/teal rules, dark navy editorial type

## Storyboard Contract
Use `brag-plan.md` exactly. Scene boundaries: `0`, `2.7`, `6.4`, `10.4`, `16.2`, `21`, `24`.

## Motion Contract
- Dominant current: leftward
- Five primary seams: cut mid-motion with matching axis and direction
- No primary crossfades
- Sustained routes: staged reveals, sequenced UI life, and cursor-led action
- Final internal resolution may rise after the 21-second leftward boundary
- All GSAP timelines paused, synchronous, deterministic, and registered to matching composition IDs

## Audio Contract
- Music: bundled vol-12 track and matching cue preset
- SFX: click at 2.52s, soft impact at 10.4s, card fan/publish confirmation around 20.35s, final chime at 22.4s
- Keep the music below dialogue-equivalent text attention; no narration

## Delivery
Run the full Hyperframes check with snapshots, inspect key frames, prove the final lockup and seams, render high quality, select a settled whole-product poster, bake it into frame zero, and verify MP4 metadata.
