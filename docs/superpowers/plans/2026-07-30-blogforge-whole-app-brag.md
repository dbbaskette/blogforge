# BlogForge Whole-App Launch Film Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build and deliver a polished 24-second launch film that presents BlogForge as a complete voice-to-publication writing workshop.

**Architecture:** Create a timestamped Hyperframes project with one master composition and six scene-level sub-compositions. Each scene reconstructs a real BlogForge product state and owns its internal seek-safe GSAP timeline; the master owns scene timing, seam carriers, audio, and the continuous background.

**Tech Stack:** Hyperframes 0.7.84 or current compatible release, HTML/CSS, GSAP 3.14, FFmpeg, local Inter/Lora/JetBrains Mono fonts, bundled Brag music and sound effects.

## Global Constraints

- Output directory is `brag-output-2026-07-30-105707/`.
- Video is exactly 24 seconds, 1920 × 1080, 30 fps, with stereo audio.
- Use BlogForge's actual product vocabulary and supported features only.
- Use `#2f6bff` cobalt, `#16c2b3` teal, `#15224a` ink, and the pale blue/mint/warm-paper canvas.
- Do not present Humanization Check as AI-authorship detection.
- Do not claim factual accuracy is guaranteed.
- Do not depict publishing as autonomous.
- Do not claim adoption, performance results, or time savings.
- The source-material compose mode is one of six entry paths and must not dominate the film.
- Use one dominant leftward seam current; the final resolution may rise upward.
- No crossfades between primary scenes.
- All animation timelines are synchronous, paused, deterministic, and registered by composition ID.
- Hyperframes check must report zero runtime, layout, motion, and contrast errors.
- The final poster is a settled whole-product frame and is baked into frame zero of the MP4.

---

## File Map

- Create `brag-output-2026-07-30-105707/brag-plan.md` — Brag rubric, creative direction, timings, transitions, audio cues, and poster choice.
- Create `brag-output-2026-07-30-105707/composition-brief.md` — focused Hyperframes handoff.
- Create `brag-output-2026-07-30-105707/composition/frame.md` — frame-scale BlogForge design tokens and motion constraints.
- Create `brag-output-2026-07-30-105707/composition/index.html` — master timeline, shared background, scene hosts, carriers, and audio.
- Create `brag-output-2026-07-30-105707/composition/ledger.json` — five seam vectors and carrier selectors.
- Create `brag-output-2026-07-30-105707/composition/index.motion.json` — master motion assertions.
- Create `brag-output-2026-07-30-105707/composition/compositions/01-hook.html` — generate-button displacement and workshop hook.
- Create `brag-output-2026-07-30-105707/composition/compositions/02-voice.html` — Voice Fingerprint and audition.
- Create `brag-output-2026-07-30-105707/composition/compositions/03-compose.html` — six starting modes and three writing stages.
- Create `brag-output-2026-07-30-105707/composition/compositions/04-edit.html` — manuscript editor, review tools, tracked fix.
- Create `brag-output-2026-07-30-105707/composition/compositions/05-finish.html` — preview, Atomize all, export, and GitHub publishing.
- Create `brag-output-2026-07-30-105707/composition/compositions/06-outro.html` — complete product lockup.
- Create one `*.motion.json` sidecar beside each scene composition.
- Create `brag-output-2026-07-30-105707/composition/assets/fonts/` — three bundled variable fonts.
- Create `brag-output-2026-07-30-105707/composition/assets/music/` — Brag music and cue metadata.
- Create `brag-output-2026-07-30-105707/composition/assets/sfx/` — click, soft impact, publish confirmation, and final chime.
- Create `brag-output-2026-07-30-105707/brag.mp4` — final rendered and poster-baked film.
- Create `brag-output-2026-07-30-105707/brag.jpg` — best settled whole-product frame.
- Create `brag-output-2026-07-30-105707/share-copy.txt` — one canonical whole-product caption.

---

### Task 1: Scaffold the Timestamped Brag Project and Lock the Storyboard

**Files:**
- Create: `brag-output-2026-07-30-105707/brag-plan.md`
- Create: `brag-output-2026-07-30-105707/composition-brief.md`
- Create: `brag-output-2026-07-30-105707/composition/frame.md`
- Create: `brag-output-2026-07-30-105707/composition/hyperframes.json`
- Create: `brag-output-2026-07-30-105707/composition/package.json`
- Create: `brag-output-2026-07-30-105707/composition/meta.json`
- Create: `brag-output-2026-07-30-105707/composition/assets/**`

