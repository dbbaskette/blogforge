# Bound Tanzu GenAI Models Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Expose the bound `tanzu-all-models` GenAI service as a keyless `tanzu` provider offering 3 chat models, via the existing `build_provider_for` seam.

**Architecture:** `config/tanzu.py` parses the binding → `BLOGFORGE_TANZU_*` settings; an OpenAI-compatible `TanzuProvider` (parameterized base URL) reads those settings; `build_provider_for` resolves `tanzu` keylessly; the providers API + SetupFields surface it when bound.

**Tech Stack:** FastAPI, httpx, pydantic-settings, React/TS, pytest.

> **Spec:** `docs/superpowers/specs/2026-06-19-bound-tanzu-models-design.md`
> **Facts:** `ModelInfo(id, label, context_window: int, supports_streaming: bool, input_per_million_usd: float|None, output_per_million_usd: float|None)`. `build_provider_for` (in `llm/resolve.py`) already special-cases `claude-cli` keyless + honors `BLOGFORGE_TEST_PROVIDER=mock`. `config/tanzu.py` has `_apply_postgres`/`_apply_s3`/`_set_if_unset`; `apply_vcap_services` calls them. Settings uses `Annotated[list[str], NoDecode]` + a `split_csv` validator for comma envs.

---

## Task 1: Settings + VCAP parsing

**Files:** Modify `packages/api/blogforge/config/settings.py`, `packages/api/blogforge/config/tanzu.py`; Test `packages/api/tests/test_tanzu_genai_config.py`

- [ ] **Step 1: Add settings.** In `config/settings.py`, after the existing fields add:
```python
    tanzu_api_base: str = ""
    tanzu_api_key: str = ""
    tanzu_models: Annotated[list[str], NoDecode] = Field(default_factory=lambda: [
        "openai/gpt-oss-120b", "Qwen/Qwen3.5-27B-GPTQ-Int4", "google/gemma-4-31B-it",
    ])
```
and a validator (model ids are case-sensitive — strip only, do NOT lowercase):
```python
    @field_validator("tanzu_models", mode="before")
    @classmethod
    def _split_tanzu_models(cls, v: object) -> object:
        if isinstance(v, str):
            return [s.strip() for s in v.split(",") if s.strip()]
        return v
```

- [ ] **Step 2: Write failing VCAP test** `packages/api/tests/test_tanzu_genai_config.py`:
```python
import json
from blogforge.config.tanzu import apply_vcap_services


def test_genai_binding_sets_tanzu_env(monkeypatch) -> None:
    monkeypatch.delenv("BLOGFORGE_TANZU_API_BASE", raising=False)
    monkeypatch.delenv("BLOGFORGE_TANZU_API_KEY", raising=False)
    monkeypatch.setenv("VCAP_SERVICES", json.dumps({
        "genai": [{
            "name": "tanzu-all-models",
            "credentials": {"api_base": "https://genai.example/v1", "api_key": "tz-secret"},
        }]
    }))
    apply_vcap_services()
    import os
    assert os.environ["BLOGFORGE_TANZU_API_BASE"] == "https://genai.example/v1"
    assert os.environ["BLOGFORGE_TANZU_API_KEY"] == "tz-secret"


def test_no_binding_is_noop(monkeypatch) -> None:
    monkeypatch.delenv("BLOGFORGE_TANZU_API_BASE", raising=False)
    monkeypatch.setenv("VCAP_SERVICES", json.dumps({"postgresql": []}))
    apply_vcap_services()
    import os
    assert "BLOGFORGE_TANZU_API_BASE" not in os.environ
```

- [ ] **Step 3: Run → FAIL** (`_apply_genai` not wired).

- [ ] **Step 4: Implement `_apply_genai`** in `config/tanzu.py` and call it from `apply_vcap_services` (after `_apply_s3(instances)`):
```python
def _apply_genai(instances: list[tuple[str, dict[str, Any]]]) -> None:
    for label, inst in instances:
        if label not in ("genai", "tanzu-genai") and inst.get("name") != "tanzu-all-models":
            continue
        creds = inst.get("credentials", {}) or {}
        base = creds.get("api_base") or creds.get("endpoint") or creds.get("url") or creds.get("uri")
        key = (creds.get("api_key") or creds.get("apiKey") or creds.get("key")
               or (creds.get("credentials") or {}).get("api_key"))
        if base:
            _set_if_unset("BLOGFORGE_TANZU_API_BASE", base)
        if key:
            _set_if_unset("BLOGFORGE_TANZU_API_KEY", key)
        return
```

