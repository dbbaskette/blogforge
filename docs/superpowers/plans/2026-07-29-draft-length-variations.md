# Draft Length Variations Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add preview-first summarized, extended, and LinkedIn length variations that can be saved as separate editable drafts.

**Architecture:** Extend the existing voice-aware repurpose generator with calculated length targets, one correction attempt, and structured measurement metadata. Add a server-side save endpoint that turns an accepted preview into a new sections-stage draft, then surface measurements and saving in the existing Repurpose panel.

**Tech Stack:** Python 3.11, FastAPI, Pydantic, SQLAlchemy, pytest, React 18, TypeScript, React Router, Vitest, Testing Library.

## Global Constraints

- Summarized output targets 50% of the assembled source word count.
- Extended output targets 150% of the assembled source word count.
- Relative outputs accept a range of target ±10%, rounded to whole words.
- LinkedIn output accepts exactly 1,300–1,600 Unicode characters, including whitespace and line breaks.
- Make at most one automatic correction request when a controlled output misses its range.
- A second out-of-range result remains previewable and saveable with a visible warning.
- Saving creates a separate sections-stage draft and never mutates the source draft.
- Saved variations copy provider, model, voice settings, format selection, and tags.
- Saved variations do not copy publication metadata, hero imagery, ideation history, or reference attachments.
- Save actions appear only for individually generated summary, extended, and LinkedIn previews.
- Run the complete API and web suites before delivery.

---

### Task 1: Length-aware repurpose generation

**Files:**
- Modify: `packages/api/blogforge/generate/repurpose.py`
- Modify: `packages/api/tests/generate/test_repurpose.py`

**Interfaces:**
- Consumes: `repurpose(draft, pack_root, manifest, provider, model, body, fmt)`
- Produces: `RepurposeResult(text, length)` where `length` is `LengthMetadata | None`
- Produces: formats `summary`, `extended`, and the revised `linkedin`

- [ ] **Step 1: Write failing generator tests**

Add tests that use a recorder capable of returning sequential outputs:

```python
class _CompleteRecorder:
    def __init__(self, *outputs: str) -> None:
        self.prompts: list[str] = []
        self.outputs = list(outputs or ("repurposed",))

    async def complete(self, *, model: str, prompt: str, json_schema=None) -> LLMResponse:
        self.prompts.append(prompt)
        text = self.outputs[min(len(self.prompts) - 1, len(self.outputs) - 1)]
        return LLMResponse(
            text=text, input_tokens=1, output_tokens=1, model=model, finish_reason="stop"
        )
```

Cover these observable behaviors:

```python
def test_summary_and_extended_have_format_entries() -> None:
    assert FORMATS["summary"]["label"] == "Summarized version"
    assert FORMATS["extended"]["label"] == "Extended version"

@pytest.mark.asyncio
async def test_summary_uses_half_source_words_and_returns_metadata(tmp_path: Path) -> None:
    source = " ".join(f"source{i}" for i in range(200))
    output = " ".join(f"summary{i}" for i in range(100))
    rec = _CompleteRecorder(output)
    result = await repurpose(
        _draft(), _fake_pack(tmp_path), {"samples": []}, rec,
        model="m", body=source, fmt="summary",
    )
    assert result.text == output
    assert result.length is not None
    assert (result.length.minimum, result.length.maximum) == (90, 110)
    assert result.length.actual == 100
    assert result.length.within_target is True
    assert result.length.correction_attempted is False

@pytest.mark.asyncio
async def test_out_of_range_result_retries_once(tmp_path: Path) -> None:
    source = " ".join(f"source{i}" for i in range(200))
    short = " ".join(f"short{i}" for i in range(20))
    corrected = " ".join(f"summary{i}" for i in range(100))
    rec = _CompleteRecorder(short, corrected)
    result = await repurpose(
        _draft(), _fake_pack(tmp_path), {"samples": []}, rec,
        model="m", body=source, fmt="summary",
    )
    assert len(rec.prompts) == 2
    assert "20 words" in rec.prompts[1]
    assert result.length is not None
    assert result.length.correction_attempted is True
    assert result.length.within_target is True

@pytest.mark.asyncio
async def test_second_miss_is_returned_with_warning_metadata(tmp_path: Path) -> None:
    rec = _CompleteRecorder("too short", "still too short")
    result = await repurpose(
        _draft(), _fake_pack(tmp_path), {"samples": []}, rec,
        model="m", body=" ".join(["source"] * 200), fmt="extended",
    )
    assert len(rec.prompts) == 2
    assert result.text == "still too short"
    assert result.length is not None
    assert result.length.within_target is False

@pytest.mark.asyncio
async def test_linkedin_uses_character_range(tmp_path: Path) -> None:
    output = "x" * 1300
    result = await repurpose(
        _draft(), _fake_pack(tmp_path), {"samples": []}, _CompleteRecorder(output),
        model="m", body="source article", fmt="linkedin",
    )
    assert result.length is not None
    assert result.length.metric == "characters"
    assert (result.length.minimum, result.length.maximum) == (1300, 1600)
    assert "1,300 and 1,600 characters" in _build_prompt("body", "linkedin")
```

