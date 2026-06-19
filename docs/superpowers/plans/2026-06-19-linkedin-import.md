# LinkedIn Import Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let a user upload their LinkedIn data-export archive on Your Voice; parse Profile + Articles and prefill the voice persona + seed writing samples.

**Architecture:** A pure parser `voice/linkedin_import.py` (zipfile + csv + trafilatura) → `LinkedInProfile`; a `POST /api/voice/import/linkedin` upload endpoint distills the persona (LLM, or direct-map fallback) and seeds samples; a `tanzu`-aware provider auto-select helper (shared with distill); a walk-through + upload card on Your Voice.

**Tech Stack:** FastAPI (multipart), trafilatura (existing dep), stdlib zipfile/csv, React/TS, pytest.

> **Spec:** `docs/superpowers/specs/2026-06-19-linkedin-import-design.md`
> **Verified facts:** `add_text_sample(user_id, *, name, text) -> VoiceSample` (opens its own store). `provider.complete(*, model, prompt, json_schema=None)` returns a result with `.text`. `store.update_persona(user_id, identity=, one_line=, tone=)`. distill auto-select at `api/voice.py:296` is `for candidate in ("anthropic","openai","google","claude-cli")` using `await vault.get(candidate)`. **`tanzu` is NOT a vault key** (KeyVault only knows anthropic/openai/google) — gate it on `get_settings().tanzu_api_base and tanzu_api_key`. Real archive: `Profile.csv` (cols incl. `Headline`,`Summary`), `Articles/Articles/*.html`.

---

## Task 1: LinkedIn parser + persona helpers

**Files:** Create `packages/api/blogforge/voice/linkedin_import.py`; Test `packages/api/tests/voice/test_linkedin_import.py`

- [ ] **Step 1: Failing tests** `packages/api/tests/voice/test_linkedin_import.py`:
```python
import io, zipfile
import pytest
from blogforge.voice.linkedin_import import (
    parse_linkedin_archive, LinkedInImportError, build_persona_prompt, parse_persona,
)


def _zip(files: dict[str, str]) -> bytes:
    buf = io.BytesIO()
    with zipfile.ZipFile(buf, "w") as z:
        for name, content in files.items():
            z.writestr(name, content)
    return buf.getvalue()


def test_parses_profile_and_article() -> None:
    csv_text = "Headline,Summary\r\n\"Sr. Director @ X\",\"A leader in technical marketing.\"\r\n"
    html = "<html><head><title>My Article</title></head><body><p>" + ("Real writing about platforms. " * 20) + "</p></body></html>"
    prof = parse_linkedin_archive(_zip({"Profile.csv": csv_text, "Articles/Articles/a.html": html}))
    assert prof.headline == "Sr. Director @ X"
    assert "technical marketing" in prof.summary
    assert len(prof.articles) == 1
    assert prof.articles[0].title == "My Article"
    assert "platforms" in prof.articles[0].text


def test_empty_archive_raises() -> None:
    with pytest.raises(LinkedInImportError):
        parse_linkedin_archive(_zip({"random.txt": "nothing useful"}))


def test_persona_prompt_and_parse() -> None:
    p = build_persona_prompt("Head of X", "I build things.")
    assert "Head of X" in p and "I build things" in p
    assert parse_persona('{"identity":"a","one_line":"b","tone":"c"}') == ("a", "b", "c")
```

- [ ] **Step 2: Run → FAIL** `.venv/bin/python -m pytest packages/api/tests/voice/test_linkedin_import.py -q`.

