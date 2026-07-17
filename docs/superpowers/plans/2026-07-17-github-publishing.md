# Per-user GitHub Publishing Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the browser-dependent GitHub new-file flow with a one-click server-side direct commit to each user's configured private or public content repository.

**Architecture:** Store one destination per user in a dedicated SQL table and store that user's PAT encrypted in the existing `user_provider_keys` table under a separate `github-publishing` namespace. A focused GitHub Contents API client and publishing service validate access, create or update a stable file path, and persist publication metadata only after GitHub confirms the commit. The web Settings card owns configuration; the publish dialog becomes a status-and-confirmation surface.

**Tech Stack:** FastAPI, Pydantic, SQLAlchemy/Alembic, httpx, cryptography/Fernet, React 18, TypeScript, Vitest, pytest/respx, GitHub Contents API.

## Global Constraints

- One publishing destination per BlogForge user.
- Direct commits only; no pull requests.
- A first publish fixes the GitHub path; title changes never create a second file.
- Tokens are encrypted at rest, never returned by an API, and never logged.
- Fine-grained PAT recommendation: selected repository plus Contents read/write.
- Existing read-only GitHub sign-in OAuth scopes remain unchanged.
- Publication metadata changes only after a confirmed GitHub commit.
- Release version is `0.8.0` in both web and API version sources.

---

### Task 1: Persist per-user publishing configuration and encrypted tokens

**Files:**
- Modify: `packages/api/blogforge/db/models.py`
- Create: `packages/api/alembic/versions/0018_github_publishing.py`
- Create: `packages/api/blogforge/publishing/__init__.py`
- Create: `packages/api/blogforge/publishing/models.py`
- Create: `packages/api/blogforge/publishing/token_vault.py`
- Modify: `packages/api/blogforge/drafts/models.py`
- Modify: `packages/api/blogforge/drafts/sql_store.py`
- Test: `packages/api/tests/test_publishing_models.py`
- Test: `packages/api/tests/test_publishing_token_vault.py`

**Interfaces:**
- Produces `UserPublishingSettings` ORM row keyed by `user_id`.
- Produces `PublishingSettings`, `PublishingPreset`, and publication fields on `Draft`.
- Produces `PublishingTokenVault(user_id).get/set/delete/is_set`.
- Produces `SqlDraftStore.record_publication(...) -> Draft | None`.

- [ ] **Step 1: Write failing model and vault tests**

```python
async def test_token_is_encrypted_and_user_scoped(monkeypatch):
    monkeypatch.setenv("BLOGFORGE_SESSION_SECRET", "publishing-secret")
    await PublishingTokenVault(user_a).set("github_pat_secret")
    assert await PublishingTokenVault(user_a).get() == "github_pat_secret"
    assert await PublishingTokenVault(user_b).get() == ""
    row = await session.scalar(select(UserProviderKey).where(
        UserProviderKey.user_id == user_a,
        UserProviderKey.provider == "github-publishing",
    ))
    assert row is not None and "github_pat_secret" not in row.encrypted_key
```

```python
def test_publishing_settings_defaults():
    row = UserPublishingSettings(user_id=uuid4(), owner="dan", repo="blog")
    assert row.branch == "main"
    assert row.content_dir == "content/posts"
    assert row.frontmatter_preset == "hugo"
```

- [ ] **Step 2: Run tests and confirm missing types fail**

Run: `uv run pytest packages/api/tests/test_publishing_models.py packages/api/tests/test_publishing_token_vault.py -q`

Expected: collection fails because the publishing model and vault modules do not exist.

- [ ] **Step 3: Add ORM rows and migration**

Add `UserPublishingSettings` with `user_id`, `owner`, `repo`, `branch`, `content_dir`, `frontmatter_preset`, timestamps, and add nullable `published_at`, `published_path`, `published_sha`, and `published_commit_url` columns to `Draft`. Migration `0018_github_publishing` creates the settings table and draft columns; downgrade removes them.

- [ ] **Step 4: Implement the token vault**

```python
PUBLISHING_PROVIDER = "github-publishing"

class PublishingTokenVault:
    def __init__(self, user_id: UUID) -> None:
        self._user_id = user_id

    async def get(self) -> str:
        row = await self._load()
        if row is None:
            return ""
        try:
            return SecretCipher(get_settings().session_secret).decrypt(row.encrypted_key)
        except InvalidToken:
            logger.warning("GitHub publishing token cannot be decrypted; treating as unset")
            return ""

    async def set(self, token: str) -> None:
        if not token.strip():
            raise ValueError("token must not be empty")
        # Encrypt and insert/update the github-publishing row for this user.
```