- [ ] **Step 2: Run the generator tests and verify the new cases fail**

Run:

```bash
uv run pytest packages/api/tests/generate/test_repurpose.py -q
```

Expected: failures because `summary`, `extended`, `RepurposeResult`, and length retry behavior do not exist.

- [ ] **Step 3: Implement targets, measurements, prompts, and retry**

Add explicit result types:

```python
LengthMetric = Literal["words", "characters"]

@dataclass(frozen=True)
class LengthMetadata:
    metric: LengthMetric
    actual: int
    minimum: int
    maximum: int
    within_target: bool
    correction_attempted: bool

@dataclass(frozen=True)
class RepurposeResult:
    text: str
    length: LengthMetadata | None = None
```

Add `summary` and `extended` to `RepurposeFormat` and `FORMATS`. Give both
directives an explicit no-H1 requirement and factual/voice preservation rules.
Replace LinkedIn's 50–299-word rule with:

```python
PromptRule(
    "Keep the feed post between 1,300 and 1,600 characters, including whitespace.",
    "This is the selected LinkedIn feed target while remaining below the platform's 3,000-character maximum.",
)
```

Calculate ranges and measurement centrally:

```python
def _length_range(body: str, fmt: RepurposeFormat) -> tuple[LengthMetric, int, int] | None:
    if fmt == "linkedin":
        return ("characters", 1300, 1600)
    if fmt not in {"summary", "extended"}:
        return None
    source_words = len(body.split())
    factor = 0.5 if fmt == "summary" else 1.5
    target = round(source_words * factor)
    return ("words", max(1, round(target * 0.9)), max(1, round(target * 1.1)))

def _measure(text: str, metric: LengthMetric) -> int:
    return len(text) if metric == "characters" else len(text.split())
```

Have `_build_prompt` accept the calculated range so relative prompts contain
the exact values. In `repurpose`, make the first call, measure it, and make one
correction call only when necessary. Return `RepurposeResult`; return
`length=None` for uncontrolled legacy formats.

- [ ] **Step 4: Run the generator tests and verify they pass**

Run:

```bash
uv run pytest packages/api/tests/generate/test_repurpose.py -q
```

Expected: all generator tests pass with no unexpected warnings.

- [ ] **Step 5: Commit the generator slice**

```bash
git add packages/api/blogforge/generate/repurpose.py packages/api/tests/generate/test_repurpose.py
git commit -m "feat: enforce repurpose length targets"
```

### Task 2: Repurpose API metadata and variation saving

**Files:**
- Modify: `packages/api/blogforge/api/repurpose.py`
- Create: `packages/api/tests/api/test_repurpose_route.py`

**Interfaces:**
- Consumes: `RepurposeResult` from Task 1
- Produces: `POST /api/drafts/{draft_id}/repurpose` with additive `length`
- Produces: `POST /api/drafts/{draft_id}/repurpose/save` returning `Draft`

- [ ] **Step 1: Write failing route tests**

Create helpers that import a completed source draft and tag it:

```python
def _source(client) -> dict[str, object]:
    source = client.post(
        "/api/drafts/import",
        json={
            "text": "# Original\n\n## First\n\nSource text.",
            "pack_slug": "dan",
            "provider": "anthropic",
            "model": "model-a",
            "use_voice_profile": True,
        },
    ).json()
    return client.patch(
        f"/api/drafts/{source['id']}/tags", json={"tags": ["source", "essay"]}
    ).json()
```

