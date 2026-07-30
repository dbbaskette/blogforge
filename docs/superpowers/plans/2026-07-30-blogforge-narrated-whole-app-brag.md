# BlogForge Narrated Whole-App Film Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Produce a 40–45 second narrated BlogForge film that follows one article from raw material through content development, writing, voice shaping, human review, GEO, finishing, and deliberate publication.

**Architecture:** Preserve the approved 24-second Hyperframes project as a reference and create a timestamped sibling output. Build eight seek-safe scene sub-compositions under one master timeline, then synchronize their boundaries to one locally generated narration file while retaining the existing music and selected interface SFX.

**Tech Stack:** Hyperframes 0.7.84+, HTML/CSS, paused GSAP timelines, Kokoro local TTS, FFmpeg/ffprobe.

## Global Constraints

- Output directory: `brag-output-2026-07-30-122331/`.
- Landscape 1920 × 1080 at 30 fps.
- Final duration must be between 40 and 45 seconds.
- Use BlogForge's palette and Inter/Lora/JetBrains Mono typography.
- Humanization Check is transparent editorial guidance, not AI-authorship detection.
- GEO supports structure and retrievability without ranking or citation guarantees.
- Publication remains writer initiated.
- Preserve existing untracked `.pnpm-store/`, `brag-output/`, and `docs/superpowers/plans/2026-07-30-source-material-outline.md`.

---

### Task 1: Freeze the narrative and local audio

**Files:**
- Create: `brag-output-2026-07-30-122331/brag-plan.md`
- Create: `brag-output-2026-07-30-122331/composition-brief.md`
- Create: `brag-output-2026-07-30-122331/composition/SCRIPT.md`
- Create: `brag-output-2026-07-30-122331/composition/assets/audio/narration.wav`

**Interfaces:**
- Consumes: locked narration and storyboard from the design spec.
- Produces: one narration asset with an ffprobe-confirmed duration used by the master composition.

- [ ] **Step 1: Create the timestamped run from the prior composition's reusable fonts, music, SFX, and project configuration.**
- [ ] **Step 2: Write the Brag plan, composition brief, and locked script with all eight narrative beats.**
- [ ] **Step 3: Generate the narration with local Kokoro using a product-demo voice and natural speed.**
- [ ] **Step 4: Probe the waveform duration and adjust speed only if the read falls outside the 40–45 second target.**
- [ ] **Step 5: Listen to the narration for intelligibility, cadence, and obvious synthesis defects.**

### Task 2: Build the content-development journey

**Files:**
- Create: `brag-output-2026-07-30-122331/composition/compositions/01-hook.html`
- Create: `brag-output-2026-07-30-122331/composition/compositions/02-start.html`
- Create: `brag-output-2026-07-30-122331/composition/compositions/03-develop.html`
- Create: `brag-output-2026-07-30-122331/composition/compositions/04-draft.html`
- Create: matching `.motion.json` sidecars

**Interfaces:**
- Consumes: actual BlogForge starting-mode and stage labels.
- Produces: four sub-compositions that visually carry raw inputs into one coherent manuscript.

- [ ] **Step 1: Rebuild the hook around topic, outline, notes, and source material.**
- [ ] **Step 2: Reconstruct the full starting-mode picker with focus on the three development-oriented paths.**
- [ ] **Step 3: Animate Talk it through questions into a newly organized argument outline.**
- [ ] **Step 4: Animate Compose full draft into one connected manuscript with opening, argument, evidence, and conclusion.**
- [ ] **Step 5: Keep every scene deterministic with one paused registered timeline and no runtime clocks or network assets.**

### Task 3: Build voice, human review, GEO, and finishing

**Files:**
- Create: `brag-output-2026-07-30-122331/composition/compositions/05-voice.html`
- Create: `brag-output-2026-07-30-122331/composition/compositions/06-review.html`
- Create: `brag-output-2026-07-30-122331/composition/compositions/07-finish.html`
- Create: `brag-output-2026-07-30-122331/composition/compositions/08-outro.html`
- Create: matching `.motion.json` sidecars

**Interfaces:**
- Consumes: Voice Profile, inline edit, review, GEO, finish, export, and publish labels.
- Produces: four sub-compositions that complete the human-in-the-loop editorial journey.

- [ ] **Step 1: Show Voice Profile and one In my voice rewrite on a real manuscript passage.**
- [ ] **Step 2: Show one explainable Humanization Check finding and a writer-controlled Apply action.**
- [ ] **Step 3: Give GEO a settled panel for answer clarity, entity/context cues, and retrievability.**
- [ ] **Step 4: Show Proofreader, Fact-check, and Shape as related editorial checks without guarantees.**
- [ ] **Step 5: Finish with hero creation, Atomize all, export, deliberate GitHub publication, and the whole-product lockup.**

### Task 4: Assemble, synchronize, and mix

**Files:**
- Modify: `brag-output-2026-07-30-122331/composition/index.html`
- Modify: `brag-output-2026-07-30-122331/composition/index.motion.json`
- Modify: `brag-output-2026-07-30-122331/composition/ledger.json`

**Interfaces:**
- Consumes: eight scene compositions and the measured narration duration.
- Produces: one master timeline with scene transitions, narration, music ducking, and sparse SFX.

- [ ] **Step 1: Set scene boundaries to the narration's sentence cadence while keeping total duration within 40–45 seconds.**
- [ ] **Step 2: Mount each scene on one visual track with matching composition IDs and registered timelines.**
- [ ] **Step 3: Add framework-owned narration and music audio elements with music reduced beneath speech.**
- [ ] **Step 4: Retain only motion-matched SFX that do not compete with narration.**
- [ ] **Step 5: Update seam and motion assertions for the longer timeline.**

### Task 5: Verify the final look

**Files:**
- Create: `brag-output-2026-07-30-122331/composition/snapshots/`

**Interfaces:**
- Consumes: assembled master composition.
- Produces: passing automated checks and human-readable contact-sheet evidence.

- [ ] **Step 1: Probe and apply any required Hyperframes project-version upgrade, then run `npx hyperframes check`.**
- [ ] **Step 2: Capture scene midpoints and transition-adjacent snapshots.**
- [ ] **Step 3: Inspect the contact sheet for readability, clipping, missing media, black frames, and weak hierarchy.**
- [ ] **Step 4: Fix all persistent check findings and visible defects, then repeat the final check once.**
- [ ] **Step 5: Open the final Hyperframes preview and request render approval.**

### Task 6: Render and deliver

**Files:**
- Create: `brag-output-2026-07-30-122331/brag.mp4`
- Create: `brag-output-2026-07-30-122331/brag.jpg`
- Create: `brag-output-2026-07-30-122331/share-copy.txt`

**Interfaces:**
- Consumes: user-approved final preview.
- Produces: finished narrated film, poster, and share copy.

- [ ] **Step 1: Render the approved composition at high quality.**
- [ ] **Step 2: Verify resolution, frame rate, duration, video codec, and stereo audio with ffprobe.**
- [ ] **Step 3: Listen to the rendered mix and inspect a final contact sheet.**
- [ ] **Step 4: Select the strongest settled whole-product frame, export it as `brag.jpg`, and bake it into frame zero.**
- [ ] **Step 5: Write whole-product share copy and deliver the final assets.**