**Interfaces:**
- Consumes: approved design in `docs/superpowers/specs/2026-07-30-blogforge-whole-app-brag-design.md`
- Produces: exact scene timing constants `0`, `2.7`, `6.4`, `10.4`, `16.2`, `21`, and `24`; shared palette and typography; local media paths used by every later task

- [ ] **Step 1: Scaffold the Hyperframes project**

Run:

```bash
mkdir -p brag-output-2026-07-30-105707
cd brag-output-2026-07-30-105707
HYPERFRAMES_SKIP_SKILLS=1 npx --yes hyperframes init composition \
  --non-interactive --example blank --resolution landscape --skill=brag
```

Expected: `composition/index.html`, `hyperframes.json`, `package.json`, and `meta.json` exist.

- [ ] **Step 2: Write the Brag plan**

Write the six scenes with these exact durations:

```text
01 Hook       0.0–2.7   2.7s
02 Voice      2.7–6.4   3.7s
03 Compose    6.4–10.4  4.0s
04 Edit       10.4–16.2 5.8s
05 Finish     16.2–21.0 4.8s
06 Outro      21.0–24.0 3.0s
Total                    24.0s
```

The plan must answer all nine Brag rubric questions and identify scene 5 at approximately `20.2s` as the initial poster candidate because it shows the article plus its channel and publishing outputs.

- [ ] **Step 3: Write the composition brief and frame design**

The brief must state the whole-product message and the exact product surfaces reconstructed in each scene. `frame.md` must declare:

```yaml
colors:
  canvas_blue: "#e6efff"
  canvas_mint: "#e3f7f4"
  canvas_warm: "#fff4e0"
  ink: "#15224a"
  cobalt: "#2f6bff"
  teal: "#16c2b3"
typography:
  ui: "Inter"
  editorial: "Lora"
  metadata: "JetBrains Mono"
```

- [ ] **Step 4: Stage local media**

Copy the three open-source font files and the selected Brag audio assets into `composition/assets/`. Use one music track for the full 24 seconds and four short sound effects at approximately `2.52`, `10.4`, `20.35`, and `22.4` seconds.

- [ ] **Step 5: Verify the scaffold**

Run:

```bash
test -s brag-output-2026-07-30-105707/brag-plan.md
test -s brag-output-2026-07-30-105707/composition-brief.md
test -s brag-output-2026-07-30-105707/composition/frame.md
test -s brag-output-2026-07-30-105707/composition/assets/fonts/Inter-Variable.ttf
```

Expected: every command exits `0`; the storyboard durations sum to `24.0`.

- [ ] **Step 6: Commit**

```bash
git add brag-output-2026-07-30-105707/brag-plan.md \
  brag-output-2026-07-30-105707/composition-brief.md \
  brag-output-2026-07-30-105707/composition
git commit -m "feat: scaffold whole-app BlogForge launch film"
```

---

### Task 2: Build the Hook, Voice, and Compose Scenes

**Files:**
- Create: `brag-output-2026-07-30-105707/composition/compositions/01-hook.html`
- Create: `brag-output-2026-07-30-105707/composition/compositions/01-hook.motion.json`
- Create: `brag-output-2026-07-30-105707/composition/compositions/02-voice.html`
- Create: `brag-output-2026-07-30-105707/composition/compositions/02-voice.motion.json`
- Create: `brag-output-2026-07-30-105707/composition/compositions/03-compose.html`
- Create: `brag-output-2026-07-30-105707/composition/compositions/03-compose.motion.json`

**Interfaces:**
- Consumes: `frame.md` tokens and scene durations from Task 1
- Produces: composition IDs `scene-hook`, `scene-voice`, and `scene-compose`; carrier IDs `#hook-mark`, `#voice-mark`, and `#draft-carrier`

- [ ] **Step 1: Create the hook scene contract**

Use this composition root:

```html
<template>
  <section
    id="root"
    data-composition-id="scene-hook"
    data-start="0"
    data-duration="2.7"
    data-width="1920"
    data-height="1080"
  >
    <div class="scene-fill"></div>
    <div id="generic-generate">Generate</div>
    <article id="flat-prose">A generic block of generated prose…</article>
    <h1 id="hook-copy">A generate button makes text. A workshop makes writing.</h1>
    <div id="hook-mark">B</div>
  </section>
</template>
```

