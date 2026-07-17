# Per-user GitHub publishing design

Date: 2026-07-17
Status: Approved for implementation planning
Target release: 0.8.0

## Goal

Make **Publish to GitHub** a reliable one-click direct commit to each user's
private or public content repository. Each user supplies their own narrowly
scoped GitHub personal access token (PAT) and configures one default publishing
destination in Settings. BlogForge encrypts the token at rest, performs the
GitHub write server-side, and remembers the original file path for safe later
updates.

## Current behavior and problem

The current publish dialog stores owner, repository, branch, directory, and
frontmatter preset in browser `localStorage`. It exports Markdown, copies it to
the clipboard, and opens GitHub's new-file editor. BlogForge's existing GitHub
OAuth flow requests only identity scopes and discards the OAuth access token,
so it cannot write through the API. The browser flow depends on a separate
GitHub web session, does not reliably work with private repositories, and still
requires manual paste/commit steps for longer articles.

## Chosen approach

Use an encrypted per-user PAT and GitHub's Contents API from the BlogForge
server. This follows the existing per-user provider-key security pattern while
keeping publishing credentials separate from sign-in OAuth.

Alternatives rejected:

- Expanding and persisting the sign-in OAuth token would couple authentication
  to repository-write authorization and complicate scope and revocation
  behavior.
- Retaining the GitHub web editor would remain browser-session-dependent and
  would not provide true one-click publishing.

## User experience

### Settings

Add a **GitHub publishing** card with:

- a password-style PAT field with Save/Replace and Clear actions;
- owner and repository fields;
- branch, defaulting to `main`;
- content folder, defaulting to `content/posts`;
- frontmatter preset: Hugo, Jekyll, or plain Markdown;
- a **Save and test** action;
- status showing the authenticated GitHub login and either **Ready to
  publish** or a specific remediation message.

The card never returns or displays the saved token. Clearing the token preserves
the destination settings but makes publishing unavailable. Saving and testing
validates all of the following:

1. the token authenticates;
2. the configured repository is accessible, including private repositories;
3. the configured branch exists;
4. the token can write repository contents.

A fine-grained PAT restricted to the selected repository with **Contents: Read
and write** is the recommended credential. Classic PATs with equivalent `repo`
access remain compatible.

### Publish dialog

The dialog no longer edits or requests repository fields. It shows:

- the configured `owner/repository` and branch;
- the calculated file path;
- the selected frontmatter preset;
- the existing one-time GEO setup-guide download;
- a single **Publish** action.

If configuration is incomplete or invalid, the dialog explains what is missing
and links to Settings. A successful publish shows links to the GitHub file and
commit.

The first publish uses a commit message of `Publish: <title>`. Later publishes
use `Update: <title>`.

## Data model

Add a one-to-one, user-scoped publishing settings record:

- `user_id` primary/foreign key;
- `owner`;
- `repo`;
- `branch`;
- `content_dir`;
- `frontmatter_preset`;
- `created_at` and `updated_at`.

Store the GitHub PAT as a per-user encrypted secret using the same
`SecretCipher` and session-secret-derived encryption already used by
`KeyVault`. The credential namespace is `github-publishing`; it is not included
in LLM provider selection or provider-key status responses.

Add publication metadata to each draft:

- `published_at`, nullable timestamp;
- `published_path`, nullable string;
- `published_sha`, nullable string containing GitHub's current file/blob SHA;
- `published_commit_url`, nullable string.

The first successful publish fixes `published_path`. Later title edits do not
rename the GitHub file or create a second article. The path changes only if a
future explicit move feature is added; that feature is outside this scope.

## Backend boundaries

### Publishing settings service

Owns per-user destination persistence and validation. Its API returns settings
and token/status metadata, never token material.

Endpoints:

- `GET /api/publishing/settings`
- `PUT /api/publishing/settings`
- `PUT /api/publishing/token`
- `DELETE /api/publishing/token`
- `POST /api/publishing/validate`

Every endpoint requires the current user and reads or changes only that user's
record and secret.

### GitHub contents client

A focused service wraps GitHub API operations:

- authenticate and read the current login;
- read repository and branch metadata;
- verify effective contents permissions;
- read a file's current SHA;
- create a UTF-8 Markdown file;
- update a file using the expected SHA.

