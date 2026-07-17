# Publish Hero Images with GitHub Posts Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Atomically publish a draft's generated hero PNG beside its GitHub Markdown post and reference the relative image filename.

**Architecture:** Extend draft publication metadata and Markdown rendering first, then add a focused Git Data API multi-file commit primitive. The publishing service reads the hero from BlogForge blob storage, performs collision/SHA checks, and records both remote blob SHAs only after one atomic GitHub commit succeeds.

**Tech Stack:** Python 3.12, FastAPI, Pydantic, SQLAlchemy/Alembic, httpx/respx, pytest, TypeScript, Vitest, GitHub Git Data API.

## Global Constraints

- Hero path is `<published-post-stem>-hero.png` beside the post.
- Hugo/Jekyll use a relative `image` frontmatter value; plain Markdown uses a leading image element.
- Internal blob keys, tokens, and image bytes never appear in published text, logs, or errors.
- Markdown and hero image are committed atomically when a hero exists.
- Remote GitHub edits are protected by stored blob-SHA comparisons.
- Removing a hero drops its Markdown reference without deleting the remote image.
- No new production dependency.
- Release version is exactly `0.8.1`.

---

### Task 1: Persist hero publication identity and render portable references

**Files:**
- Create: `packages/api/alembic/versions/0019_published_hero_metadata.py`
- Modify: `packages/api/blogforge/db/models.py`
- Modify: `packages/api/blogforge/drafts/models.py`
- Modify: `packages/api/blogforge/drafts/sql_store.py`
- Modify: `packages/api/blogforge/export/render.py`
- Modify: `packages/web/src/api/drafts.ts`
- Test: `packages/api/tests/test_publishing_models.py`
- Test: `packages/api/tests/test_sqlite_schema_sync.py`
- Test: `packages/api/tests/test_export.py`

**Interfaces:**
- Produces draft fields `published_hero_path: str | None` and `published_hero_sha: str | None`.
- Produces `to_markdown(draft, *, frontmatter=False, hero_reference=None, include_hero_in_body=False) -> str`.
- Extends `SqlDraftStore.record_publication(..., published_hero_path, published_hero_sha)`.

- [ ] **Step 1: Add failing model, migration, store, and rendering tests**

Assert round trips for the two new nullable fields, migration/schema columns, frontmatter `image: post-hero.png`, plain Markdown starting with `![Title](post-hero.png)`, and absence of the internal `drafts/.../hero/...png` key when an explicit published reference is supplied.

```python
def test_publish_markdown_uses_portable_hero_reference() -> None:
    draft = _draft(hero_image_key="drafts/internal/hero.png")
    rendered = to_markdown(draft, frontmatter=True, hero_reference="post-hero.png")
    assert "image: post-hero.png" in rendered
    assert "drafts/internal" not in rendered


def test_plain_publish_markdown_leads_with_hero() -> None:
    rendered = to_markdown(
        _draft(),
        hero_reference="post-hero.png",
        include_hero_in_body=True,
    )
    assert rendered.startswith("![Post title](post-hero.png)\n\n")
```

- [ ] **Step 2: Run the focused tests and confirm missing fields/signatures fail**

Run: `uv --cache-dir /tmp/blogforge-uv-cache run pytest packages/api/tests/test_publishing_models.py packages/api/tests/test_sqlite_schema_sync.py packages/api/tests/test_export.py -q`

Expected: failures for missing published hero fields/columns and unsupported renderer arguments.

- [ ] **Step 3: Add migration `0019`, model/store mappings, and renderer arguments**

The renderer selects `hero_reference` for frontmatter when provided and only prepends body image Markdown when `include_hero_in_body` is true. Preserve existing export behavior for callers that do not pass the new arguments.

```python
def to_markdown(
    draft: Draft,
    *,
    frontmatter: bool = False,
    hero_reference: str | None = None,
    include_hero_in_body: bool = False,
) -> str:
    body = SqlDraftStore.assemble_markdown(draft)
    if include_hero_in_body and hero_reference:
        title = draft.title or draft.idea.topic or "Post hero"
        body = f"![{title}]({hero_reference})\n\n{body}"
    return frontmatter_block(draft, hero_reference=hero_reference) + body if frontmatter else body
```

- [ ] **Step 4: Run the focused tests and confirm they pass**

Run the Step 2 command.

Expected: all selected tests pass.

- [ ] **Step 5: Commit the schema and rendering unit**

