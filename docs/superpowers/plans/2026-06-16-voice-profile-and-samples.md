# Voice Profile & Samples Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give each user a portable, per-user voice profile — persona + rules + a sample library + an editable distilled style — that drives generation as a materialized myvoice pack.

**Architecture:** Profiles + samples are stored natively (Postgres + S3, reusing the references ingestion pipeline). At generation and export time BlogForge materializes a real myvoice pack into a temp dir and calls `compose_prompt` on it, unchanged. A central `resolve_voice` helper makes every generation route use the profile by default.

**Tech Stack:** FastAPI, SQLAlchemy (async) + Alembic, aiobotocore (S3/MinIO), myvoice library, Pydantic v2; React + TypeScript + Vite + Tailwind on the web side; pytest + vitest.

**Spec:** `docs/superpowers/specs/2026-06-16-voice-profile-and-samples-design.md`

**Conventions for this codebase (read before starting):**
- Backend tests run with `.venv/bin/python -m pytest <path> -q` (the `.venv`, not `local-venv`, has dev deps). Web: `cd packages/web && pnpm tsc --noEmit` then `pnpm test -- --run`.
- Mock LLM provider: set env `BLOGFORGE_TEST_PROVIDER=mock`; it returns `BLOGFORGE_MOCK_OUTPUT` (or `BLOGFORGE_MOCK_OUTPUT_JSON` when a `json_schema` is passed). See `packages/api/blogforge/test_helpers/mock_provider.py`.
- S3 client: `from blogforge.s3.client import get_s3_client`; methods `await put_object(key, body: bytes, content_type)`, `await get_object(key) -> bytes`, `await delete_object(key)`, `await delete_prefix(prefix)`.
- DB session: `from blogforge.db.session import get_sessionmaker` (see `drafts/sql_store.py` for the `async with get_sessionmaker()() as session:` pattern).
- `compose_prompt(pack_root, *, format, samples, draft, bio)` from `myvoice`; a pack dir contains `stylepack.yaml`, `style-guide.md`, and `samples/*.md`. The `dan` pack at `/Users/dbbaskette/Projects/myvoice/packs/dan` is the format reference.

---

## File structure

**Create:**
- `packages/api/blogforge/voice/__init__.py`
- `packages/api/blogforge/voice/models.py` — Pydantic `VoiceProfile`, `VoiceSample`.
- `packages/api/blogforge/voice/store.py` — `SqlVoiceStore` (CRUD).
- `packages/api/blogforge/voice/ingest.py` — add a sample (text/url/file) → S3, reusing the references extractors.
- `packages/api/blogforge/voice/distill.py` — `distill_style(...)`.
- `packages/api/blogforge/voice/pack.py` — `materialize(...)`, `export_zip(...)`.
- `packages/api/blogforge/voice/resolve.py` — `resolve_voice(...)`.
- `packages/api/blogforge/api/voice.py` — REST router.
- `packages/api/alembic/versions/0013_voice_profiles_samples.py` — migration.
- `packages/web/src/api/voice.ts`
- `packages/web/src/routes/VoicePage.tsx`
- `packages/web/src/components/voice/{PersonaCard,RulesCard,SamplesList,DistilledStyle}.tsx`
- Tests under `packages/api/tests/voice/` and `packages/web/tests/...`.

**Modify:**
- `packages/api/blogforge/db/models.py` — add `VoiceProfile`, `VoiceSample` ORM rows + `User.voice_profile` relationship.
- `packages/api/blogforge/drafts/models.py` — `IdeaInput.use_voice_profile: bool = True`.
- `packages/api/blogforge/server.py` — register `voice_router`; store on `app.state`.
- Generation routes (`expand.py`, `section.py`, `revise.py`, `outline.py` wrappers, `inline.py`, `repurpose.py`, `headlines.py`) — swap pack lookup for `resolve_voice`.
- `packages/web/src/App.tsx` — `/voice` route; `AppShell.tsx` — nav link.
- `packages/web/src/api/drafts.ts` — `IdeaInput.use_voice_profile`.

---

## Phase 1 — Data model, migration, store

### Task 1: ORM rows + Alembic migration