Cover save behavior:

```python
@pytest.mark.parametrize(
    ("fmt", "suffix"),
    [("summary", "Summary"), ("extended", "Extended"), ("linkedin", "LinkedIn Post")],
)
async def test_save_variation_creates_editable_tagged_draft(authed_client, fmt, suffix) -> None:
    client, _ = authed_client
    source = _source(client)
    response = client.post(
        f"/api/drafts/{source['id']}/repurpose/save",
        json={"format": fmt, "text": "## Result\n\nGenerated preview text."},
    )
    assert response.status_code == 201
    saved = response.json()
    assert saved["id"] != source["id"]
    assert saved["title"] == f"Original — {suffix}"
    assert saved["stage"] == "sections"
    assert saved["tags"] == ["source", "essay"]
    assert saved["idea"]["provider"] == "anthropic"
    assert saved["sections"][0]["content_md"] == "Generated preview text."
    assert client.get(f"/api/drafts/{source['id']}").json() == source

async def test_save_variation_rejects_blank_preview(authed_client) -> None:
    client, _ = authed_client
    source = _source(client)
    response = client.post(
        f"/api/drafts/{source['id']}/repurpose/save",
        json={"format": "summary", "text": "   "},
    )
    assert response.status_code == 422

async def test_save_variation_rejects_unsupported_format(authed_client) -> None:
    client, _ = authed_client
    source = _source(client)
    response = client.post(
        f"/api/drafts/{source['id']}/repurpose/save",
        json={"format": "email", "text": "Preview"},
    )
    assert response.status_code == 422

async def test_save_variation_is_scoped_to_source_owner(authed_client) -> None:
    owner_client, _ = authed_client
    source = _source(owner_client)
    other_id = await _seed_approved_user("other@user.com")
    with _signed_client(other_id) as other_client:
        response = other_client.post(
            f"/api/drafts/{source['id']}/repurpose/save",
            json={"format": "summary", "text": "Preview"},
        )
        assert response.status_code == 404
```

Also add a route-level generation test that stubs `repurpose` and asserts the
JSON contains `length.metric`, `actual`, `minimum`, `maximum`,
`within_target`, and `correction_attempted`. Assert the saved draft has no
publication metadata, hero image, ideation messages, or references even when
the source has those fields populated.

- [ ] **Step 2: Run route tests and verify they fail**

Run:

```bash
uv run pytest packages/api/tests/api/test_repurpose_route.py -q
```

Expected: failures because the save endpoint and structured response do not exist.

- [ ] **Step 3: Implement structured response and save endpoint**

Define request and response models:

```python
VariationFormat = Literal["summary", "extended", "linkedin"]

class _SaveRepurposeBody(BaseModel):
    format: VariationFormat
    text: str = Field(min_length=1, max_length=200_000)

class _LengthResponse(BaseModel):
    metric: Literal["words", "characters"]
    actual: int
    minimum: int
    maximum: int
    within_target: bool
    correction_attempted: bool
```

Return the generator's text and serialized length metadata from the existing
route. Add `POST /api/drafts/{draft_id}/repurpose/save` with status 201. Copy
the source `IdeaInput` using `model_copy(deep=True)`, apply the authoritative
suffix title, clamp saved `target_words` with
`min(10_000, max(300, len(text.split())))`, ingest
`f"# {title}\n\n{text}"`, set a matching outline and `stage="sections"`, copy
tags, update the new record, emit `draft:created`, and return it. Reject
whitespace-only text with a 422 error.

- [ ] **Step 4: Run route and generator tests**

Run:

```bash
uv run pytest packages/api/tests/api/test_repurpose_route.py packages/api/tests/generate/test_repurpose.py -q
```

Expected: all tests pass.

- [ ] **Step 5: Commit the API slice**

```bash
git add packages/api/blogforge/api/repurpose.py packages/api/tests/api/test_repurpose_route.py
git commit -m "feat: save repurposed previews as drafts"
```

### Task 3: Preview measurements and Save as new draft UI