The flat prose exits left under pressure from the BlogForge stage rail. The hook settles by `0.95s`, holds, and starts its leftward seam travel at `2.38s`.

- [ ] **Step 2: Add hook motion assertions**

```json
{
  "duration": 2.7,
  "assertions": [
    {"kind":"appearsBy","selector":"#hook-copy","bySec":0.95},
    {"kind":"before","a":"#generic-generate","b":"#hook-mark"},
    {"kind":"staysInFrame","selector":"#hook-copy"},
    {"kind":"keepsMoving","withinSelector":"#root","maxStaticSec":0.9}
  ]
}
```

- [ ] **Step 3: Build the Voice Fingerprint scene**

Render a six-axis SVG radar using real BlogForge axis labels. Animate the measured polygon from the center to these fixed values:

```js
const voiceDimensions = {
  casual: 72,
  vivid: 81,
  punchy: 68,
  warm: 76,
  concrete: 88,
  direct: 84,
};
```

Stage **Signature phrases**, **Sentence rhythm**, and **Banished** chips around the radar. At `1.8s` inside the scene, transition the audition card from:

```text
Original: AI can help teams communicate more effectively.
In your voice: AI can get the first sentence moving. The judgment is still yours.
```

Keep `#voice-mark` visible as the seam carrier at the right edge.

- [ ] **Step 4: Build the six-mode compose scene**

Use the six exact mode titles from `ModePicker.tsx`. Select each mode in sequence by moving one cobalt selection frame through the grid, then collapse the grid into:

```text
Talk it through › Outline › Draft
```

As the stages land, attach compact source chips and three outline cards. Resolve into one manuscript surface labeled **Composing the full draft** and expose `#draft-carrier` as the outgoing seam carrier.

- [ ] **Step 5: Lint the three scenes**

Run:

```bash
cd brag-output-2026-07-30-105707/composition
npx --yes hyperframes lint --json
```

Expected: zero lint errors. Fix duplicate IDs, timeline registration, CSS/GSAP transform conflicts, and missing `data-start` before continuing.

- [ ] **Step 6: Commit**

```bash
git add brag-output-2026-07-30-105707/composition/compositions/01-hook* \
  brag-output-2026-07-30-105707/composition/compositions/02-voice* \
  brag-output-2026-07-30-105707/composition/compositions/03-compose*
git commit -m "feat: animate BlogForge voice and compose journey"
```

---

### Task 3: Build the Edit, Finish, and Outro Scenes

**Files:**
- Create: `brag-output-2026-07-30-105707/composition/compositions/04-edit.html`
- Create: `brag-output-2026-07-30-105707/composition/compositions/04-edit.motion.json`
- Create: `brag-output-2026-07-30-105707/composition/compositions/05-finish.html`
- Create: `brag-output-2026-07-30-105707/composition/compositions/05-finish.motion.json`
- Create: `brag-output-2026-07-30-105707/composition/compositions/06-outro.html`
- Create: `brag-output-2026-07-30-105707/composition/compositions/06-outro.motion.json`

**Interfaces:**
- Consumes: `#draft-carrier` geometry from Task 2 and shared design tokens
- Produces: composition IDs `scene-edit`, `scene-finish`, and `scene-outro`; carrier IDs `#edited-manuscript`, `#publish-artifact`, and `#final-lockup`

- [ ] **Step 1: Build the manuscript editor**

Use one article titled **Why AI writing needs a workshop**. Show **All changes saved**, a three-stage breadcrumb, manuscript text, and one selected sentence. Open a compact inline menu with:

```text
Rewrite · Shorter · Stronger · In my voice
```

Show the six review labels in a right-hand rail. A **Humanization Check** finding opens a compare card with **Original**, **Rewrite**, and **Apply**. Keep the change unapplied for `0.45s`, then apply it and show a tracked-change highlight before it clears.

- [ ] **Step 2: Assert edit-scene causality**

The edit sidecar must verify the article appears before the review rail, the compare card appears before the applied state, and `#edited-manuscript` stays in frame.

- [ ] **Step 3: Build the finish scene**

