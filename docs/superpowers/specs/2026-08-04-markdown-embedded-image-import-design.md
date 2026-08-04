# Markdown Embedded Image Import Design

## Problem

Markdown files exported by editors can contain images as `data:image/...;base64,...` payloads. These payloads make an otherwise small article exceed BlogForge's 1 MB browser file limit or 200,000-character API limit, so the draft cannot be imported.

Normal Markdown image links are not the problem and must remain unchanged.

## Considered approaches

1. **Sanitize in both browser and API (selected).** The browser can clean oversized files before upload and explain what was removed. The API applies the same policy to pasted text and non-browser callers. This duplicates a small deterministic parser in TypeScript and Python but protects every entry point.
2. **Sanitize only in the browser.** This is smaller, but pasted content and direct API clients can still submit multi-megabyte embedded images.
3. **Raise size limits.** This accepts unnecessary binary data into text fields, increases request and database size, and does not provide useful image handling.

## Behavior

- A file may contain up to 25 MB of raw Markdown so embedded image payloads can be read and removed safely.
- Remove inline Markdown images whose destination starts with `data:image/`.
- Remove Markdown reference definitions whose destination starts with `data:image/`; references to those definitions become readable omission placeholders.
- Remove HTML `<img>` elements whose `src` starts with `data:image/`.
- Replace each removed image usage with `[Image omitted during import: ALT]`; use `embedded image` when no useful alt text exists.
- Preserve HTTP(S), relative-path, attachment, and non-image data links unchanged.
- Normalize Markdown after image removal.
- Reject cleaned text over 200,000 characters, matching the API model.
- Show how many embedded images were removed and their approximate raw size.
- The API performs the same sanitization before validation and ingestion so pasted/direct requests behave consistently.

## Components and data flow

The web Markdown utility returns cleaned text plus removal metadata. `PastePanel` reads a file under the raw safety limit, sanitizes it, enforces the cleaned limit, and reports the result before passing text to compose state.

The API import endpoint accepts a bounded raw request, sanitizes `body.text`, rejects cleaned text over 200,000 characters, then sends only cleaned Markdown to `ingest_document`. Stored sections therefore never contain embedded image payloads.

## Error handling

- Raw file over 25 MB: reject without reading it.
- Cleaned Markdown over 200,000 characters: reject with a message that the article text remains too large after images were removed.
- Empty Markdown after cleanup: retain the existing empty-draft rejection.

## Testing

- TypeScript unit tests cover inline Markdown, reference-style Markdown, HTML images, placeholder text, metadata, and preservation of normal links.
- `PastePanel` component tests cover raw-size and cleaned-size behavior plus the removal notice.
- Python unit/API tests cover the same sanitization and prove the API stores cleaned content.
- Existing import and Markdown-normalization tests remain green.

## Non-goals

- Uploading or storing embedded content images.
- Rewriting normal image URLs.
- Extracting image files from data URIs.
- Changing the 200,000-character stored-text limit.
