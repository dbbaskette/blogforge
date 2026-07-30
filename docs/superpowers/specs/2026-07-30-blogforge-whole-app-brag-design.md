# BlogForge Whole-App Launch Film Design

**Date:** July 30, 2026
**Status:** Approved concept, pending written-spec review
**Workflow:** `brag` with Hyperframes
**Output directory:** `brag-output-2026-07-30-105707/`

## Objective

Replace the existing source-material feature reel with a polished launch film about BlogForge as a complete writing environment.

The film must communicate that BlogForge is not a generate button. It is an end-to-end workshop that carries a writer from personal voice and source material through research, outlining, coherent drafting, editing, quality review, repurposing, and safe publication.

## Audience and Message

The primary audience is founders, practitioners, consultants, technical writers, and other people publishing substantive work under their own names.

The central message is:

> BlogForge combines AI leverage with the writer's voice, sources, rules, edits, and publishing decisions.

The film should leave viewers understanding three things:

1. BlogForge writes from a real voice profile rather than a generic prompt.
2. It supports the complete editorial journey, not just initial generation.
3. The writer retains visible control over revisions, checks, and publication.

## Creative Direction

### Concept: The Workshop Journey

The film follows one piece of writing through the whole product. Each scene is a distinct station in the same workshop, joined by continuous leftward motion and shared product elements.

The visual language remains faithful to BlogForge:

- pale blue, mint, and warm-paper canvas;
- cobalt and teal focal accents;
- Inter for interface copy;
- Lora for editorial headlines;
- JetBrains Mono for status and metadata;
- glass cards, manuscript surfaces, soft shadows, and rounded corners;
- actual product terminology and interface copy.

The tone is polished and editorial, with confident motion and no inflated SaaS claims.

## Runtime and Format

- Landscape, 1920 × 1080
- 24 seconds
- 30 frames per second
- Music and restrained interface sound effects
- No narration
- All important text must remain readable when paused
- Final MP4 must include a custom poster baked into frame zero

## Storyboard

### Scene 1 — A workshop, not a button

**Time:** 0.0–2.7 seconds
**Sustained-motion route:** staged reveal

The frame opens on a generic `Generate` button that produces a flat block of prose. The block is displaced by BlogForge's workshop stages and the hook:

> A generate button makes text. A workshop makes writing.

The BlogForge mark becomes the carrier into the next scene.

### Scene 2 — Start with your voice

**Time:** 2.7–6.4 seconds
**Sustained-motion route:** sequenced UI life

Reconstruct the **Your Voice** interface. Writing samples assemble into the real six-axis Voice Fingerprint:

- Casual
- Vivid
- Punchy
- Warm
- Concrete
- Direct

Signature phrases, sentence rhythm, and banished words appear around it. The **Try your voice** audition transitions a flat sentence from **Original** to **In your voice**.

Primary line:

> Your voice is an input, not an afterthought.

### Scene 3 — Begin wherever the work actually is

**Time:** 6.4–10.4 seconds
**Sustained-motion route:** cursor-led action and staged reveals

Show BlogForge's six real starting modes:

- Just write it
- Help me shape it
- I have an outline
- I have source material
- I already wrote it
- Blank page

The selected starting point moves into the real writing stages:

> Talk it through → Outline → Draft

Source links, notes, and outline cards assemble. A single coherent article surface replaces separate generated fragments.

Primary line:

> Research, outline, and one coherent draft.

### Scene 4 — Edit with the controls visible

**Time:** 10.4–16.2 seconds
**Sustained-motion route:** sequenced UI life

Show the manuscript editor with one realistic article. Selected text exposes inline AI actions while section history and tracked changes remain visible.

The review tools enter as actionable rails, using real product labels:

- Proofreader
- Humanization Check
- Fact-check
- GEO
- Shape
- Version history

One finding opens a side-by-side fix preview. The writer applies it, the corresponding rule clears, and **All changes saved** remains visible.