**Files:**
- Modify: `packages/api/blogforge/db/models.py`
- Create: `packages/api/alembic/versions/0013_voice_profiles_samples.py`
- Test: `packages/api/tests/voice/test_voice_models_migration.py`

- [ ] **Step 1: Write the failing test** (round-trips a profile + sample through the DB)

```python
# packages/api/tests/voice/test_voice_models_migration.py
import pytest
from uuid import uuid4
from blogforge.db.models import User, VoiceProfile, VoiceSample
from blogforge.db.session import get_sessionmaker

@pytest.mark.asyncio
async def test_voice_profile_and_sample_round_trip(seed_db):  # seed_db fixture creates schema
    uid = uuid4()
    async with get_sessionmaker()() as s:
        s.add(User(id=uid, email="v@example.com", password_hash="x", status="approved", role="user"))
        prof = VoiceProfile(user_id=uid, name="My Voice",
                            persona_identity="The builder", persona_one_line="ol", persona_tone="t",
                            rules={"banished_words": ["leverage"], "no_em_dashes": True},
                            distilled_style_md="", version=1)
        s.add(prof)
        await s.flush()
        s.add(VoiceSample(profile_id=prof.id, kind="text", name="s1",
                          s3_key="voice/x/samples/1.md", extracted_chars=10, exemplar=True, status="ready"))
        await s.commit()
        pid = prof.id
    async with get_sessionmaker()() as s:
        got = await s.get(VoiceProfile, pid)
        assert got.rules["no_em_dashes"] is True
        await s.refresh(got, ["samples"])
        assert len(got.samples) == 1 and got.samples[0].exemplar is True
```

> Use the existing DB test fixture pattern (look at `packages/api/tests/test_db_models.py` for how a fresh schema/session is set up; reuse its fixture name instead of `seed_db` if it differs).

- [ ] **Step 2: Run it, expect failure** — `ImportError: cannot import name 'VoiceProfile'`.

Run: `.venv/bin/python -m pytest packages/api/tests/voice/test_voice_models_migration.py -q`

- [ ] **Step 3: Add ORM rows** to `packages/api/blogforge/db/models.py` (mirror the `Draft`/`Reference` row style already there)

```python
class VoiceProfile(Base):
    __tablename__ = "voice_profiles"
    id: Mapped[UUID] = mapped_column(Uuid, primary_key=True, default=_uuid)
    user_id: Mapped[UUID] = mapped_column(Uuid, ForeignKey("users.id", ondelete="CASCADE"),
                                          nullable=False, unique=True, index=True)
    name: Mapped[str] = mapped_column(String(120), nullable=False, default="My Voice")
    persona_identity: Mapped[str] = mapped_column(String(200), nullable=False, default="")
    persona_one_line: Mapped[str] = mapped_column(String(400), nullable=False, default="")
    persona_tone: Mapped[str] = mapped_column(String(200), nullable=False, default="")
    rules: Mapped[dict[str, Any]] = mapped_column(JSON, nullable=False, default=dict)
    distilled_style_md: Mapped[str] = mapped_column(Text, nullable=False, default="")
    distilled_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    version: Mapped[int] = mapped_column(Integer, nullable=False, default=1)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=_now)
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=_now, onupdate=_now)
    samples: Mapped[list["VoiceSample"]] = relationship(
        back_populates="profile", cascade="all, delete-orphan", order_by="VoiceSample.added_at")

class VoiceSample(Base):
    __tablename__ = "voice_samples"
    id: Mapped[UUID] = mapped_column(Uuid, primary_key=True, default=_uuid)
    profile_id: Mapped[UUID] = mapped_column(Uuid, ForeignKey("voice_profiles.id", ondelete="CASCADE"),
                                             nullable=False, index=True)
    kind: Mapped[str] = mapped_column(String(8), nullable=False)  # text|url|file
    name: Mapped[str] = mapped_column(String(300), nullable=False, default="")
    source_url: Mapped[str | None] = mapped_column(String(2000), nullable=True)
    original_filename: Mapped[str | None] = mapped_column(String(300), nullable=True)
    s3_key: Mapped[str] = mapped_column(String(400), nullable=False)
    extracted_chars: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    exemplar: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False)
    status: Mapped[str] = mapped_column(String(8), nullable=False, default="ready")  # ready|failed
    added_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=_now)
    profile: Mapped["VoiceProfile"] = relationship(back_populates="samples")
```