**Files:**
- Modify: `packages/web/src/api/drafts.ts`
- Modify: `packages/web/src/components/draft/RepurposePanel.tsx`
- Create: `packages/web/tests/components/RepurposePanel.test.tsx`

**Interfaces:**
- Consumes: repurpose response and save endpoint from Task 2
- Produces: `RepurposeResult`, `LengthMetadata`, and `saveRepurposeDraft`
- Produces: preview measurement, miss warning, save state, and navigation

- [ ] **Step 1: Write failing component tests**

Mock the draft API:

```typescript
vi.mock("../../src/api/drafts", () => ({
  listRepurposeFormats: vi.fn().mockResolvedValue([
    { id: "summary", label: "Summarized version" },
    { id: "extended", label: "Extended version" },
    { id: "linkedin", label: "LinkedIn post (feed)" },
  ]),
  repurposeDraft: vi.fn(),
  saveRepurposeDraft: vi.fn(),
}));
```

Cover:

```typescript
it("shows actual and target lengths for a controlled preview", async () => {
  vi.mocked(repurposeDraft).mockResolvedValue({
    format: "summary",
    text: "Short preview",
    length: {
      metric: "words", actual: 100, minimum: 90, maximum: 110,
      within_target: true, correction_attempted: false,
    },
  });
  renderPanel();
  fireEvent.click(await screen.findByRole("button", { name: /summarized version/i }));
  expect(await screen.findByText(/100 words/i)).toBeInTheDocument();
  expect(screen.getByText(/target 90–110/i)).toBeInTheDocument();
});

it("warns but still allows saving an out-of-range preview", async () => {
  vi.mocked(repurposeDraft).mockResolvedValue({
    format: "linkedin",
    text: "Preview",
    length: {
      metric: "characters", actual: 1200, minimum: 1300, maximum: 1600,
      within_target: false, correction_attempted: true,
    },
  });
  renderPanel();
  fireEvent.click(await screen.findByRole("button", { name: /linkedin/i }));
  expect(await screen.findByText(/outside the target range/i)).toBeInTheDocument();
  expect(screen.getByRole("button", { name: /save as new draft/i })).toBeEnabled();
});

it("saves the preview and navigates to the new draft", async () => {
  vi.mocked(repurposeDraft).mockResolvedValue(controlledResult);
  vi.mocked(saveRepurposeDraft).mockResolvedValue({ ...draftFixture, id: "new-draft" });
  renderPanel();
  fireEvent.click(await screen.findByRole("button", { name: /summarized version/i }));
  fireEvent.click(await screen.findByRole("button", { name: /save as new draft/i }));
  await waitFor(() =>
    expect(saveRepurposeDraft).toHaveBeenCalledWith("source", "summary", controlledResult.text),
  );
  expect(await screen.findByTestId("location")).toHaveTextContent("/drafts/new-draft");
});
```

Add a save-rejection test that verifies the preview remains rendered alongside
the error.

- [ ] **Step 2: Run the component test and verify it fails**

Run:

```bash
cd packages/web && pnpm test -- RepurposePanel.test.tsx
```

Expected: failures because the response types, save client, and UI controls do not exist.

- [ ] **Step 3: Add client types and save call**

Add:

```typescript
export type LengthMetric = "words" | "characters";
export interface RepurposeLength {
  metric: LengthMetric;
  actual: number;
  minimum: number;
  maximum: number;
  within_target: boolean;
  correction_attempted: boolean;
}
export interface RepurposeResult {
  format: string;
  text: string;
  length: RepurposeLength | null;
}
export type SavableRepurposeFormat = "summary" | "extended" | "linkedin";

export async function saveRepurposeDraft(
  draftId: string,
  format: SavableRepurposeFormat,
  text: string,
): Promise<Draft> {
  return api(`/api/drafts/${encodeURIComponent(draftId)}/repurpose/save`, {
    method: "POST",
    body: JSON.stringify({ format, text }),
  });
}
```

Update `repurposeDraft` to return `Promise<RepurposeResult>`.

- [ ] **Step 4: Implement the preview controls**

Store the complete `RepurposeResult` for single-preview state. Use
`useNavigate()`. After `PreviewCard`, render metadata as:

```tsx
<p className="mt-2 text-xs text-muted">
  {length.actual.toLocaleString()} {length.metric} · target{" "}
  {length.minimum.toLocaleString()}–{length.maximum.toLocaleString()}
</p>
```

When `within_target` is false, show “This result is outside the target range
after one adjustment. You can still copy or save it.” For `summary`,
`extended`, and `linkedin`, render **Save as new draft**. Disable it while
saving, preserve the preview on errors, and navigate to `/drafts/${saved.id}`
after success. Do not add save actions to atomize-all cards.

- [ ] **Step 5: Run the component test and web type/build checks**

Run:

```bash
cd packages/web
pnpm test -- RepurposePanel.test.tsx
pnpm build
```

Expected: tests and TypeScript build pass.

- [ ] **Step 6: Commit the frontend slice**

```bash
git add packages/web/src/api/drafts.ts packages/web/src/components/draft/RepurposePanel.tsx packages/web/tests/components/RepurposePanel.test.tsx
git commit -m "feat: save length variations from previews"
```

### Task 4: Release version and complete verification

**Files:**
- Modify: `packages/web/package.json`
- Modify: `packages/api/blogforge/__init__.py`

**Interfaces:**
- Consumes: completed backend and frontend slices
- Produces: synchronized feature release version

- [ ] **Step 1: Bump the feature release**

Run:

```bash
scripts/version.sh minor
scripts/version.sh check
```

Expected: both version files advance from 0.8.3 to 0.9.0 and report in sync.

- [ ] **Step 2: Run formatters on touched source and tests**

Run:

```bash
uv run ruff format packages/api/blogforge/generate/repurpose.py packages/api/blogforge/api/repurpose.py packages/api/tests/generate/test_repurpose.py packages/api/tests/api/test_repurpose_route.py
cd packages/web && pnpm exec biome check --write src/api/drafts.ts src/components/draft/RepurposePanel.tsx tests/components/RepurposePanel.test.tsx
```

- [ ] **Step 3: Run full verification once**

Run:

```bash
make test
make lint
scripts/version.sh check
git diff --check
```

Expected: complete API and web tests, Ruff, mypy, Biome, web build, version
check, and whitespace validation all pass.

- [ ] **Step 4: Commit the release version and any formatting**

```bash
git add packages/web/package.json packages/api/blogforge/__init__.py packages/api packages/web
git commit -m "chore: release BlogForge 0.9.0"
```

### Task 5: PR, merge, home-services deployment, and remote verification

**Files:**
- No source files expected.

**Interfaces:**
- Consumes: verified feature branch
- Produces: merged `origin/main` and a healthy 0.9.0 home-services deployment

- [ ] **Step 1: Push and create the pull request**

Run:

```bash
git push -u origin codex/draft-length-variations
gh pr create --base main --head codex/draft-length-variations \
  --title "Add saved draft length variations" \
  --body "Adds summarized, extended, and character-targeted LinkedIn previews with one automatic length correction and Save as new draft."
```

- [ ] **Step 2: Inspect checks and merge**

Run:

```bash
gh pr checks --watch
gh pr merge --squash --delete-branch
```

Expected: required checks pass and GitHub reports the PR merged.

- [ ] **Step 3: Fast-forward local main**

Run:

```bash
git checkout main
git pull --ff-only origin main
```

Expected: local `HEAD` equals `origin/main`.

- [ ] **Step 4: Deploy through the remote Tailscale hostname**

Run:

```bash
BLOGFORGE_DEPLOY_HOST=home-services.tail7a35ba.ts.net scripts/deploy-home.sh
```

Expected: the remote checkout fast-forwards to the merged SHA, redeploys, and
reports matching internal and public health versions.

- [ ] **Step 5: Verify the remote service directly**

Run:

```bash
ssh -o BatchMode=yes -o ConnectTimeout=10 \
  home-services.tail7a35ba.ts.net \
  'curl -fsS --max-time 10 http://127.0.0.1:7880/api/health'
curl -fsS --max-time 15 https://blogforge.baskettecase.com/api/health
```

Expected: both responses report version 0.9.0 and the merged deployment SHA is
the SHA reported by the deployment script.
