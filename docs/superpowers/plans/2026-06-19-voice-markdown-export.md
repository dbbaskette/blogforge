# Portable Voice Markdown Export Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a "Download voice guide (.md)" export that renders the user's `VoiceProfile` as a single portable Markdown doc (persona + distilled style + banished list + full universal AI-tells, under a paste-ready preamble) for use in any external LLM.

**Architecture:** A pure builder `blogforge.voice.guide.build_voice_guide(profile)` assembles the Markdown from the profile + `load_ai_tells()`; a `GET /api/voice/guide.md` endpoint returns it as a download; the Voice screen gets a second `<a download>` button mirroring the existing ZIP export.

**Tech Stack:** FastAPI, Pydantic, React/TS, pytest, vitest.

> **Spec:** `docs/superpowers/specs/2026-06-19-voice-markdown-export-design.md`
> **Test:** `cd /Users/dbbaskette/Projects/BlogForge && .venv/bin/python -m pytest <path> -q`; web from `packages/web`: `./node_modules/.bin/tsc --noEmit`.
> **Data facts:** `VoiceProfile` has `name, persona_identity, persona_one_line, persona_tone, distilled_style_md, distilled_at, samples` + `rules.banished_words/banished_phrases`. `load_ai_tells()` → `AiTells(words: tuple, phrases: tuple, sentence_starters: tuple, patterns: str)`.

---

## Task 1: Markdown builder + endpoint

**Files:** Create `packages/api/blogforge/voice/guide.py`; Modify `packages/api/blogforge/api/voice.py`; Test `packages/api/tests/voice/test_guide.py`, `packages/api/tests/api/test_voice_guide_endpoint.py`

- [ ] **Step 1: Write the failing builder tests** `packages/api/tests/voice/test_guide.py`:
```python
from datetime import UTC, datetime
from blogforge.voice.guide import build_voice_guide
from blogforge.voice.models import VoiceProfile, VoiceRules


def _profile(**kw) -> VoiceProfile:
    base = dict(id="p1", user_id="u1", name="My Voice")
    base.update(kw)
    return VoiceProfile(**base)


def test_full_profile_renders_all_sections() -> None:
    p = _profile(
        persona_identity="A pragmatic platform engineer.",
        persona_one_line="Plain, concrete, no hype.",
        persona_tone="Direct",
        distilled_style_md="Short sentences. Concrete nouns.",
        rules=VoiceRules(banished_words=["synergy"], banished_phrases=["at the end of the day"]),
        distilled_at=datetime(2026, 6, 19, tzinfo=UTC),
    )
    md = build_voice_guide(p)
    assert "When you write for me" in md            # preamble
    assert "pragmatic platform engineer" in md      # persona
    assert "Concrete nouns" in md                   # distilled style
    assert "synergy" in md                          # user's banished word
    assert "delve" in md                            # a universal AI-tell word
    assert "Phrases to avoid" in md and "Words to avoid" in md
    assert "writing samples" in md                  # footer


def test_empty_profile_does_not_crash() -> None:
    md = build_voice_guide(_profile())  # no persona/distilled/banished
    assert "Not yet distilled" in md                # style placeholder
    assert "banished words" not in md.lower()       # banished section omitted
    assert "delve" in md                            # AI-tells still present
```

- [ ] **Step 2: Run → FAIL** `.venv/bin/python -m pytest packages/api/tests/voice/test_guide.py -q` (ModuleNotFoundError: blogforge.voice.guide).

- [ ] **Step 3: Implement `packages/api/blogforge/voice/guide.py`:**
```python
"""Render a VoiceProfile as a portable Markdown 'voice guide' for external LLMs."""
from __future__ import annotations

from blogforge.voice.ai_tells import load_ai_tells
from blogforge.voice.models import VoiceProfile

_PREAMBLE = (
    "> **How to use:** When you write for me, follow this voice guide — match the\n"
    "> persona and style below, and never use the words, phrases, or patterns under\n"
    '> "Avoid these AI-writing tells." Paste it into any AI assistant as a style\n'
    "> instruction, or keep it as a personal reference."
)


def build_voice_guide(profile: VoiceProfile) -> str:
    ai = load_ai_tells()
    parts: list[str] = [f"# {profile.name or 'My Voice'} — Writing Voice Guide", _PREAMBLE]

    persona: list[str] = []
    if profile.persona_identity.strip():
        persona.append(profile.persona_identity.strip())
    if profile.persona_one_line.strip():
        persona.append(f"**In one line:** {profile.persona_one_line.strip()}")
    if profile.persona_tone.strip():
        persona.append(f"**Tone:** {profile.persona_tone.strip()}")
    if persona:
        parts.append("## Persona\n\n" + "\n\n".join(persona))

    style = profile.distilled_style_md.strip()
    parts.append(
        "## My style\n\n" + style if style
        else "## My style\n\n*(Not yet distilled — run distillation on the Voice "
             "screen to capture your style.)*"
    )

    words = [w for w in profile.rules.banished_words if w.strip()]
    phrases = [p for p in profile.rules.banished_phrases if p.strip()]
    if words or phrases:
        b = ["## My banished words & phrases", "Never use these in my writing:"]
        if words:
            b.append(f"- **Words:** {', '.join(words)}")
        if phrases:
            b.append(f"- **Phrases:** {', '.join(phrases)}")
        parts.append("\n".join(b))

    parts.append(
        "## Avoid these AI-writing tells\n\n"
        "Universal signs of machine-written text. Don't use them.\n\n"
        f"### Words to avoid\n\n{', '.join(ai.words)}\n\n"
        f"### Phrases to avoid\n\n" + "\n".join(f"- {p}" for p in ai.phrases) + "\n\n"
        f"### Sentence openers to avoid\n\n{', '.join(ai.sentence_starters)}\n\n"
        f"### Structural patterns to avoid\n\n{ai.patterns.strip()}"
    )

    footer = f"*Generated by BlogForge from {len(profile.samples)} writing samples"
    if profile.distilled_at is not None:
        footer += f" · distilled {profile.distilled_at:%Y-%m-%d}"
    parts.append("---\n\n" + footer + ".*")

    return "\n\n".join(parts) + "\n"
```