Add any missing imports at the top (`Text`, `Integer`, `Boolean`, `JSON`, `ForeignKey`, `String`, `DateTime`, `Uuid`, `Mapped`, `mapped_column`, `relationship`, `Any`, `datetime`, `UUID`) — match what `Draft` already imports.

- [ ] **Step 4: Write the migration**

```python
# packages/api/alembic/versions/0013_voice_profiles_samples.py
from collections.abc import Sequence
import sqlalchemy as sa
from alembic import op

revision: str = "0013_voice_profiles_samples"
down_revision: str | None = "0012_draft_hero_image_key"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None

def upgrade() -> None:
    op.create_table("voice_profiles",
        sa.Column("id", sa.Uuid(), primary_key=True),
        sa.Column("user_id", sa.Uuid(), sa.ForeignKey("users.id", ondelete="CASCADE"), nullable=False, unique=True),
        sa.Column("name", sa.String(120), nullable=False, server_default="My Voice"),
        sa.Column("persona_identity", sa.String(200), nullable=False, server_default=""),
        sa.Column("persona_one_line", sa.String(400), nullable=False, server_default=""),
        sa.Column("persona_tone", sa.String(200), nullable=False, server_default=""),
        sa.Column("rules", sa.JSON(), nullable=False, server_default="{}"),
        sa.Column("distilled_style_md", sa.Text(), nullable=False, server_default=""),
        sa.Column("distilled_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("version", sa.Integer(), nullable=False, server_default="1"),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()))
    op.create_index("ix_voice_profiles_user_id", "voice_profiles", ["user_id"])
    op.create_table("voice_samples",
        sa.Column("id", sa.Uuid(), primary_key=True),
        sa.Column("profile_id", sa.Uuid(), sa.ForeignKey("voice_profiles.id", ondelete="CASCADE"), nullable=False),
        sa.Column("kind", sa.String(8), nullable=False),
        sa.Column("name", sa.String(300), nullable=False, server_default=""),
        sa.Column("source_url", sa.String(2000), nullable=True),
        sa.Column("original_filename", sa.String(300), nullable=True),
        sa.Column("s3_key", sa.String(400), nullable=False),
        sa.Column("extracted_chars", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("exemplar", sa.Boolean(), nullable=False, server_default=sa.false()),
        sa.Column("status", sa.String(8), nullable=False, server_default="ready"),
        sa.Column("added_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()))
    op.create_index("ix_voice_samples_profile_id", "voice_samples", ["profile_id"])

def downgrade() -> None:
    op.drop_table("voice_samples")
    op.drop_table("voice_profiles")
```

- [ ] **Step 5: Run the test, expect PASS.** Then run the full DB-model test file to confirm no regressions: `.venv/bin/python -m pytest packages/api/tests/test_db_models.py -q`.

- [ ] **Step 6: Commit**

```bash
git add packages/api/blogforge/db/models.py packages/api/alembic/versions/0013_voice_profiles_samples.py packages/api/tests/voice/
git commit -m "feat(voice): voice_profiles + voice_samples tables + migration"
```

### Task 2: Pydantic models

**Files:**
- Create: `packages/api/blogforge/voice/__init__.py` (empty), `packages/api/blogforge/voice/models.py`
- Test: `packages/api/tests/voice/test_voice_pydantic.py`

- [ ] **Step 1: Failing test**

```python
from blogforge.voice.models import VoiceProfile, VoiceSample, VoiceRules
def test_defaults_and_round_trip():
    p = VoiceProfile(id="p1", user_id="u1")
    assert p.name == "My Voice" and p.rules.no_em_dashes is False and p.samples == []
    s = VoiceSample(id="s1", kind="url", name="x", s3_key="k", source_url="http://a")
    assert s.exemplar is False and s.status == "ready"
```

- [ ] **Step 2: Run, expect ImportError.**

- [ ] **Step 3: Implement** `packages/api/blogforge/voice/models.py`