- [ ] **Step 5: Carry publication metadata through draft mapping and add atomic recording**

```python
async def record_publication(
    self,
    draft_id: str,
    *,
    user_id: UUID,
    published_at: datetime,
    published_path: str,
    published_sha: str,
    published_commit_url: str,
) -> Draft | None:
    # Scope by both draft id and user id, update only publication columns,
    # commit, refresh relationships, and return _draft_from_row(row).
```

- [ ] **Step 6: Run focused tests**

Run: `uv run pytest packages/api/tests/test_publishing_models.py packages/api/tests/test_publishing_token_vault.py packages/api/tests/test_sqlite_schema_sync.py -q`

Expected: all pass.

- [ ] **Step 7: Commit**

```bash
git add packages/api/blogforge/db packages/api/blogforge/drafts packages/api/blogforge/publishing packages/api/alembic/versions/0018_github_publishing.py packages/api/tests/test_publishing_models.py packages/api/tests/test_publishing_token_vault.py
git commit -m "feat: store per-user GitHub publishing settings"
```

### Task 2: Build the GitHub Contents API client

**Files:**
- Create: `packages/api/blogforge/publishing/github_client.py`
- Test: `packages/api/tests/publishing/test_github_client.py`

**Interfaces:**
- Produces `GitHubPublisherClient(token: str, transport: httpx.AsyncBaseTransport | None = None)`.
- Produces `validate_destination(owner, repo, branch) -> GitHubIdentityAccess`.
- Produces `get_content(owner, repo, branch, path) -> GitHubContent | None`.
- Produces `put_content(..., content, message, expected_sha) -> GitHubCommitResult`.
- Produces stable `PublishingError(code, message, status_code, retry_after=None)`.

- [ ] **Step 1: Write failing respx tests for validation and content writes**

Cover authenticated login, private repository access, missing branch, no push permission, missing content, first create, SHA update, 401, 403, 404, 409/422 conflict, 429/rate-limit, timeout, and 5xx.

```python
@respx.mock
async def test_update_sends_expected_sha():
    respx.put("https://api.github.com/repos/dan/blog/contents/posts/a.md").mock(
        return_value=httpx.Response(200, json={
            "content": {"sha": "new-blob", "html_url": "https://github.com/dan/blog/blob/main/posts/a.md"},
            "commit": {"sha": "commit-sha", "html_url": "https://github.com/dan/blog/commit/commit-sha"},
        })
    )
    result = await client.put_content("dan", "blog", "main", "posts/a.md", "# A", "Update: A", "old-blob")
    request = respx.calls.last.request
    assert request.json()["sha"] == "old-blob"
    assert result.content_sha == "new-blob"
```

- [ ] **Step 2: Run tests and confirm the client is missing**

Run: `uv run pytest packages/api/tests/publishing/test_github_client.py -q`

Expected: collection fails because `github_client.py` does not exist.

- [ ] **Step 3: Implement the focused client**

Use `Authorization: Bearer <token>`, `Accept: application/vnd.github+json`, and `X-GitHub-Api-Version: 2022-11-28`. Encode Markdown with `base64.b64encode(content.encode()).decode()`. Never include response request headers or token text in raised messages.

```python
payload = {"message": message, "content": encoded, "branch": branch}
if expected_sha is not None:
    payload["sha"] = expected_sha
response = await self._request("PUT", f"/repos/{owner}/{repo}/contents/{quoted_path}", json=payload)
```

- [ ] **Step 4: Run client tests**

Run: `uv run pytest packages/api/tests/publishing/test_github_client.py -q`

Expected: all pass.

- [ ] **Step 5: Commit**

```bash
git add packages/api/blogforge/publishing/github_client.py packages/api/tests/publishing/test_github_client.py
git commit -m "feat: add GitHub contents publishing client"
```

### Task 3: Add publishing settings and validation APIs

**Files:**
- Create: `packages/api/blogforge/publishing/settings_store.py`
- Create: `packages/api/blogforge/api/publishing.py`
- Modify: `packages/api/blogforge/server.py`
- Test: `packages/api/tests/api/test_publishing_settings_route.py`