```bash
git add packages/api/alembic/versions/0019_published_hero_metadata.py packages/api/blogforge/db/models.py packages/api/blogforge/drafts/models.py packages/api/blogforge/drafts/sql_store.py packages/api/blogforge/export/render.py packages/web/src/api/drafts.ts packages/api/tests/test_publishing_models.py packages/api/tests/test_sqlite_schema_sync.py packages/api/tests/test_export.py
git commit -m "feat: model published hero images"
```

### Task 2: Add an atomic GitHub multi-file commit primitive

**Files:**
- Modify: `packages/api/blogforge/publishing/github_client.py`
- Test: `packages/api/tests/publishing/test_github_client.py`

**Interfaces:**
- Produces `GitHubFileWrite(path: str, content: bytes)`.
- Produces `GitHubAtomicCommitResult(file_shas: dict[str, str], commit_sha: str, commit_url: str)`.
- Produces `GitHubPublisherClient.commit_files(owner, repo, branch, files, message)`.

- [ ] **Step 1: Add failing respx tests for the Git Data API sequence**

Mock and assert the exact request chain: branch ref, base commit/tree, two base64 blobs, one tree with both paths, one commit with the old head parent, and a non-force ref update. Assert returned file SHAs and commit URL. Add a 422 ref-update test expecting `publish_conflict` with repository/path context.

```python
result = await client.commit_files(
    "dan",
    "blog",
    "main",
    [
        GitHubFileWrite("posts/a.md", b"# A"),
        GitHubFileWrite("posts/a-hero.png", b"\x89PNG"),
    ],
    "Publish: A",
)
assert result.file_shas == {
    "posts/a.md": "markdown-blob",
    "posts/a-hero.png": "image-blob",
}
```

- [ ] **Step 2: Run the client tests and confirm the new interface fails**

Run: `uv --cache-dir /tmp/blogforge-uv-cache run pytest packages/api/tests/publishing/test_github_client.py -q`

Expected: import/signature failures for the new dataclasses and method.

- [ ] **Step 3: Implement `commit_files` with existing response/error helpers**

Create blobs with base64 encoding, create a tree using `base_tree`, create a commit with the branch head as its only parent, then PATCH `git/refs/heads/{branch}` using `{"sha": commit_sha, "force": false}`. Map 409/422 from the final ref update to `publish_conflict`. Validate every required response SHA through `_required_string`.

- [ ] **Step 4: Run the client tests and confirm they pass**

Run the Step 2 command.

Expected: all client tests pass.

- [ ] **Step 5: Commit the atomic client**

```bash
git add packages/api/blogforge/publishing/github_client.py packages/api/tests/publishing/test_github_client.py
git commit -m "feat: commit GitHub post assets atomically"
```

### Task 3: Publish hero bytes with the post and enforce conflicts

**Files:**
- Modify: `packages/api/blogforge/publishing/service.py`
- Test: `packages/api/tests/publishing/test_service.py`
- Test: `packages/api/tests/api/test_github_publish_route.py`

**Interfaces:**
- Produces `build_hero_path(post_path: str) -> str`.
- Extends `publish_draft_to_github(..., blob_store: Any | None = None)`.
- Consumes `commit_files`, renderer arguments, and published hero metadata from Tasks 1-2.

- [ ] **Step 1: Extend fakes and add failing service tests**

Cover these cases with an in-memory blob store and GitHub fake:

```python
assert build_hero_path("content/posts/a.md") == "content/posts/a-hero.png"
```

- first hero publish checks both paths, calls `commit_files` once with Markdown and PNG, and records both blob SHAs;
- Jekyll and Hugo frontmatter use only the relative basename;
- plain Markdown starts with the relative hero image;
- post or image collision performs no write;
- republish rejects remote post or hero SHA mismatches;
- regenerated and newly added heroes use the stable derived path;
- removed hero uses the single-file update, omits the reference, retains prior hero metadata, and never deletes remotely; and
- blob read failure raises `hero_image_unavailable` before GitHub writes.

- [ ] **Step 2: Run service and route tests and confirm the hero cases fail**

Run: `uv --cache-dir /tmp/blogforge-uv-cache run pytest packages/api/tests/publishing/test_service.py packages/api/tests/api/test_github_publish_route.py -q`

Expected: failures for missing path helper, blob-store argument, atomic call, and metadata.

- [ ] **Step 3: Implement hero publication orchestration**