```python
from __future__ import annotations
from datetime import UTC, datetime
from typing import Literal
from pydantic import BaseModel, Field

def _now() -> datetime: return datetime.now(UTC)

class VoiceRules(BaseModel):
    banished_words: list[str] = Field(default_factory=list)
    banished_phrases: list[str] = Field(default_factory=list)
    no_em_dashes: bool = False
    no_ascii_double_hyphen: bool = False

SampleKind = Literal["text", "url", "file"]
SampleStatus = Literal["ready", "failed"]

class VoiceSample(BaseModel):
    id: str
    kind: SampleKind
    name: str = ""
    source_url: str | None = None
    original_filename: str | None = None
    s3_key: str
    extracted_chars: int = 0
    exemplar: bool = False
    status: SampleStatus = "ready"
    added_at: datetime = Field(default_factory=_now)

class VoiceProfile(BaseModel):
    id: str
    user_id: str
    name: str = "My Voice"
    persona_identity: str = ""
    persona_one_line: str = ""
    persona_tone: str = ""
    rules: VoiceRules = Field(default_factory=VoiceRules)
    distilled_style_md: str = ""
    distilled_at: datetime | None = None
    version: int = 1
    samples: list[VoiceSample] = Field(default_factory=list)
```

- [ ] **Step 4: Run, expect PASS.**

- [ ] **Step 5: Commit** — `feat(voice): pydantic VoiceProfile/VoiceSample/VoiceRules`.

### Task 3: SqlVoiceStore

**Files:**
- Create: `packages/api/blogforge/voice/store.py`
- Test: `packages/api/tests/voice/test_voice_store.py`

Responsibility: get-or-create the user's profile, update persona/rules/distilled, add/delete/toggle samples, bump `version` on any mutation. Mirror `drafts/sql_store.py` (session usage, row→pydantic mapping).

**Imports (avoid the name collision):** the ORM rows and the Pydantic models share names, so alias the ORM rows `...Row` exactly as `drafts/sql_store.py` aliases `Draft`:
`from blogforge.db.models import VoiceProfile as VoiceProfileRow, VoiceSample as VoiceSampleRow` and `from blogforge.voice.models import VoiceProfile, VoiceSample`. `_from_row(row: VoiceProfileRow) -> VoiceProfile` does the mapping.

- [ ] **Step 1: Failing test**

```python
import pytest
from uuid import uuid4
from blogforge.db.models import User
from blogforge.db.session import get_sessionmaker
from blogforge.voice.store import SqlVoiceStore

@pytest.mark.asyncio
async def test_get_or_create_and_mutations(seed_db):
    uid = uuid4()
    async with get_sessionmaker()() as s:
        s.add(User(id=uid, email="a@b.c", password_hash="x", status="approved", role="user")); await s.commit()
    store = SqlVoiceStore()
    p = await store.get_or_create(uid); assert p.name == "My Voice"; v0 = p.version
    await store.update_persona(uid, identity="Builder", one_line="ol", tone="t")
    sample = await store.add_sample(uid, kind="text", name="s", s3_key="k", extracted_chars=5)
    p2 = await store.get(uid); assert p2.version > v0 and len(p2.samples) == 1
    await store.set_exemplar(uid, sample.id, True)
    assert (await store.get(uid)).samples[0].exemplar is True
    await store.delete_sample(uid, sample.id)
    assert (await store.get(uid)).samples == []
```

- [ ] **Step 2: Run, expect ImportError.**

- [ ] **Step 3: Implement** `store.py` with `get`, `get_or_create`, `update_persona`, `update_rules`, `set_distilled`, `add_sample`, `delete_sample`, `set_exemplar`. Every mutation does `profile.version += 1; profile.updated_at = now`. Map ORM→`blogforge.voice.models.VoiceProfile` with a `_from_row` helper (mirror `_draft_from_row`). Scope every query by `user_id` (security: a user only ever touches their own profile).

```python
# Key shape (fill in the rest mirroring drafts/sql_store.py):
async def get_or_create(self, user_id: UUID) -> VoiceProfile:
    async with get_sessionmaker()() as s:
        row = (await s.execute(select(VoiceProfileRow).where(VoiceProfileRow.user_id == user_id))).scalar_one_or_none()
        if row is None:
            row = VoiceProfileRow(user_id=user_id); s.add(row); await s.commit(); await s.refresh(row, ["samples"])
        else:
            await s.refresh(row, ["samples"])
        return _from_row(row)
```