- [ ] **Step 3: Implement `packages/api/blogforge/voice/linkedin_import.py`:**
```python
"""Parse a LinkedIn 'Get a copy of your data' archive into persona + writing samples."""
from __future__ import annotations

import csv
import io
import json
import re
import zipfile
from dataclasses import dataclass, field

import trafilatura

PERSONA_SCHEMA: dict[str, object] = {
    "type": "object",
    "properties": {
        "identity": {"type": "string"},
        "one_line": {"type": "string"},
        "tone": {"type": "string"},
    },
    "required": ["identity", "one_line", "tone"],
}


class LinkedInImportError(Exception):
    """Raised when an uploaded archive has no usable Profile/Articles."""


@dataclass
class Article:
    title: str
    text: str


@dataclass
class LinkedInProfile:
    headline: str = ""
    summary: str = ""
    articles: list[Article] = field(default_factory=list)


def parse_linkedin_archive(data: bytes) -> LinkedInProfile:
    try:
        zf = zipfile.ZipFile(io.BytesIO(data))
    except zipfile.BadZipFile as exc:
        raise LinkedInImportError("That file isn't a valid .zip archive.") from exc

    names = zf.namelist()
    files = [n for n in names if not n.endswith("/")]
    if len(files) == 1 and files[0].lower().endswith(".zip"):  # download double-zip
        return parse_linkedin_archive(zf.read(files[0]))

    prof = LinkedInProfile()
    pc = next((n for n in names if n.lower().endswith("profile.csv")), None)
    if pc:
        rows = list(csv.DictReader(io.StringIO(zf.read(pc).decode("utf-8", "replace"))))
        if rows:
            prof.headline = (rows[0].get("Headline") or "").strip()
            prof.summary = (rows[0].get("Summary") or "").strip()

    for n in names:
        if "articles/" in n.lower() and n.lower().endswith((".html", ".htm")):
            raw = zf.read(n).decode("utf-8", "replace")
            text = (trafilatura.extract(raw) or "").strip()
            text = re.sub(r"^(?:Created on|Published on)[^\n]*\n?", "", text).strip()
            if len(text) < 40:
                continue
            m = re.search(r"<title[^>]*>([^<]+)</title>", raw, re.IGNORECASE)
            title = m.group(1).strip() if m else n.rsplit("/", 1)[-1].rsplit(".", 1)[0].replace("-", " ")
            prof.articles.append(Article(title=title, text=text))

    if not prof.headline and not prof.summary and not prof.articles:
        raise LinkedInImportError("No Profile.csv or Articles found in the archive.")
    return prof


def build_persona_prompt(headline: str, summary: str) -> str:
    return (
        "From this LinkedIn profile, write a concise writing-voice persona.\n\n"
        f"Headline: {headline}\n\nAbout:\n{summary}\n\n"
        "Return JSON with three one-line fields: `identity` (who they are "
        "professionally), `one_line` (a short tagline in their own voice), and "
        "`tone` (a few words describing how they write)."
    )


def parse_persona(text: str) -> tuple[str, str, str]:
    data = json.loads(text)
    return (
        str(data.get("identity", "")).strip(),
        str(data.get("one_line", "")).strip(),
        str(data.get("tone", "")).strip(),
    )
```

- [ ] **Step 4: Run → PASS** (3 tests). **Step 5: Commit**
```bash
git add packages/api/blogforge/voice/linkedin_import.py packages/api/tests/voice/test_linkedin_import.py
git commit -m "feat(voice): LinkedIn data-export parser + persona prompt helpers"
```

---

## Task 2: Import endpoint + tanzu-aware provider auto-select

**Files:** Modify `packages/api/blogforge/api/voice.py`; Test `packages/api/tests/api/test_linkedin_import_endpoint.py`

- [ ] **Step 1: Add a shared auto-select helper** in `api/voice.py` (module level, near `_PROVIDER_DEFAULTS`). It includes `tanzu` (gated on settings, since it has no vault key):
```python
async def _auto_select_provider(user_id) -> str | None:
    from blogforge.config import get_settings
    from blogforge.keys import KeyVault
    vault = KeyVault(user_id)
    for candidate in ("anthropic", "openai", "google", "claude-cli"):
        if await vault.get(candidate):
            return candidate
    s = get_settings()
    if s.tanzu_api_base and s.tanzu_api_key:
        return "tanzu"
    return None
```
Then in the existing `distill` endpoint, replace the inline `for candidate in (...)` auto-select block with `provider_name = body.provider or await _auto_select_provider(current.id)` (keep the subsequent `if provider_name is None: raise HTTPException(400, …)`).