- [ ] **Step 4: Run → PASS** `.venv/bin/python -m pytest packages/api/tests/voice/test_guide.py -q` (2 passed).

- [ ] **Step 5: Write the failing endpoint test** `packages/api/tests/api/test_voice_guide_endpoint.py` (uses the `authed_client` fixture — a TestClient signed in as an approved user; confirm its name with `grep -n "def authed_client" packages/api/tests/conftest.py`):
```python
async def test_guide_md_download(authed_client) -> None:
    client, _uid = authed_client
    r = client.get("/api/voice/guide.md")
    assert r.status_code == 200
    assert r.headers["content-type"].startswith("text/markdown")
    assert "voice-guide.md" in r.headers.get("content-disposition", "")
    assert "Writing Voice Guide" in r.text
```
> If the auth fixture yields differently (e.g. just the client), adapt the unpacking. The signed-in user has a profile via `get_or_create`.

- [ ] **Step 6: Run → FAIL** (404, no route yet).

- [ ] **Step 7: Add the endpoint to `packages/api/blogforge/api/voice.py`.** Ensure `import re` is present at the top (add if missing) and `build_voice_guide` is imported (`from blogforge.voice.guide import build_voice_guide`). Add next to `export_pack`:
```python
@router.get("/guide.md")
async def export_guide(
    request: Request,
    current: User = Depends(get_current_user),
) -> Response:
    """Download the user's voice as a portable Markdown guide."""
    store = _store(request)
    profile = await store.get_or_create(current.id)
    md = build_voice_guide(profile)
    slug = re.sub(r"[^a-z0-9]+", "-", (profile.name or "voice").lower()).strip("-") or "voice"
    return Response(
        content=md,
        media_type="text/markdown; charset=utf-8",
        headers={"Content-Disposition": f'attachment; filename="{slug}-voice-guide.md"'},
    )
```
(`Response` is already imported in voice.py — it's used by `export_pack`; verify with `grep -n "import Response\|Response" packages/api/blogforge/api/voice.py`.)

- [ ] **Step 8: Run → PASS** `.venv/bin/python -m pytest packages/api/tests/api/test_voice_guide_endpoint.py packages/api/tests/voice/test_guide.py -q`.

- [ ] **Step 9: Full API suite green** `.venv/bin/python -m pytest packages/api -q`.

- [ ] **Step 10: Commit**
```bash
git add packages/api/blogforge/voice/guide.py packages/api/blogforge/api/voice.py packages/api/tests/voice/test_guide.py packages/api/tests/api/test_voice_guide_endpoint.py
git commit -m "feat(voice): portable Markdown voice-guide export (builder + /api/voice/guide.md)"
```

---

## Task 2: Voice screen download button

**Files:** Modify `packages/web/src/api/voice.ts`, `packages/web/src/routes/VoicePage.tsx`

- [ ] **Step 1: Add the URL helper** to `packages/web/src/api/voice.ts`, right after `voiceExportUrl`:
```ts
/** URL for downloading the portable Markdown voice guide. */
export function voiceGuideUrl(): string {
  return `/api/voice/guide.md`;
}
```

- [ ] **Step 2: Add the button** in `packages/web/src/routes/VoicePage.tsx`. Import `voiceGuideUrl` alongside the existing `voiceExportUrl` import, then add a second anchor right after the "Download pack" anchor in the header:
```tsx
        <a
          href={voiceGuideUrl()}
          download
          className="nb-btn nb-btn-sm nb-btn-ghost shrink-0 mt-2"
        >
          Download voice guide
        </a>
```
(If the two anchors need to sit together, wrap both in a `<div className="flex gap-2 shrink-0 mt-2">` and drop the per-anchor `shrink-0 mt-2`. Match the existing layout — keep it tidy.)

- [ ] **Step 3: Verify** from `packages/web`:
```
./node_modules/.bin/tsc --noEmit      # clean
./node_modules/.bin/vitest run        # green (update VoicePage test only if it asserts the header's exact anchor set)
```

- [ ] **Step 4: Commit**
```bash
git add packages/web/src/api/voice.ts packages/web/src/routes/VoicePage.tsx
git commit -m "feat(web): Download voice guide (.md) button on the Voice screen"
```

---

## Self-Review Notes
- **Spec coverage:** builder → T1 (guide.py); graceful empty-profile → T1 tests + the omission logic; endpoint → T1; frontend button → T2. Full AI-tell lists + preamble → builder.
- **Type consistency:** `build_voice_guide(profile) -> str` defined T1/Step 3, used by the endpoint (T1/Step 7) and tests; `voiceGuideUrl()` defined + used in T2; `load_ai_tells()` fields (`words/phrases/sentence_starters/patterns`) match the builder.
- **Adapt-on-contact:** the auth fixture name/shape (T1/Step 5), and that `Response`/`re` are imported in voice.py (T1/Step 7).