- [ ] **Step 4: Run, expect PASS.**

- [ ] **Step 5: Commit** — `feat(voice): SqlVoiceStore CRUD with version bumping`.

---

## Phase 2 — Ingestion, distillation, materialization

### Task 4: Sample ingestion (reuse references extractors)

**Files:**
- Create: `packages/api/blogforge/voice/ingest.py`
- Test: `packages/api/tests/voice/test_voice_ingest.py`

**Read first:** `packages/api/blogforge/api/references.py` and `packages/api/blogforge/references/` — they already implement: text paste (store verbatim), URL → trafilatura extract, file → extract. Reuse those extractor functions; do not reimplement trafilatura.

Responsibility: `add_text/add_url/add_file` → produce extracted markdown → `put_object("voice/{profile_id}/samples/{sample_id}.md", md.encode(), "text/markdown")` → `store.add_sample(...)`. On extraction error, create the sample with `status="failed"` and `extracted_chars=0`.

- [ ] **Step 1: Failing test** (text path, no network; assert S3 put + sample row)

```python
@pytest.mark.asyncio
async def test_add_text_sample_stores_and_records(seed_db, s3_test):  # s3_test = moto fixture used elsewhere
    from blogforge.voice.ingest import add_text_sample
    from blogforge.voice.store import SqlVoiceStore
    uid = await _seed_user()
    sample = await add_text_sample(uid, name="pasted", text="My writing sample.")
    assert sample.status == "ready" and sample.extracted_chars == len("My writing sample.")
    got = await get_s3_client().get_object(sample.s3_key)
    assert b"My writing sample." in got
```

> Reuse the S3/moto test fixture the references tests use (`packages/api/tests/test_references_*` or `tests/conftest.py`). Mirror its setup.

- [ ] **Step 2: Run, expect ImportError.**

- [ ] **Step 3: Implement** `add_text_sample`, `add_url_sample`, `add_file_sample` using the references extractors + `get_s3_client().put_object`. URL/file extraction failures → `status="failed"`.

- [ ] **Step 4: Run, expect PASS.**

- [ ] **Step 5: Commit** — `feat(voice): sample ingestion (text/url/file) reusing references extractors`.

### Task 5: Distillation

**Files:**
- Create: `packages/api/blogforge/voice/distill.py`
- Test: `packages/api/tests/voice/test_voice_distill.py`

Responsibility: `async def distill_style(sample_texts: list[str], provider, *, model) -> str`. Build one prompt that asks the model to produce a markdown style guide (tone, sentence rhythm, vocabulary, formatting habits, do's & don'ts) **from the samples**, call `provider.complete(model=model, prompt=...)`, return `.text.strip()`. No json_schema (free-form markdown). Truncate very long sample sets to a char budget (e.g. 24k) so the prompt stays bounded.

- [ ] **Step 1: Failing test** (mock provider returns canned markdown)

```python
import pytest
from blogforge.voice.distill import distill_style, _build_prompt
def test_prompt_includes_samples_and_asks_for_style_guide():
    p = _build_prompt(["Sample one.", "Sample two."])
    assert "Sample one." in p and "Sample two." in p
    assert "style guide" in p.lower()

@pytest.mark.asyncio
async def test_distill_returns_provider_markdown(monkeypatch):
    monkeypatch.setenv("BLOGFORGE_TEST_PROVIDER", "mock")
    monkeypatch.setenv("BLOGFORGE_MOCK_OUTPUT", "## Style\nShort sentences.")
    from blogforge.llm.registry import get_provider
    out = await distill_style(["x"], get_provider("anthropic", "k"), model="m")
    assert out == "## Style\nShort sentences."
```

- [ ] **Step 2: Run, expect ImportError.**

- [ ] **Step 3: Implement** `_build_prompt` + `distill_style`.