Derive the sidecar path from the stable post path. Read hero bytes before any GitHub mutation and translate storage failures to:

```python
raise PublishingError(
    "hero_image_unavailable",
    "The draft hero image could not be read. Regenerate it and try again.",
    503,
)
```

On first publish, require both calculated paths to be absent. On republish, compare `get_content(...).sha` with stored post/hero SHAs before an atomic update. Call `commit_files` whenever a current hero exists; otherwise retain the existing `put_content` path. Record metadata only after GitHub succeeds.

- [ ] **Step 4: Run service and route tests and confirm they pass**

Run the Step 2 command.

Expected: all selected tests pass.

- [ ] **Step 5: Commit the publishing integration**

```bash
git add packages/api/blogforge/publishing/service.py packages/api/tests/publishing/test_service.py packages/api/tests/api/test_github_publish_route.py
git commit -m "feat: publish hero graphics with posts"
```

### Task 4: Release 0.8.1, verify, review, merge, and deploy

**Files:**
- Modify: `packages/api/blogforge/__init__.py`
- Modify: `packages/web/package.json`
- Modify: `CHANGELOG.md`
- Modify: `README.md`

**Interfaces:**
- Produces a synchronized BlogForge `0.8.1` release.

- [ ] **Step 1: Bump synchronized versions and document hero publishing**

Run: `scripts/version.sh 0.8.1`

Add a `0.8.1` changelog entry and update the GitHub publishing README text to state that generated hero graphics are saved beside posts.

- [ ] **Step 2: Run focused formatting and test gates**

```bash
uv --cache-dir /tmp/blogforge-uv-cache run ruff format packages/api/alembic/versions/0019_published_hero_metadata.py packages/api/blogforge/db/models.py packages/api/blogforge/drafts/models.py packages/api/blogforge/drafts/sql_store.py packages/api/blogforge/export/render.py packages/api/blogforge/publishing/github_client.py packages/api/blogforge/publishing/service.py packages/api/tests/test_publishing_models.py packages/api/tests/test_sqlite_schema_sync.py packages/api/tests/test_export.py packages/api/tests/publishing/test_github_client.py packages/api/tests/publishing/test_service.py packages/api/tests/api/test_github_publish_route.py
uv --cache-dir /tmp/blogforge-uv-cache run ruff check packages/api/alembic/versions/0019_published_hero_metadata.py packages/api/blogforge/db/models.py packages/api/blogforge/drafts/models.py packages/api/blogforge/drafts/sql_store.py packages/api/blogforge/export/render.py packages/api/blogforge/publishing/github_client.py packages/api/blogforge/publishing/service.py packages/api/tests/test_publishing_models.py packages/api/tests/test_sqlite_schema_sync.py packages/api/tests/test_export.py packages/api/tests/publishing/test_github_client.py packages/api/tests/publishing/test_service.py packages/api/tests/api/test_github_publish_route.py
cd packages/web && pnpm exec biome check --write src/api/drafts.ts
```

Expected: no diagnostics in changed files.

- [ ] **Step 3: Run complete verification**

```bash
uv --cache-dir /tmp/blogforge-uv-cache run pytest packages/api/tests -q
cd packages/web && pnpm exec vitest run && pnpm build
scripts/version.sh check
uv --cache-dir /tmp/blogforge-uv-cache run alembic -c packages/api/alembic.ini heads
git diff --check
```

Expected: API and web suites pass, build succeeds, one Alembic head (`0019`), version `0.8.1` is synchronized, and the worktree is clean after commit.

- [ ] **Step 4: Commit release metadata**

```bash
git add CHANGELOG.md README.md packages/api/blogforge/__init__.py packages/web/package.json
git commit -m "release: prepare BlogForge 0.8.1"
```

- [ ] **Step 5: Request independent review and resolve Critical/Important findings**

Use `superpowers:requesting-code-review` against the exact final branch head. Re-run the relevant tests after each accepted fix.

- [ ] **Step 6: Push, create, and squash-merge the PR**

```bash
git push -u origin codex/publish-hero-image
```

Create a PR describing atomic hero publication and verification, then squash-merge it into `main`.

- [ ] **Step 7: Deploy and verify 0.8.1**

```bash
git switch main
git pull --ff-only origin main
./scripts/deploy-home.sh
curl -fsS https://blogforge.baskettecase.com/api/health
```

Expected: deployment reports the merged SHA and both internal/public health return `{"status":"ok","version":"0.8.1"}`.