- [ ] **Step 5: Run → PASS** `.venv/bin/python -m pytest packages/api/tests/test_tanzu_genai_config.py -q` (2 passed).

- [ ] **Step 6: Commit**
```bash
git add packages/api/blogforge/config/settings.py packages/api/blogforge/config/tanzu.py packages/api/tests/test_tanzu_genai_config.py
git commit -m "feat(cf): parse tanzu-all-models binding + BLOGFORGE_TANZU_* settings"
```

---

## Task 2: TanzuProvider + resolution

**Files:** Modify `packages/api/blogforge/llm/openai.py`, `packages/api/blogforge/llm/registry.py`, `packages/api/blogforge/llm/resolve.py`; Create `packages/api/blogforge/llm/tanzu.py`; Test `packages/api/tests/llm/test_tanzu_provider.py`

- [ ] **Step 1: Parameterize the OpenAI base URL.** In `llm/openai.py`, change `__init__` to `def __init__(self, api_key: str, base_url: str | None = None) -> None:` and set `self._base_url = (base_url or _BASE_URL).rstrip("/")`. Replace every `f"{_BASE_URL}…"` in `list_models`/`complete`/`stream`/anywhere with `f"{self._base_url}…"`. Default behavior for `openai` unchanged.

- [ ] **Step 2: Failing TanzuProvider tests** `packages/api/tests/llm/test_tanzu_provider.py`:
```python
from blogforge.llm.tanzu import TanzuProvider


async def test_list_models_returns_configured(monkeypatch) -> None:
    monkeypatch.setenv("BLOGFORGE_TANZU_API_BASE", "https://g/v1")
    monkeypatch.setenv("BLOGFORGE_TANZU_API_KEY", "k")
    monkeypatch.setenv("BLOGFORGE_TANZU_MODELS", "modelA,modelB")
    from blogforge.config import settings as s; s.get_settings.cache_clear()
    p = TanzuProvider.from_settings()
    ids = [m.id for m in await p.list_models()]
    assert ids == ["modelA", "modelB"]
    assert all("nomic" not in i for i in ids)
```

- [ ] **Step 3: Implement `packages/api/blogforge/llm/tanzu.py`:**
```python
"""Tanzu GenAI provider — OpenAI-compatible gateway bound via VCAP_SERVICES (keyless to the user)."""
from __future__ import annotations

from blogforge.config import get_settings
from blogforge.llm.base import ModelInfo
from blogforge.llm.openai import OpenAIProvider


class TanzuProvider(OpenAIProvider):
    name = "tanzu"

    def __init__(self, api_key: str, base_url: str, models: list[str]) -> None:
        super().__init__(api_key=api_key, base_url=base_url)
        self._models = list(models)

    async def list_models(self) -> list[ModelInfo]:
        return [
            ModelInfo(id=m, label=m, context_window=32768, supports_streaming=True,
                      input_per_million_usd=None, output_per_million_usd=None)
            for m in self._models
        ]

    @classmethod
    def from_settings(cls) -> "TanzuProvider":
        s = get_settings()
        return cls(api_key=s.tanzu_api_key or "bound", base_url=s.tanzu_api_base, models=s.tanzu_models)
```
> `api_key or "bound"`: `OpenAIProvider.__init__` raises on an empty key; the binding always supplies one in prod, but the fallback keeps `from_settings()` constructible in tests that don't set a key. The base URL must be set for real calls.

- [ ] **Step 4: Register + resolve.**
  - `llm/registry.py`: import `TanzuProvider`; add to `_FACTORIES`: `"tanzu": lambda _api_key: TanzuProvider.from_settings(),`.
  - `llm/resolve.py`: change the keyless branch to include tanzu:
    ```python
    if provider in ("claude-cli", "tanzu"):
        return get_provider(provider, "")
    ```

- [ ] **Step 5: Run → PASS** `.venv/bin/python -m pytest packages/api/tests/llm/test_tanzu_provider.py packages/api/tests/llm/test_resolve.py -q`.

- [ ] **Step 6: Commit**
```bash
git add packages/api/blogforge/llm/openai.py packages/api/blogforge/llm/tanzu.py packages/api/blogforge/llm/registry.py packages/api/blogforge/llm/resolve.py packages/api/tests/llm/test_tanzu_provider.py
git commit -m "feat(llm): TanzuProvider (OpenAI-compatible, keyless) + registry/resolve wiring"
```

---