```python
_MAX_CHARS = 24000
def _build_prompt(sample_texts: list[str]) -> str:
    joined, used = [], 0
    for t in sample_texts:
        t = t.strip()
        if used + len(t) > _MAX_CHARS: break
        joined.append(t); used += len(t)
    body = "\n\n--- SAMPLE ---\n\n".join(joined)
    return ("Analyze the writing samples below and produce a concise markdown style guide that "
            "captures how this author writes: tone, sentence rhythm and length, vocabulary "
            "tendencies, formatting habits, and explicit do's & don'ts. Write it as guidance an "
            "AI could follow to imitate the voice. Output ONLY the markdown style guide.\n\n"
            f"SAMPLES:\n\n{body}")

async def distill_style(sample_texts, provider, *, model):
    resp = await provider.complete(model=model, prompt=_build_prompt(sample_texts))
    return resp.text.strip()
```

- [ ] **Step 4: Run, expect PASS.**

- [ ] **Step 5: Commit** — `feat(voice): distill_style — samples to an editable style guide`.

### Task 6: Pack materialization + export

**Files:**
- Create: `packages/api/blogforge/voice/pack.py`
- Test: `packages/api/tests/voice/test_voice_pack.py`

Responsibility:
- `async def materialize(profile: VoiceProfile, sample_texts: dict[str, str]) -> Path` — write a temp pack dir: `stylepack.yaml` (slug = `profile-{id}`, persona, `banished`, `rules` from `profile.rules`), `style-guide.md` = `profile.distilled_style_md`, `samples/{id}.md` for each **exemplar** sample (text from `sample_texts`), and the matching `samples:` list in the manifest. Cache by `(profile.id, profile.version)` — return the cached dir if it already exists. `sample_texts` is passed in (fetched from S3 by the caller) so this function stays pure/testable.
- `def export_zip(pack_dir: Path) -> bytes` — zip the materialized dir.

Verify the written pack is valid by loading it back: the test calls `myvoice.compose_prompt(pack_root=dir, format=None, samples=[ids], draft=None)` and asserts it returns a non-empty string containing the persona identity.

- [ ] **Step 1: Failing test**

```python
import pytest
from pathlib import Path
from blogforge.voice.models import VoiceProfile, VoiceSample, VoiceRules
from blogforge.voice.pack import materialize, export_zip

@pytest.mark.asyncio
async def test_materialize_writes_valid_pack(tmp_path, monkeypatch):
    monkeypatch.setenv("BLOGFORGE_VOICE_PACK_CACHE", str(tmp_path / "cache"))
    prof = VoiceProfile(id="p1", user_id="u1", persona_identity="The builder who gets it",
        persona_tone="energetic", rules=VoiceRules(banished_words=["leverage"], no_em_dashes=True),
        distilled_style_md="Short sentences.",
        samples=[VoiceSample(id="01", kind="text", name="opener", s3_key="k", exemplar=True)], version=3)
    d = await materialize(prof, {"01": "This is the opener sample."})
    assert (d / "stylepack.yaml").exists()
    assert "Short sentences." in (d / "style-guide.md").read_text()
    assert (d / "samples" / "01.md").read_text().strip() == "This is the opener sample."
    from myvoice import compose_prompt
    sys_prompt = compose_prompt(d, format=None, samples=["01"], draft=None)
    assert "The builder who gets it" in sys_prompt
    z = export_zip(d); assert z[:2] == b"PK"  # zip magic

@pytest.mark.asyncio
async def test_materialize_is_cached_by_version(tmp_path, monkeypatch):
    monkeypatch.setenv("BLOGFORGE_VOICE_PACK_CACHE", str(tmp_path / "cache"))
    prof = VoiceProfile(id="p1", user_id="u1", version=5)
    d1 = await materialize(prof, {}); d2 = await materialize(prof, {})
    assert d1 == d2  # same (id, version) → same dir, not rewritten
```

- [ ] **Step 2: Run, expect ImportError.** Then **Step 3: Implement** `pack.py` (cache dir from `BLOGFORGE_VOICE_PACK_CACHE` env or a temp default; build the manifest dict and `yaml.safe_dump` it; map `VoiceRules` → the `banished:`/`rules:` blocks the `dan` pack uses). **Step 4: Run, expect PASS.** **Step 5: Commit** — `feat(voice): materialize profile to a myvoice pack + export zip`.

---

## Phase 3 — Generation integration

