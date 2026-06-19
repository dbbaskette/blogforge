# Bound Tanzu GenAI Models — Design Spec

**Date:** 2026-06-19
**Status:** Approved (design), pending implementation plan.
**Scope:** Bind the `tanzu-all-models` GenAI service on Tanzu and expose its chat models as a **keyless** provider option (`tanzu`) alongside the per-user Anthropic/OpenAI/Google providers. Second of two sub-projects; extends the `build_provider_for` seam from per-user keys.

## Goal
- When `tanzu-all-models` is bound, a `tanzu` provider appears in the model picker; selecting it lists the bound **chat** models and generates through the bound OpenAI-compatible endpoint — **no user API key required** (uses the binding credentials).
- Locally (no binding) `tanzu` is simply unavailable; nothing else changes.

## Decisions (locked)
- Models offered (chat): `openai/gpt-oss-120b`, `Qwen/Qwen3.5-27B-GPTQ-Int4`, `google/gemma-4-31B-it`. **Excluded:** `nomic-ai/nomic-embed-text-v2-moe` (an embedding model — not usable for drafting).
- The Tanzu endpoint is **OpenAI-compatible** (chat completions); reuse the OpenAI adapter with a parameterized base URL.
- `tanzu` is **keyless** to the user (binding creds), like `claude-cli` — resolved via the `build_provider_for` seam.

## Architecture

### 1 · VCAP parsing (`config/tanzu.py`)
Add `_apply_genai(instances)` (called from `apply_vcap_services`), mirroring `_apply_postgres`/`_apply_s3`:
- Match by `label in ("genai", "tanzu-genai")` **or** `inst.get("name") == "tanzu-all-models"`.
- From `credentials`, read the OpenAI-compatible base URL (`api_base` / `endpoint` / `url` / `uri`) and the key (`api_key` / `apiKey` / `key` / nested `credentials.api_key`).
- `_set_if_unset("BLOGFORGE_TANZU_API_BASE", base)` and `_set_if_unset("BLOGFORGE_TANZU_API_KEY", key)`.
- Tolerant of missing fields (no binding → no-op).

### 2 · Settings (`config/settings.py`)
```python
tanzu_api_base: str = ""
tanzu_api_key: str = ""
tanzu_models: Annotated[list[str], NoDecode] = Field(default_factory=lambda: [
    "openai/gpt-oss-120b", "Qwen/Qwen3.5-27B-GPTQ-Int4", "google/gemma-4-31B-it",
])
```
`tanzu_models` parsed from comma-separated env (reuse the `split_csv`-style validator, no lowercasing — model ids are case-sensitive). `tanzu_configured` = `bool(tanzu_api_base and tanzu_api_key)` (a helper or inline check).

### 3 · Parameterize the OpenAI adapter (`llm/openai.py`)
- `__init__(self, api_key: str, base_url: str | None = None)` → `self._base_url = (base_url or _BASE_URL).rstrip("/")`. Replace the module `_BASE_URL` uses in `list_models`/`complete`/`stream` with `self._base_url`. Default behavior unchanged for `openai`.

### 4 · `TanzuProvider` (`llm/tanzu.py`, new)
```python
class TanzuProvider(OpenAIProvider):
    name = "tanzu"
    def __init__(self, api_key, base_url, models):
        super().__init__(api_key=api_key, base_url=base_url)
        self._models = list(models)
    async def list_models(self) -> list[ModelInfo]:
        # The bound gateway may not expose /models (or lists embeddings too);
        # return the configured chat models, with no pricing.
        return [ModelInfo(id=m, name=m, input_per_million_usd=None, output_per_million_usd=None) for m in self._models]

    @classmethod
    def from_settings(cls) -> "TanzuProvider":
        s = get_settings()
        return cls(api_key=s.tanzu_api_key, base_url=s.tanzu_api_base, models=s.tanzu_models)
```
`complete`/`stream` are inherited (OpenAI-compatible chat). Confirm the real `ModelInfo` fields and construct accordingly.

### 5 · Registry + resolution
- `llm/registry.py`: add `"tanzu": lambda _api_key: TanzuProvider.from_settings()` to `_FACTORIES` (ignores the passed key — reads settings). `get_provider("tanzu", "")` works.
- `llm/resolve.py` `build_provider_for`: after the mock check, treat `tanzu` like `claude-cli` (keyless): `if provider in ("claude-cli", "tanzu"): return get_provider(provider, "")`.

### 6 · Providers API (`api/providers.py`)
- `list_providers`: add `out["tanzu"] = get_settings().tanzu_configured` (or the inline `bool(base and key)`).
- `list_models`: for `provider == "tanzu"`, return `get_provider("tanzu", "").list_models()` (no per-user key lookup) — add a short-circuit like the existing `claude-cli` one.

### 7 · Frontend (`SetupFields.tsx`)
The provider dropdown is driven by the `/api/providers` availability map, so `tanzu` appears automatically when available. Add a display label `tanzu → "Tanzu"` to whatever provider-label map the component uses (and ensure an unknown provider falls back to its key as the label). Models load via the existing `/providers/tanzu/models` path. No key-entry needed for `tanzu` (it's not in `SUPPORTED_PROVIDERS`, so the Settings keys card ignores it).

### 8 · Deploy wiring (`manifest.yml`, `docs/cf-deploy.md`)
- Add `tanzu-all-models` to the manifest `services:` list.
- Document: `cf create-service` (or have the operator bind an existing `tanzu-all-models` instance); the GenAI binding populates `BLOGFORGE_TANZU_API_BASE/KEY` via `_apply_genai`. To adjust the model list: `cf set-env <app> BLOGFORGE_TANZU_MODELS "<comma,separated,ids>"`.

## Testing
- **`_apply_genai`**: given a `VCAP_SERVICES` JSON with a `tanzu-all-models` instance → sets `BLOGFORGE_TANZU_API_BASE/KEY`; absent binding → no-op; respects already-set env (`_set_if_unset`).
- **`TanzuProvider.list_models`**: returns exactly the configured `tanzu_models` (3 chat models; no embedding model); `from_settings()` reads settings.
- **`build_provider_for(user, "tanzu")`**: returns a `TanzuProvider` with **no user key** stored (keyless); honors the mock env.
- **`/api/providers`** (authed): includes `tanzu: true` when `tanzu_api_base`+`key` set (else `false`); `/providers/tanzu/models` returns the 3 models without a user key.
- Existing suite + web `tsc` green.

## Out of scope
- The embedding model / any embedding feature (BlogForge has none).
- Hero images via Tanzu (Imagen stays Google-only; unchanged).
- Per-model pricing for Tanzu (unknown; `null`).

## Success criteria
1. With `tanzu-all-models` bound (or `BLOGFORGE_TANZU_API_BASE/KEY` set locally), `tanzu` appears in the provider picker and lists the 3 chat models; a draft generates through it with no user key.
2. Without the binding, `tanzu` is absent and nothing else changes.
3. `nomic-embed` is never offered for drafting.
4. New tests pass; existing API suite + web `tsc` green.
