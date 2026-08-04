# Markdown Embedded Image Import Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Import Markdown containing embedded image data by removing the image payloads while preserving article text, normal image links, and readable placeholders.

**Architecture:** Add small deterministic sanitizers in the web and API packages with the same observable behavior. The browser sanitizes before updating compose state and reports removals; the API sanitizes every import before ingestion and enforces the existing 200,000-character stored-text limit after cleanup.

**Tech Stack:** TypeScript, React, Vitest, Python, FastAPI, Pydantic, pytest

## Global Constraints

- Raw Markdown file limit is 25,000,000 bytes.
- Cleaned Markdown text limit is 200,000 characters.
- Only image destinations beginning with `data:image/` are removed.
- HTTP(S), relative-path, attachment, and non-image data links remain unchanged.
- Removed image usages become `[Image omitted during import: ALT]`, defaulting ALT to `embedded image`.
- No new runtime dependencies.

---

### Task 1: Deterministic embedded-image sanitizers

**Files:**
- Create: `packages/web/src/lib/markdownImages.ts`
- Create: `packages/web/tests/lib/markdownImages.test.ts`
- Create: `packages/api/blogforge/generate/markdown_images.py`
- Create: `packages/api/tests/generate/test_markdown_images.py`

**Interfaces:**
- Produces TypeScript `stripEmbeddedImages(markdown: string): EmbeddedImageCleanup` where `EmbeddedImageCleanup` contains `text`, `removedImages`, and `removedCharacters`.
- Produces Python `strip_embedded_images(markdown: str) -> EmbeddedImageCleanup` with the same fields and semantics.

- [ ] **Step 1: Write failing TypeScript tests**

Cover inline Markdown data images, reference-style data images, quoted HTML data images, empty alt fallback, metadata, and preservation of HTTP, relative, and `data:application` links.

- [ ] **Step 2: Run the TypeScript test and verify RED**

Run: `pnpm test -- tests/lib/markdownImages.test.ts`

Expected: FAIL because `markdownImages.ts` does not exist.

- [ ] **Step 3: Implement the minimal TypeScript sanitizer**

Use focused regular expressions and reference-label normalization. Count payload-bearing inline images, HTML tags, and reference definitions; do not count each use of one reference definition as another payload.

- [ ] **Step 4: Run the TypeScript test and verify GREEN**

Run: `pnpm test -- tests/lib/markdownImages.test.ts`

Expected: PASS.

- [ ] **Step 5: Write failing Python tests**

Mirror the TypeScript behavior table so the API and browser policies cannot drift unnoticed.

- [ ] **Step 6: Run the Python test and verify RED**

Run: `PYTHONPATH=packages/api .venv/bin/python -m pytest packages/api/tests/generate/test_markdown_images.py -q`

Expected: FAIL because `blogforge.generate.markdown_images` does not exist.

- [ ] **Step 7: Implement the minimal Python sanitizer**

Use a frozen dataclass for cleanup metadata and equivalent regex/reference-label behavior.

- [ ] **Step 8: Run sanitizer tests and verify GREEN**

Run both focused TypeScript and Python sanitizer tests.

Expected: PASS.

- [ ] **Step 9: Commit**

Commit message: `feat: strip embedded images from markdown`

---

### Task 2: Browser file-import cleanup and feedback

**Files:**
- Modify: `packages/web/src/components/compose/PastePanel.tsx`
- Modify: `packages/web/tests/components/compose/PastePanel.test.tsx`

**Interfaces:**
- Consumes: `stripEmbeddedImages()` from Task 1.
- Produces: file import behavior that reads at most 25 MB raw, rejects more than 200,000 cleaned characters, and reports removal count/size.

- [ ] **Step 1: Write failing component tests**

Exercise file input with an over-1-MB base64 image plus short prose and assert that prose reaches `onText`, the payload does not, normal image links remain, and the notice reports one removed image. Add raw-over-25-MB and cleaned-over-200,000 rejection cases.

- [ ] **Step 2: Run the component test and verify RED**

Run: `pnpm test -- tests/components/compose/PastePanel.test.tsx`

Expected: FAIL because the current 1 MB pre-read guard rejects the embedded-image fixture.

- [ ] **Step 3: Implement browser integration**

Replace the 1 MB guard with `RAW_FILE_MAX_BYTES = 25_000_000`, sanitize before `normalizeMarkdown`, enforce `CLEAN_TEXT_MAX_CHARS = 200_000`, and show concise success/rejection notes.

- [ ] **Step 4: Run focused web tests and verify GREEN**

Run: `pnpm test -- tests/lib/markdownImages.test.ts tests/components/compose/PastePanel.test.tsx tests/lib/markdownNormalize.test.ts`

Expected: PASS.

- [ ] **Step 5: Commit**

Commit message: `fix: import markdown with embedded images`

---

### Task 3: API cleanup and post-sanitization validation

**Files:**
- Modify: `packages/api/blogforge/api/drafts.py`
- Modify: `packages/api/tests/api/test_drafts_route.py`

**Interfaces:**
- Consumes: `strip_embedded_images()` from Task 1.
- Produces: `/api/drafts/import` accepts at most 25,000,000 raw characters, stores sanitized content, and returns HTTP 413 when cleaned text exceeds 200,000 characters.

- [ ] **Step 1: Write failing API tests**

Post Markdown containing a data image and assert the created draft contains its placeholder but not `data:image`. Add normal image preservation and cleaned-over-limit rejection tests.

- [ ] **Step 2: Run API tests and verify RED**

Run: `PYTHONPATH=packages/api .venv/bin/python -m pytest packages/api/tests/api/test_drafts_route.py -q`

Expected: FAIL because the route currently stores embedded data and Pydantic validates before cleanup.

- [ ] **Step 3: Implement API integration**

Raise `_ImportBody.text` raw maximum to 25,000,000, sanitize at the start of `import_draft`, return a structured HTTP 413 `import_text_too_large` error when cleaned text exceeds 200,000 characters, and ingest only sanitized text.

- [ ] **Step 4: Run focused API tests and verify GREEN**

Run: `PYTHONPATH=packages/api .venv/bin/python -m pytest packages/api/tests/generate/test_markdown_images.py packages/api/tests/generate/test_ingest.py packages/api/tests/api/test_drafts_route.py -q`

Expected: PASS.

- [ ] **Step 5: Commit**

Commit message: `fix: sanitize embedded images at import boundary`

---

### Task 4: Full verification

**Files:**
- Verify all modified files.

- [ ] **Step 1: Run complete API and web test suites**

Run the repository's full pytest and Vitest suites.

- [ ] **Step 2: Run production build and changed-file quality checks**

Run the web production build, Ruff on changed Python files, mypy on changed Python source, Biome on changed TypeScript files, and `git diff --check`.

- [ ] **Step 3: Review the final diff and working-tree status**

Confirm only the spec, plan, sanitizer, import integration, and related tests changed.