It maps GitHub status codes and rate-limit responses into stable domain errors.
Logs may include owner, repository, branch, path, and request identifiers, but
never authorization headers or token fragments.

### Draft publisher

Coordinates one publication:

1. load the owned draft and the current user's destination and token;
2. render Markdown using the configured frontmatter preset;
3. calculate a sanitized path on first publish, or reuse `published_path`;
4. create the file if the draft has never been published;
5. update the file with `published_sha` on repeat publish;
6. persist publication metadata only after GitHub confirms the commit;
7. return the path, file URL, commit URL, commit SHA, and publication time.

Endpoint:

- `POST /api/drafts/{draft_id}/publish/github`

The existing export renderer remains the source of Markdown/frontmatter so
downloaded and published content cannot drift.

## Path and commit rules

- Normalize the configured content directory by removing leading/trailing
  slashes and rejecting `.` or `..` traversal segments.
- Generate the filename from the first-publish title slug. Jekyll prefixes the
  filename with the current ISO date; Hugo and plain Markdown do not.
- Reject an empty branch, owner, repository, or resulting filename.
- On first publish, check whether the calculated path already exists. If it
  does, return a conflict and do not overwrite it.
- On update, send the stored `published_sha`. If GitHub reports a SHA conflict,
  do not retry with the repository's newer SHA and do not change draft
  publication metadata.

## Error behavior

Errors use actionable messages and stable codes:

- `github_token_missing` or `github_token_invalid`;
- `github_repo_not_found` (also used when GitHub intentionally conceals a
  private repository from an unauthorized token);
- `github_branch_not_found`;
- `github_write_forbidden`;
- `publish_path_exists`;
- `publish_conflict` for external changes after the last BlogForge publish;
- `github_rate_limited` with retry timing when GitHub provides it;
- `github_unavailable` for timeouts or upstream server failures.

No failure updates `published_at`, `published_path`, or `published_sha`.
Conflict responses include the configured repository URL and path so the user
can inspect the external change.

## Security

- Tokens are encrypted at rest and never returned after submission.
- Token APIs accept credentials only over the existing authenticated,
  same-origin session.
- API schemas expose only `token_set`, validation state, authenticated login,
  and destination fields.
- Authorization checks cover both settings ownership and draft ownership.
- GitHub client logging and exception messages are sanitized so tokens and
  authorization headers cannot reach logs or Admin log views.
- Documentation recommends a fine-grained PAT scoped to only the content
  repository and only Contents read/write permission.
- The existing read-only sign-in OAuth scopes and behavior remain unchanged.

## Migration from current behavior

Browser `localStorage` is no longer authoritative. On the first visit to the new
Settings card, the web app may read the existing `bf.publish.config` value and
offer its destination values as unsaved form defaults. It must not silently
persist them, because browser storage may belong to a different signed-in user.
After server settings are saved, the old value is ignored. No credential is
migrated because the current implementation stores none.

## Testing

Backend tests cover:

- encrypted token storage, replacement, clearing, and undecryptable-secret
  handling;
- strict per-user isolation for settings, tokens, and drafts;
- destination validation for valid, invalid, private, forbidden, and missing
  repositories/branches;
- GitHub response mapping, timeouts, and rate limits;
- first create, repeat update, pre-existing-path conflict, stale-SHA conflict,
  and failure atomicity;
- stable paths after title changes;
- Markdown/frontmatter parity with downloads;
- database migration and SQLite schema reconciliation.

Web tests cover:

- Settings loading, saving, token replacement/clearing, validation states, and
  optional localStorage form defaults;
- publish readiness and missing-configuration states;
- calculated-path display;
- successful file/commit links;
- conflict and upstream error presentation;
- removal of editable repository fields from the publish dialog.

Release verification includes a private test repository: save a per-user token,
validate the destination, create a post, edit the draft title and body, publish
again, and confirm that the same GitHub file is updated without exposing the
token.

## Out of scope

- multiple named destinations;
- per-draft destination overrides;
- creating repositories or branches;
- renaming or deleting an already published file;
- creating pull requests;
- publishing hero-image binaries or other assets;
- webhook-driven synchronization from GitHub back into BlogForge.