- [ ] **Step 2: Failing endpoint test** `packages/api/tests/api/test_linkedin_import_endpoint.py`:
```python
import io, zipfile


def _archive() -> bytes:
    buf = io.BytesIO()
    with zipfile.ZipFile(buf, "w") as z:
        z.writestr("Profile.csv", "Headline,Summary\r\n\"Head of X\",\"I build platforms and write about them.\"\r\n")
        z.writestr("Articles/Articles/a.html",
                   "<html><head><title>On Platforms</title></head><body><p>" + ("Real prose. " * 30) + "</p></body></html>")
    return buf.getvalue()


def test_import_prefills_persona_and_samples(authed_client, monkeypatch) -> None:
    monkeypatch.setenv("BLOGFORGE_TEST_PROVIDER", "mock")
    client, _uid = authed_client
    before = len(client.get("/api/voice").json()["samples"])
    r = client.post("/api/voice/import/linkedin",
                    files={"file": ("export.zip", _archive(), "application/zip")})
    assert r.status_code == 200, r.text
    prof = r.json()
    assert len(prof["samples"]) >= before + 2          # About + 1 article
    assert prof["persona_one_line"] or prof["persona_identity"]


def test_import_bad_archive_400(authed_client) -> None:
    client, _ = authed_client
    r = client.post("/api/voice/import/linkedin",
                    files={"file": ("x.zip", b"not a zip", "application/zip")})
    assert r.status_code == 400
```

- [ ] **Step 3: Run → FAIL** (404).

- [ ] **Step 4: Add the endpoint** to `api/voice.py` (imports: `File, Form, UploadFile` from fastapi — `Request`/`UploadFile` likely already imported; `from blogforge.voice.linkedin_import import parse_linkedin_archive, build_persona_prompt, parse_persona, PERSONA_SCHEMA, LinkedInImportError`; `from blogforge.voice.ingest import add_text_sample`; `from blogforge.llm.resolve import build_provider_for`):
```python
@router.post("/import/linkedin")
async def import_linkedin(
    request: Request,
    file: UploadFile = File(...),
    provider: str | None = Form(None),
    model: str | None = Form(None),
    current: User = Depends(get_current_user),
) -> VoiceProfile:
    """Parse an uploaded LinkedIn data-export archive → prefill persona + seed samples."""
    data = await file.read()
    if len(data) > 10 * 1024 * 1024:
        raise HTTPException(400, detail={"error": {"code": "file_too_large", "message": "Archive exceeds 10 MB."}})
    try:
        parsed = parse_linkedin_archive(data)
    except LinkedInImportError as exc:
        raise HTTPException(400, detail={"error": {"code": "linkedin_parse_failed", "message": str(exc)}}) from exc

    store = _store(request)

    # Persona: LLM distill if a provider is available, else direct map.
    provider_name = provider or await _auto_select_provider(current.id)
    identity, one_line, tone = "", parsed.headline, ""
    if provider_name:
        prov = await build_provider_for(current.id, provider_name)
        mdl = model or _PROVIDER_DEFAULTS.get(provider_name, "claude-sonnet-4-6")
        try:
            resp = await prov.complete(model=mdl, prompt=build_persona_prompt(parsed.headline, parsed.summary), json_schema=PERSONA_SCHEMA)
            identity, one_line, tone = parse_persona(resp.text)
        except Exception:
            identity = parsed.summary.split(". ")[0][:200]
    else:
        identity = parsed.summary.split(". ")[0][:200] if parsed.summary else ""

    await store.update_persona(current.id, identity=identity, one_line=one_line or parsed.headline, tone=tone)

    if parsed.summary:
        await add_text_sample(current.id, name="LinkedIn — About", text=parsed.summary)
    for art in parsed.articles[:25]:
        await add_text_sample(current.id, name=f"LinkedIn — {art.title}"[:120], text=art.text)

    return await store.get_or_create(current.id)
```
> Confirm `prov.complete(...)` returns an object with `.text` (mirror how `api/inline.py`/`distill` read the completion). If it's `.content`/etc., use that.

- [ ] **Step 5: Run → PASS** `.venv/bin/python -m pytest packages/api/tests/api/test_linkedin_import_endpoint.py -q`; then full suite `.venv/bin/python -m pytest packages/api -q`.

- [ ] **Step 6: Commit**
```bash
git add packages/api/blogforge/api/voice.py packages/api/tests/api/test_linkedin_import_endpoint.py
git commit -m "feat(api): /api/voice/import/linkedin upload + tanzu-aware provider auto-select"
```

---

## Task 3: Your Voice — walk-through + upload card

**Files:** Modify `packages/web/src/api/voice.ts`, `packages/web/src/routes/VoicePage.tsx`; Create `packages/web/src/components/voice/LinkedInImportCard.tsx`