Start from the same article surface. Add a generated hero image treatment made from abstract BlogForge manuscript geometry rather than a photographic claim. Trigger **Atomize all** and fan out five labeled cards:

```text
X thread · LinkedIn · Newsletter · TL;DR · SEO meta
```

Then stack export chips:

```text
Markdown · HTML · Word
```

Finally show the real dialog title **Publish to GitHub** and resolve to **Published to GitHub ✓**. The action starts from a deliberate click; no auto-publish claim is shown.

- [ ] **Step 4: Build the whole-product close**

File the Voice Fingerprint, stage rail, manuscript, review finding, and publish artifact into one glass card. Land:

```text
Your voice.
One coherent argument.
Ready to publish.
```

Add **A workshop for long-form writing** and `BlogForge v0.10`. Hold the fully settled state from `22.55s` through `24.0s`.

- [ ] **Step 5: Lint the six scenes**

Run:

```bash
cd brag-output-2026-07-30-105707/composition
npx --yes hyperframes lint --json
```

Expected: zero lint errors across `index.html` and all scene files.

- [ ] **Step 6: Commit**

```bash
git add brag-output-2026-07-30-105707/composition/compositions/04-edit* \
  brag-output-2026-07-30-105707/composition/compositions/05-finish* \
  brag-output-2026-07-30-105707/composition/compositions/06-outro*
git commit -m "feat: animate BlogForge editing and publishing journey"
```

---

### Task 4: Assemble the Master Timeline, Seams, and Audio

**Files:**
- Modify: `brag-output-2026-07-30-105707/composition/index.html`
- Create: `brag-output-2026-07-30-105707/composition/index.motion.json`
- Create: `brag-output-2026-07-30-105707/composition/ledger.json`

**Interfaces:**
- Consumes: six scene IDs and four carrier IDs from Tasks 2–3
- Produces: a renderable `main` composition with exact 24-second timing and five verified seams

- [ ] **Step 1: Mount the scene sub-compositions**

Mount scene hosts as direct children of `#root`:

```html
<div id="slot-hook" class="clip" data-composition-id="scene-hook"
  data-composition-src="compositions/01-hook.html"
  data-start="0" data-duration="2.7" data-track-index="1"
  data-width="1920" data-height="1080"></div>
```

Repeat with:

```text
scene-voice    start 2.7  duration 3.7
scene-compose  start 6.4  duration 4.0
scene-edit     start 10.4 duration 5.8
scene-finish   start 16.2 duration 4.8
scene-outro    start 21.0 duration 3.0
```

- [ ] **Step 2: Write the vector ledger**

Create five leftward seam rows with cut times `2.7`, `6.4`, `10.4`, `16.2`, and `21.0`. Use the scene hero or scene root as the measured carrier when a sub-composition's internal carrier cannot be inspected across the host boundary.

Each ledger row must declare matching exit and entry axes and signed directions. The final scene's internal resolving motion may rise, but the `21.0` boundary itself remains leftward.

- [ ] **Step 3: Stamp and verify seams**

Run:

```bash
node /Users/dbbaskette/.agents/skills/motion-doctrine/scripts/seam-stamp.mjs \
  --ledger ledger.json --write index.html
node /Users/dbbaskette/.agents/skills/motion-doctrine/scripts/seam-gate.mjs \
  verify --ledger ledger.json --project .
```

Expected: seam verifier exits `0`; no boundary crossfades, overlap, mirrored vectors, or dead entries.

- [ ] **Step 4: Add framework-owned audio**

Place music at `data-start="0"` and `data-duration="24"`. Place four distinct sound effects on non-overlapping audio tracks at the planned cues. Animate music volume from `0` to its bed level during the first `0.75s`, then fade to `0` from `23.25–24.0s`.

- [ ] **Step 5: Add master motion assertions**

The master sidecar must assert:

```json
{
  "duration": 24,
  "assertions": [
    {"kind":"appearsBy","selector":"#slot-hook","bySec":0.1},
    {"kind":"before","a":"#slot-voice","b":"#slot-finish"},
    {"kind":"staysInFrame","selector":"#slot-edit"},
    {"kind":"staysInFrame","selector":"#slot-outro"},
    {"kind":"keepsMoving","withinSelector":"#root","maxStaticSec":1.8}
  ]
}
```