**Interfaces:**
- Produces `GET/PUT /api/publishing/settings`.
- Produces `PUT/DELETE /api/publishing/token`.
- Produces `POST /api/publishing/validate`.
- Settings response fields: `owner`, `repo`, `branch`, `content_dir`, `frontmatter_preset`, `token_set`, `validated_login`, `ready`.

- [ ] **Step 1: Write failing authenticated route tests**

```python
def test_settings_never_return_token(authed_client):
    client, _ = authed_client
    assert client.put("/api/publishing/token", json={"token": "github_pat_secret"}).status_code == 200
    body = client.get("/api/publishing/settings").json()
    assert body["token_set"] is True
    assert "token" not in body
    assert "github_pat_secret" not in str(body)
```

Also test two-user isolation, trim/normalize fields, traversal rejection, invalid preset, token clear preserving destination, validation success, missing token, invalid token, missing repo/branch, and forbidden writes. Mock `GitHubPublisherClient` so route tests do not call the network.

- [ ] **Step 2: Run tests and confirm 404s**

Run: `uv run pytest packages/api/tests/api/test_publishing_settings_route.py -q`

Expected: route requests return 404.

- [ ] **Step 3: Implement settings store and API schemas**

Normalize `content_dir` with:

```python
parts = [part for part in raw.strip("/").split("/") if part]
if any(part in {".", ".."} for part in parts):
    raise ValueError("Content folder cannot contain . or .. segments.")
return "/".join(parts)
```

The token PUT validates `/user` before storing. `POST /validate` loads the stored token and configured destination, calls `validate_destination`, and returns the authenticated login plus ready status.

- [ ] **Step 4: Register the router and run tests**

Run: `uv run pytest packages/api/tests/api/test_publishing_settings_route.py packages/api/tests/test_server.py -q`

Expected: all pass.

- [ ] **Step 5: Commit**

```bash
git add packages/api/blogforge/publishing/settings_store.py packages/api/blogforge/api/publishing.py packages/api/blogforge/server.py packages/api/tests/api/test_publishing_settings_route.py
git commit -m "feat: expose per-user publishing settings"
```

### Task 4: Implement create and stable-path republish

**Files:**
- Create: `packages/api/blogforge/publishing/service.py`
- Modify: `packages/api/blogforge/api/publishing.py`
- Test: `packages/api/tests/publishing/test_service.py`
- Test: `packages/api/tests/api/test_github_publish_route.py`

**Interfaces:**
- Produces `build_publish_path(settings, draft, today) -> str`.
- Produces `publish_draft_to_github(draft_id, user_id, store) -> PublishResult`.
- Produces `POST /api/drafts/{draft_id}/publish/github`.
- Publish response: `path`, `file_url`, `commit_url`, `commit_sha`, `content_sha`, `published_at`.

- [ ] **Step 1: Write failing service tests**

Cover Hugo/Jekyll/plain filenames, first-create path collision, direct create, repeat update with stored SHA, stable path after title change, render parity with `to_markdown`, draft ownership 404, missing configuration, missing token, conflict atomicity, and upstream failure atomicity.

```python
async def test_title_change_updates_original_path():
    first = await service.publish(draft_id, user_id)
    await rename_draft(draft_id, "A completely different title")
    second = await service.publish(draft_id, user_id)
    assert second.path == first.path
    assert github.put_calls[1].expected_sha == first.content_sha
```

- [ ] **Step 2: Run tests and confirm service is missing**

Run: `uv run pytest packages/api/tests/publishing/test_service.py packages/api/tests/api/test_github_publish_route.py -q`

Expected: collection or route failure.

- [ ] **Step 3: Implement publication coordination**

First publish calculates the path, calls `get_content`, raises `publish_path_exists` when non-null, creates with no SHA, then records returned metadata. Repeat publish reuses `draft.published_path`, sends `draft.published_sha`, and records only a successful result.

```python
markdown = to_markdown(draft, frontmatter=settings.frontmatter_preset != "plain")
message = f"{'Update' if draft.published_path else 'Publish'}: {draft.title or draft.idea.topic}"
result = await github.put_content(..., content=markdown, message=message, expected_sha=draft.published_sha)
updated = await store.record_publication(..., published_sha=result.content_sha, ...)
```

- [ ] **Step 4: Map domain errors to API responses**

Return 400 for configuration/token errors, 403 for write denial, 404 for owned-draft or repository/branch absence, 409 for existing path and SHA conflict, 429 for rate limit, and 502/503 for upstream failures. Error bodies retain stable `detail.error.code` values.