Primary line:

> Suggestions are visible. Decisions stay yours.

### Scene 5 — One article, finished and distributed

**Time:** 16.2–21.0 seconds
**Sustained-motion route:** animated sequence

The edited manuscript becomes a publish-ready article preview with a hero image. **Atomize all** fans the article into channel-specific cards:

- X thread
- LinkedIn
- Newsletter
- TL;DR
- SEO meta

The outputs collapse into export and publishing actions:

- Markdown
- HTML
- Word
- Publish to GitHub

The GitHub result resolves to:

> Published to GitHub ✓

This is presented as an initiated, guarded publishing action, not autonomous publishing.

### Scene 6 — Brand close

**Time:** 21.0–24.0 seconds
**Sustained-motion route:** staged reveal with final hold

The outputs file into one BlogForge manuscript card. The brand lockup lands with:

> Your voice. One coherent argument. Ready to publish.

Supporting line:

> A workshop for long-form writing.

The final frame holds long enough to serve as the poster.

## Motion and Seams

The film's dominant current is leftward. Scene exits and entries use matched leftward motion with cuts landing while both sides remain in flight.

The BlogForge mark, selected draft card, manuscript surface, and publish artifact act as concrete seam carriers. No crossfades are used between primary scenes.

The major review-to-result transition includes a short dramatic pause before the applied fix clears. The final brand close rises slightly upward to mark resolution.

The implementation will include a vector ledger and pass the Hyperframes seam verifier before final rendering.

## Audio

Use a polished upbeat instrumental from the Brag asset library. Music cues should support:

- the hook displacement;
- Voice Fingerprint completion;
- the move from starting modes into the draft;
- review tools resolving;
- **Atomize all**;
- the final brand lockup.

Interface sounds should be restrained:

- one cursor click;
- one soft completion impact;
- one clean publish confirmation;
- one final brand chime.

Music remains below the interface cues and fades cleanly during the final 0.75 seconds.

## Composition Architecture

The output will be a Hyperframes project inside:

`brag-output-2026-07-30-105707/composition/`

The project will use:

- one master index composition;
- scene-level sub-compositions to keep each interface state isolated;
- a shared full-frame background;
- one paused, seek-safe GSAP timeline per composition;
- framework-owned audio elements;
- a motion-assertion sidecar;
- a seam vector ledger;
- bundled local font and sound assets.

Each scene owns its internal product reconstruction and motion. The master composition owns scene timing, carrier motion, transitions, and audio placement.

## Product Fidelity Rules

- Use only features supported by the current code and project brief.
- Do not present the Humanization Check as AI-authorship detection.
- Do not claim factual accuracy is guaranteed.
- Do not depict publishing as autonomous.
- Do not imply adoption, performance results, or time savings.
- Use real BlogForge labels wherever interface copy is visible.
- The source-material feature may appear as one of the six starting modes, but it must not dominate the film.

## Validation and Acceptance

The film is complete when:

1. The six storyboard scenes total exactly 24 seconds.
2. Voice, compose stages, editing/review, repurposing, export, and publishing are all represented.
3. At least four scenes visibly reconstruct actual BlogForge interface states.
4. No single feature occupies more than one main scene.
5. Hyperframes lint reports no errors.
6. Hyperframes check reports zero runtime, layout, motion, and contrast errors.
7. The seam verifier exits successfully for every scene boundary.
8. Key snapshots show readable, settled product states and clean transitions.
9. The final MP4 is 1920 × 1080, 30 fps, 720 frames, exactly 24 seconds, with stereo audio.
10. The chosen full-product frame is exported as `brag.jpg` and baked into frame zero.
11. `share-copy.txt` describes BlogForge as a whole product rather than highlighting only source-material outlining.

## Deliverables

- `brag.mp4`
- `brag.jpg`
- `brag-plan.md`
- `composition-brief.md`
- `share-copy.txt`
- editable Hyperframes composition and verification artifacts