- [ ] **Step 1: `api/voice.ts`** — add a multipart importer (mirror `uploadSampleFile`'s FormData pattern; read that fn first):
```ts
export async function importLinkedIn(file: File): Promise<VoiceProfile> {
  const fd = new FormData();
  fd.append("file", file);
  return api<VoiceProfile>("/api/voice/import/linkedin", { method: "POST", body: fd });
}
```
(If `api()` sets a JSON `Content-Type` that breaks FormData, mirror exactly what `uploadSampleFile` does — it already solves this for file uploads.)

- [ ] **Step 2: `components/voice/LinkedInImportCard.tsx`** — a card matching the page's `nb-card` styling (read `VoicePage.tsx`/`PersonaCard` for classes):
```tsx
import { useRef, useState } from "react";
import { importLinkedIn } from "../../api/voice";

export function LinkedInImportCard({ onImported }: { onImported: () => void }): JSX.Element {
  const fileRef = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);

  async function onPick(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    setBusy(true); setErr(null); setMsg(null);
    try {
      const prof = await importLinkedIn(file);
      setMsg(`Prefilled your persona and added ${prof.samples.length} sample(s). Review below, then Distill.`);
      onImported();
    } catch (e2) {
      setErr(e2 instanceof Error ? e2.message : "Import failed.");
    } finally {
      setBusy(false);
      if (fileRef.current) fileRef.current.value = "";
    }
  }

  return (
    <section className="nb-card p-6">
      <h2 className="font-serif text-xl font-medium text-ink mb-2">Import from LinkedIn</h2>
      <p className="text-sm text-muted mb-3">
        LinkedIn blocks automatic fetching, so import your official data export (it's quick):
      </p>
      <ol className="text-sm text-muted list-decimal ml-5 space-y-1 mb-4">
        <li>LinkedIn → <b>Settings &amp; Privacy → Data Privacy → Get a copy of your data</b></li>
        <li>Select <b>Profile</b> (and <b>Articles</b>) → <b>Request archive</b></li>
        <li>Wait for LinkedIn's email, download the <code>.zip</code></li>
        <li>Upload it here ⤵</li>
      </ol>
      <div className="flex items-center gap-3">
        <a href="https://www.linkedin.com/mypreferences/d/download-my-data" target="_blank" rel="noreferrer"
           className="nb-btn nb-btn-sm nb-btn-ghost">Open LinkedIn data export ↗</a>
        <input ref={fileRef} type="file" accept=".zip" onChange={onPick} disabled={busy} className="text-sm" />
      </div>
      {busy && <p className="text-sm text-muted mt-2">Importing…</p>}
      {msg && <p className="text-sm mt-2" style={{ color: "#1f7a4d" }}>{msg}</p>}
      {err && <p className="text-sm mt-2" style={{ color: "#b5321b" }}>{err}</p>}
    </section>
  );
}
```

- [ ] **Step 3: Mount it** in `VoicePage.tsx` — import `LinkedInImportCard` and render `<LinkedInImportCard onImported={reload} />` near the Persona card, passing the page's existing profile-reload function (find how VoicePage reloads — e.g. a `load()`/`mutate()`; reuse it).

- [ ] **Step 4: Verify** from `packages/web`: `./node_modules/.bin/tsc --noEmit` (clean) and `./node_modules/.bin/vitest run` (green). Add a tiny render test asserting the card shows the walk-through + the upload input if the suite tests components.

- [ ] **Step 5: Commit**
```bash
git add packages/web/src
git commit -m "feat(web): Import from LinkedIn card (walk-through + data-export upload) on Your Voice"
```

---

## Self-Review Notes
- **Spec coverage:** parser + persona helpers → T1; endpoint + seed samples + tanzu auto-select → T2; walk-through/upload UI → T3. Fallback (no provider → direct map) in T2. Article cap (25) + size guard in T2.
- **Type consistency:** `parse_linkedin_archive → LinkedInProfile{headline,summary,articles:[Article{title,text}]}` (T1) consumed in T2; `build_persona_prompt`/`parse_persona`/`PERSONA_SCHEMA` (T1) used in T2; `importLinkedIn(file) → VoiceProfile` (T3) matches the endpoint return.
- **Adapt-on-contact:** the completion result attribute (`.text`) in T2/Step 4; `uploadSampleFile`'s FormData/Content-Type handling in T3/Step 1; VoicePage's reload fn in T3/Step 3.