## Task 3: Providers API, frontend label, deploy wiring

**Files:** Modify `packages/api/blogforge/api/providers.py`, `packages/web/src/components/SetupFields.tsx`, `manifest.yml`, `docs/cf-deploy.md`; Test `packages/api/tests/api/test_providers_tanzu.py`

- [ ] **Step 1: Failing providers test** `packages/api/tests/api/test_providers_tanzu.py`:
```python
def test_tanzu_available_and_models(authed_client, monkeypatch) -> None:
    monkeypatch.setenv("BLOGFORGE_TANZU_API_BASE", "https://g/v1")
    monkeypatch.setenv("BLOGFORGE_TANZU_API_KEY", "k")
    from blogforge.config import settings as s; s.get_settings.cache_clear()
    client, _ = authed_client
    assert client.get("/api/providers").json().get("tanzu") is True
    ids = [m["id"] for m in client.get("/api/providers/tanzu/models").json()]
    assert "openai/gpt-oss-120b" in ids and all("nomic" not in i for i in ids)

def test_tanzu_absent_when_unconfigured(authed_client, monkeypatch) -> None:
    monkeypatch.delenv("BLOGFORGE_TANZU_API_BASE", raising=False)
    monkeypatch.delenv("BLOGFORGE_TANZU_API_KEY", raising=False)
    from blogforge.config import settings as s; s.get_settings.cache_clear()
    client, _ = authed_client
    assert client.get("/api/providers").json().get("tanzu") is False
```

- [ ] **Step 2: Run → FAIL.**

- [ ] **Step 3: Update `api/providers.py`.**
  - In `list_providers`, after building `out`, add: `s = get_settings(); out["tanzu"] = bool(s.tanzu_api_base and s.tanzu_api_key)` (import `from blogforge.config import get_settings`).
  - In `list_models`, add a short-circuit before the `SUPPORTED_PROVIDERS` check (mirroring the `claude-cli` one):
    ```python
    if provider == "tanzu":
        from blogforge.llm.registry import get_provider
        return [m.model_dump() for m in await get_provider("tanzu", "").list_models()]
    ```

- [ ] **Step 4: Run → PASS** `.venv/bin/python -m pytest packages/api/tests/api/test_providers_tanzu.py -q`; then full suite `.venv/bin/python -m pytest packages/api -q`.

- [ ] **Step 5: Frontend label.** In `packages/web/src/components/SetupFields.tsx`, find the provider option rendering (it maps over the `/api/providers` availability keys). Add a label map entry so `tanzu` displays as `"Tanzu"` (and `anthropic`→"Anthropic", `google`→"Google", `openai`→"OpenAI", `claude-cli`→whatever it currently shows) — if a label map already exists, add `tanzu: "Tanzu"`; if labels are derived from the key, add a small `PROVIDER_LABELS` record with a fallback to the raw key. Verify `./node_modules/.bin/tsc --noEmit` is clean and `./node_modules/.bin/vitest run` is green.

- [ ] **Step 6: Deploy wiring.**
  - `manifest.yml`: add `- tanzu-all-models` to the `services:` list.
  - `docs/cf-deploy.md`: under one-time setup, note: ensure a `tanzu-all-models` GenAI service instance exists + is bound (it populates `BLOGFORGE_TANZU_API_BASE/KEY` automatically); to change the offered models, `cf set-env <app> BLOGFORGE_TANZU_MODELS "<comma,ids>"`.

- [ ] **Step 7: Commit**
```bash
git add packages/api/blogforge/api/providers.py packages/web/src/components/SetupFields.tsx manifest.yml docs/cf-deploy.md packages/api/tests/api/test_providers_tanzu.py
git commit -m "feat: surface bound Tanzu models in providers API + picker; bind service in manifest"
```

---

## Self-Review Notes
- **Spec coverage:** VCAP parse + settings → T1; OpenAI base_url + TanzuProvider + registry + resolve → T2; providers API + frontend + manifest/docs → T3.
- **Type consistency:** `ModelInfo(id, label, context_window, supports_streaming, input/output_per_million_usd)` used in T2; `TanzuProvider.from_settings()` used by the registry (T2) + providers API (T3); `tanzu` keyless in `build_provider_for` (T2) + providers short-circuit (T3).
- **Adapt-on-contact:** the real GenAI binding credential field names (T1 — flexible matching covers common shapes); the `SetupFields` provider-label mechanism (T3/Step 5); confirm `apply_vcap_services` import path for the `_apply_genai` call.