- [ ] **Step 5: Run service and route tests**

Run: `uv run pytest packages/api/tests/publishing/test_service.py packages/api/tests/api/test_github_publish_route.py -q`

Expected: all pass.

- [ ] **Step 6: Commit**

```bash
git add packages/api/blogforge/publishing/service.py packages/api/blogforge/api/publishing.py packages/api/tests/publishing/test_service.py packages/api/tests/api/test_github_publish_route.py
git commit -m "feat: publish drafts directly to GitHub"
```

### Task 5: Add the GitHub publishing Settings card

**Files:**
- Create: `packages/web/src/api/publishing.ts`
- Create: `packages/web/src/components/settings/GitHubPublishingCard.tsx`
- Modify: `packages/web/src/routes/SettingsPage.tsx`
- Modify: `packages/web/src/api/client.ts`
- Modify: `packages/web/src/lib/publish.ts`
- Test: `packages/web/tests/components/GitHubPublishingCard.test.tsx`
- Test: `packages/web/tests/routes/SettingsPage.test.tsx`

**Interfaces:**
- Produces typed `getPublishingSettings`, `savePublishingSettings`, `savePublishingToken`, `clearPublishingToken`, and `validatePublishingSettings`.
- Produces `<GitHubPublishingCard />`.
- `ApiError.code` contains `detail.error.code`, not the human message.

- [ ] **Step 1: Write failing card tests**

Test loaded destination values, password-only token entry, token never rendered from server state, Save and test call ordering, ready login display, precise validation errors, Clear preserving destination fields, and localStorage defaults only when no server record exists.

```tsx
expect(await screen.findByDisplayValue("content/posts")).toBeInTheDocument();
fireEvent.change(screen.getByLabelText("GitHub publishing token"), {
  target: { value: "github_pat_secret" },
});
fireEvent.click(screen.getByRole("button", { name: "Save and test" }));
await waitFor(() => expect(validatePublishingSettings).toHaveBeenCalled());
expect(screen.queryByDisplayValue("github_pat_secret")).not.toBeInTheDocument();
```

- [ ] **Step 2: Run tests and confirm component/API are missing**

Run: `pnpm exec vitest run tests/components/GitHubPublishingCard.test.tsx tests/routes/SettingsPage.test.tsx`

Expected: import failures.

- [ ] **Step 3: Implement API types and preserve structured error codes**

Parse API failures with:

```ts
const payload = await res.json();
const error = payload?.detail?.error ?? payload?.error;
detail = typeof error?.message === "string" ? error.message : undefined;
code = typeof error?.code === "string" ? error.code : undefined;
```

- [ ] **Step 4: Implement the Settings card**

Render owner, repository, branch, content folder, preset, PAT input, Save and test, Replace/Clear actions, authenticated login, and readiness state. The PAT state is cleared immediately after a successful token save. Use existing `loadPublishConfig()` only to seed unsaved fields when the server returns no record.

- [ ] **Step 5: Add the card to Settings and run tests**

Run: `pnpm exec vitest run tests/components/GitHubPublishingCard.test.tsx tests/routes/SettingsPage.test.tsx tests/api/clients.test.ts`

Expected: all pass.

- [ ] **Step 6: Commit**

```bash
git add packages/web/src/api packages/web/src/components/settings/GitHubPublishingCard.tsx packages/web/src/routes/SettingsPage.tsx packages/web/src/lib/publish.ts packages/web/tests
git commit -m "feat: configure GitHub publishing in Settings"
```

### Task 6: Replace the browser editor flow with one-click publishing

**Files:**
- Modify: `packages/web/src/components/draft/PublishDialog.tsx`
- Modify: `packages/web/src/api/drafts.ts`
- Modify: `packages/web/src/lib/publish.ts`
- Test: `packages/web/tests/components/PublishDialog.test.tsx`
- Modify: `packages/web/tests/lib/publish.test.ts`

**Interfaces:**
- Adds `publishDraftToGitHub(id) -> GitHubPublishResult` to the draft API.
- Publish dialog consumes server settings and returns file/commit links.

- [ ] **Step 1: Write failing dialog tests**

Test loading, unconfigured link to Settings, configured destination/path display, direct publish call, success links, conflict message, rate-limit message, retry behavior, absence of editable owner/repository controls, and retained GEO guide download.