### Task 7: resolve_voice + draft default + wire call sites

**Files:**
- Create: `packages/api/blogforge/voice/resolve.py`
- Modify: `packages/api/blogforge/drafts/models.py` (`IdeaInput.use_voice_profile: bool = True`)
- Modify generation routes (below)
- Test: `packages/api/tests/voice/test_resolve_voice.py`

`resolve_voice(draft, user_id, *, pack_store, voice_store) -> Path` returns a `pack_root`:
- if `draft.idea.use_voice_profile`: `prof = await voice_store.get_or_create(user_id)`; fetch exemplar sample texts from S3; `return await materialize(prof, texts)`.
- else: `return pack_store.get(draft.idea.pack_slug).root_path` (today's behavior).

- [ ] **Step 1: Failing test** (profile path returns a dir with stylepack.yaml; pack path returns the pack root)

```python
@pytest.mark.asyncio
async def test_resolve_uses_profile_when_flag_set(seed_db, s3_test, tmp_path, monkeypatch):
    monkeypatch.setenv("BLOGFORGE_VOICE_PACK_CACHE", str(tmp_path/"c"))
    # ... seed user + profile w/ one exemplar sample in S3 ...
    root = await resolve_voice(draft_with_use_profile_true, uid, pack_store=ps, voice_store=SqlVoiceStore())
    assert (root / "stylepack.yaml").exists()
```

- [ ] **Step 2: Run, expect failure.** **Step 3:** add `use_voice_profile: bool = True` to `IdeaInput`; implement `resolve.py`. **Step 4:** run, expect PASS.

- [ ] **Step 5: Wire call sites** — in each of `expand.py`, `section.py`, `revise.py`, `inline.py`, `repurpose.py`, `headlines.py`, and the outline generation route, replace the `pack_info = pack_store.get(draft.idea.pack_slug)` + `pack_info.root_path` usage with `pack_root = await resolve_voice(draft, current.id, pack_store=..., voice_store=request.app.state.voice_store)`. Keep `manifest` loading from `pack_root / "stylepack.yaml"`. Run the existing generation route tests to confirm no regression: `.venv/bin/python -m pytest packages/api/tests/api -q`.

> The existing tests create drafts without `use_voice_profile`; since it defaults to `True`, seed those test drafts with `use_voice_profile=False` (so they keep using the `dan` pack) OR give the test user a profile. Prefer setting `use_voice_profile=False` in the existing fixtures to keep their behavior unchanged — update `_seed_outlined_draft` / `IdeaInput(...)` test builders accordingly.

- [ ] **Step 6: Commit** — `feat(voice): resolve_voice routes generation through the user profile`.

---

## Phase 4 — API

### Task 8: voice REST router

**Files:**
- Create: `packages/api/blogforge/api/voice.py`
- Modify: `packages/api/blogforge/server.py` (register router; `app.state.voice_store = SqlVoiceStore()`)
- Test: `packages/api/tests/api/test_voice_route.py`

Endpoints (all `Depends(get_current_user)`, scoped to the caller):
- `GET /api/voice` → profile (get-or-create).
- `PUT /api/voice/persona` `{identity, one_line, tone}`; `PUT /api/voice/rules` `{...VoiceRules}`; `PUT /api/voice/distilled` `{distilled_style_md}`.
- `POST /api/voice/samples/text|url|file`, `DELETE /api/voice/samples/{id}`, `PUT /api/voice/samples/{id}/exemplar` `{exemplar}`.
- `POST /api/voice/distill` → runs `distill_style` over current sample texts (provider/model from the user's default or a request body), stores result, returns profile. Missing key → 400 like other routes.
- `GET /api/voice/export` → `export_zip` as a `.zip` download.

- [ ] **Step 1: Failing test** (mock provider; uses the signed-client fixture from `tests/conftest.py`)

```python
def test_get_creates_profile_and_persona_update(voice_client):
    r = voice_client.get("/api/voice"); assert r.status_code == 200 and r.json()["name"] == "My Voice"
    r = voice_client.put("/api/voice/persona", json={"identity":"B","one_line":"o","tone":"t"})
    assert r.status_code == 200 and r.json()["persona_identity"] == "B"

def test_add_text_sample_and_distill(voice_client, monkeypatch):
    monkeypatch.setenv("BLOGFORGE_TEST_PROVIDER","mock"); monkeypatch.setenv("BLOGFORGE_MOCK_OUTPUT","## Style")
    voice_client.post("/api/voice/samples/text", json={"name":"s","text":"hello world"})
    r = voice_client.post("/api/voice/distill", json={})
    assert r.status_code == 200 and "## Style" in r.json()["distilled_style_md"]
```

> Build `voice_client` like the existing signed-client fixtures (`tests/api/test_expand_route.py` shows `_seed_approved_user` + `_signed_client`).

- [ ] **Step 2-4:** Run (fail) → implement router + register → run (pass).

- [ ] **Step 5: Commit** — `feat(voice): REST API for profile, samples, distill, export`.

---

## Phase 5 — Web UI

### Task 9: API client

**Files:**
- Create: `packages/web/src/api/voice.ts`
- Modify: `packages/web/src/api/drafts.ts` (`IdeaInput.use_voice_profile: boolean`)
- Test: `packages/web/tests/api/voice.test.ts` (mirror `tests/api/clients.test.ts`)

- [ ] **Step 1: Failing test** asserting `getVoiceProfile()` calls `GET /api/voice` and `addTextSample` POSTs to the right path (mock `fetch` like `clients.test.ts`).
- [ ] **Step 2-4:** implement types (`VoiceProfile`, `VoiceSample`, `VoiceRules`) + functions (`getVoiceProfile`, `updatePersona`, `updateRules`, `updateDistilled`, `addTextSample`, `addUrlSample`, `uploadSampleFile`, `deleteSample`, `setExemplar`, `distill`, `voiceExportUrl`) → run, pass.
- [ ] **Step 5: Commit** — `feat(web): voice API client`.

### Task 10: Voice screen + components + nav

**Files:**
- Create: `packages/web/src/routes/VoicePage.tsx`, `packages/web/src/components/voice/{PersonaCard,RulesCard,SamplesList,DistilledStyle}.tsx`
- Modify: `packages/web/src/App.tsx` (add `/voice` route), `packages/web/src/components/AppShell.tsx` (nav link "Your Voice")
- Test: `packages/web/tests/routes/VoicePage.test.tsx`

Build the four cards from the approved mockup (`docs/superpowers/specs/...`): Persona (editable fields → `updatePersona` on blur/save), Rules (chips + toggles → `updateRules`), SamplesList (rows with kind icon, word count, ★ exemplar toggle → `setExemplar`, delete; add row with Paste text / Add URL / Upload file), DistilledStyle (textarea + Re-distill button → `distill`, "stale" badge when samples changed since `distilled_at`). Use the existing `nb-*` classes/design system (the liquid-glass reskin is sub-project C). Header shows status + Download pack (`voiceExportUrl`).

- [ ] **Step 1: Failing test** — render `VoicePage` with a mocked `getVoiceProfile` resolving a profile; assert the persona identity and a sample name appear, and clicking the ★ calls `setExemplar`. Mock the voice api module (mirror `tests/routes/DraftPage.test.tsx`).
- [ ] **Step 2-4:** implement components + wire route/nav → `pnpm tsc --noEmit` clean, test passes.
- [ ] **Step 5: Commit** — `feat(web): Your Voice screen (persona, rules, samples, distilled style)`.

---

## Final verification (before opening a PR)

- [ ] `.venv/bin/python -m pytest packages/api/tests -q` → all pass.
- [ ] `cd packages/web && pnpm tsc --noEmit` clean, `pnpm test -- --run` all pass.
- [ ] Rebuild + boot (migration `0013` runs): `docker compose up -d --build api` (or `./scripts/serve-host.sh`), hit `/api/health` → 200, open "Your Voice", add a text sample, distill, and compose a draft with the profile to confirm end-to-end (per `superpowers:verification-before-completion`).
- [ ] Update `README.md` Features/voice section to mention the voice profile.

## Out of scope (do NOT build here)

Facet-based distilled style; multiple profiles per user; auto-distill; "test voice on a paragraph" preview; the IA rework (sub-project B); the liquid-glass visual overhaul (sub-project C).