- [ ] **Step 6: Commit**

```bash
git add brag-output-2026-07-30-105707/composition/index.html \
  brag-output-2026-07-30-105707/composition/index.motion.json \
  brag-output-2026-07-30-105707/composition/ledger.json
git commit -m "feat: assemble BlogForge whole-app launch film"
```

---

### Task 5: Validate, Render, Poster-Bake, and Deliver

**Files:**
- Create: `brag-output-2026-07-30-105707/brag.mp4`
- Create: `brag-output-2026-07-30-105707/brag.jpg`
- Create: `brag-output-2026-07-30-105707/share-copy.txt`
- Create: `brag-output-2026-07-30-105707/composition/snapshots/**`

**Interfaces:**
- Consumes: validated master composition from Task 4
- Produces: final video, poster, canonical share caption, and verification evidence

- [ ] **Step 1: Run the single final browser gate**

Run:

```bash
cd brag-output-2026-07-30-105707/composition
npx --yes hyperframes check --snapshots \
  --at 1.2,3.9,7.8,11.7,14.6,18.2,20.3,22.7,23.9 \
  --at-transitions --timeout 30000 --json
```

Expected: `ok: true`, with zero runtime, layout, motion, and contrast errors.

- [ ] **Step 2: Inspect the visual contact sheet**

Build one contact sheet from the overview PNGs and inspect it at original detail. Confirm:

- the first two seconds communicate the hook;
- the Voice Fingerprint is readable;
- all six starting modes are legible;
- the editor and review tools look like one workspace;
- Atomize, export, and GitHub publishing appear in the same finish scene;
- the final lockup is complete and not black.

- [ ] **Step 3: Run keyframe and seam proof**

Run:

```bash
npx --yes hyperframes keyframes . --runtime all --json
npx --yes hyperframes keyframes . \
  --selector "#final-lockup" \
  --shot snapshots/final-lockup-keyframes.png \
  --layout strip --from 21.0 --to 23.2 --samples 7
node /Users/dbbaskette/.agents/skills/motion-doctrine/scripts/seam-gate.mjs \
  verify --ledger ledger.json --project .
```

Expected: diagnostics succeed, the final lockup visibly settles, and seam verification remains green.

- [ ] **Step 4: Render the high-quality master**

Run:

```bash
HYPERFRAMES_RUN_ID=blogforge-whole-app-brag-20260730 \
  npx --yes hyperframes render --quality high --output ../brag.mp4
```

Expected: `../brag.mp4` exists and reports a 24-second render.

- [ ] **Step 5: Select and bake the poster**

Extract a settled whole-product frame near `20.3s`:

```bash
ffmpeg -y -ss 20.3 -i ../brag.mp4 -frames:v 1 -q:v 2 ../brag.jpg
```

Inspect it. If it lacks the article, channel outputs, or publishing state, choose the strongest settled frame between `20.0–20.7s`.

Bake the chosen poster into frame zero:

```bash
cd ..
ffmpeg -y -i brag.mp4 -i brag.jpg \
  -filter_complex "[0:v][1:v]overlay=0:0:enable='eq(n,0)'[v]" \
  -map "[v]" -map "0:a?" -c:v libx264 -crf 18 -preset slow \
  -pix_fmt yuv420p -c:a copy -movflags +faststart brag.poster.mp4
mv brag.poster.mp4 brag.mp4
```

- [ ] **Step 6: Write whole-product share copy**

Write exactly:

```text
BlogForge is a workshop for long-form writing: start with your voice and sources, shape one coherent argument, edit with the decisions visible, then repurpose or publish when it is ready. AI does the lifting; the writer keeps the judgment.
```

- [ ] **Step 7: Verify the deliverables**

Run:

```bash
ffprobe -v error -count_frames \
  -show_entries format=duration,size,bit_rate:stream=index,codec_type,codec_name,width,height,r_frame_rate,nb_read_frames,sample_rate,channels \
  -of json brag.mp4
test -s brag.jpg
test -s share-copy.txt
```

Expected:

```text
duration: 24.000000
video: h264, 1920x1080, 30/1, 720 frames
audio: aac, 48000 Hz, 2 channels
```

- [ ] **Step 8: Commit**

```bash
git add brag-output-2026-07-30-105707
git commit -m "feat: deliver BlogForge whole-app launch film"
```