```tsx
expect(await screen.findByText("dbbaskette/blog-content")).toBeInTheDocument();
expect(screen.queryByLabelText("Owner")).not.toBeInTheDocument();
fireEvent.click(screen.getByRole("button", { name: "Publish" }));
await waitFor(() => expect(publishDraftToGitHub).toHaveBeenCalledWith("draft-1"));
expect(await screen.findByRole("link", { name: "View commit" })).toHaveAttribute(
  "href",
  "https://github.com/dbbaskette/blog-content/commit/abc",
);
```

- [ ] **Step 2: Run tests and confirm current dialog fails expectations**

Run: `pnpm exec vitest run tests/components/PublishDialog.test.tsx tests/lib/publish.test.ts`

Expected: editable owner/repository fields and missing API call cause failures.

- [ ] **Step 3: Implement the server-backed dialog**

Fetch settings when opened. If not ready, show the specific state and a `/settings` link. Compute the display path with shared TypeScript slug/date rules, but treat the server response path as authoritative. On success show `View published file` and `View commit` links. Map `publish_path_exists`, `publish_conflict`, `github_rate_limited`, and generic upstream errors to actionable copy.

- [ ] **Step 4: Remove obsolete new-file URL behavior and run tests**

Keep publish config types, defaults, slug and filename helpers, and localStorage read for migration defaults. Remove `newFileUrl`, `willPrefillContent`, clipboard writes, and `window.open` behavior.

Run: `pnpm exec vitest run tests/components/PublishDialog.test.tsx tests/lib/publish.test.ts`

Expected: all pass.

- [ ] **Step 5: Commit**

```bash
git add packages/web/src/components/draft/PublishDialog.tsx packages/web/src/api/drafts.ts packages/web/src/lib/publish.ts packages/web/tests/components/PublishDialog.test.tsx packages/web/tests/lib/publish.test.ts
git commit -m "feat: publish drafts with one click"
```

### Task 7: Release, documentation, and end-to-end verification

**Files:**
- Modify: `packages/web/package.json`
- Modify: `packages/api/blogforge/__init__.py`
- Modify: `CHANGELOG.md`
- Modify: `README.md`
- Modify: `.env.local.example`

**Interfaces:**
- Produces BlogForge `0.8.0` with PAT setup documentation.

- [ ] **Step 1: Bump the minor version**

Run: `scripts/version.sh minor`

Expected: `0.7.2 → 0.8.0` and both version sources updated.

- [ ] **Step 2: Document setup and release behavior**

Add README instructions for creating a fine-grained PAT with Contents read/write on the selected repository, saving it per user in Settings, configuring the destination, validating, first publishing, and conflict behavior. Do not instruct users to put per-user tokens in `.env`.

- [ ] **Step 3: Run focused and full verification**

Run:

```bash
scripts/version.sh check
uv run pytest packages/api/tests/publishing packages/api/tests/api/test_publishing_settings_route.py packages/api/tests/api/test_github_publish_route.py -q
cd packages/web && pnpm test && pnpm build
pnpm exec biome check src/api/publishing.ts src/api/client.ts src/components/settings/GitHubPublishingCard.tsx src/components/draft/PublishDialog.tsx tests/components/GitHubPublishingCard.test.tsx tests/components/PublishDialog.test.tsx
```

Expected: version sync; focused API tests pass; all web tests pass; production build succeeds; changed-file lint succeeds.

- [ ] **Step 4: Run migration and security checks**

Run:

```bash
uv run pytest packages/api/tests/test_publishing_token_vault.py packages/api/tests/test_sqlite_schema_sync.py packages/api/tests/test_error_logging.py -q
git diff --check
```

Expected: all pass and no whitespace errors.

- [ ] **Step 5: Commit release metadata**

```bash
git add packages/web/package.json packages/api/blogforge/__init__.py CHANGELOG.md README.md .env.local.example
git commit -m "release: prepare BlogForge 0.8.0"
```

- [ ] **Step 6: Review, push, merge, and deploy**

Push `codex/github-publishing`, open a pull request, inspect its diff and checks, squash merge to `main`, run `scripts/deploy-home.sh`, and verify `/api/health` reports version `0.8.0` and the merged SHA.

- [ ] **Step 7: Production private-repository smoke test**

In Settings, save a repository-scoped test PAT and destination, validate it, publish a draft, edit its title and body, republish, and verify both commits target the same GitHub path. Confirm the UI and Admin logs never display the token.

