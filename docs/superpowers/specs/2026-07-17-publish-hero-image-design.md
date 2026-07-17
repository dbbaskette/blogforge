# Publish Hero Images with GitHub Posts

## Goal

When a draft has an AI-generated hero graphic, GitHub publishing saves the image beside the post and makes the published Markdown reference that repository file. Publishing remains safe when files already exist, drafts are republished, or GitHub changes concurrently.

## Repository layout

The hero image uses the published post path as its stable identity. For a post at:

```text
content/posts/my-post.md
```

the image is stored at:

```text
content/posts/my-post-hero.png
```

The path is derived from the original published post path, not the draft's current title. Renaming a draft after its first publication therefore updates the original post and image instead of creating new files.

## Markdown rendering

- Hugo and Jekyll frontmatter set `image: my-post-hero.png`.
- Plain Markdown starts with `![Post title](my-post-hero.png)` before the article content.
- A draft without a hero image has no hero reference.
- BlogForge's internal blob-storage key is never written to published Markdown.

The renderer accepts an explicit published hero reference. Existing download and preview behavior remains unchanged when no override is supplied.

## Atomic GitHub publication

Publishing a post with a hero graphic creates one Git commit containing both the Markdown and PNG. The GitHub client uses the Git Data API to:

1. read the branch head and base tree;
2. create blobs for the Markdown and image;
3. create a tree containing both paths;
4. create one commit; and
5. advance the branch ref without force.

If the branch advances before the ref update, publishing returns the existing `publish_conflict` response. BlogForge never leaves a post that references a missing image or an image committed without its post.

Publishing a draft without a hero may continue using the existing Contents API path.

## First publish and republish

Before a first publish, BlogForge refuses to overwrite either the calculated post path or hero path. A collision returns the existing inspectable conflict information.

After a successful hero publication, the draft stores:

- `published_hero_path`; and
- `published_hero_sha`.

Republishing uses the original post and hero paths. A regenerated hero updates the same repository file. A hero added after the first publication creates the sidecar image and updates the post in one commit.

Before building an update commit, BlogForge reads the current repository files and compares their blob SHAs with the last SHAs stored on the draft. A mismatch returns `publish_conflict`; BlogForge never silently replaces edits made directly in GitHub. When a hero is being added for the first time, its calculated path must not already exist.

If a user removes a hero after publishing one, BlogForge removes the Markdown reference but leaves the old repository image in place. Remote deletion is intentionally out of scope because it is destructive and the file may be referenced elsewhere.

## Storage and errors

The publishing service reads hero bytes through BlogForge's configured blob-storage interface. A missing or unreadable hero blob fails before any GitHub write with a structured `hero_image_unavailable` error. Tokens, image bytes, and internal storage keys are not included in logs or API errors.

The existing destination validation, per-user token isolation, original-repository binding, and conflict links remain unchanged.

## Schema and API

Migration `0019` adds nullable `published_hero_path` and `published_hero_sha` columns to drafts. The draft API model exposes both fields. The publish response continues to describe the post file and commit; no UI contract change is required.

## Testing

Automated coverage verifies:

- deterministic hero-path derivation for Hugo, Jekyll, and plain posts;
- frontmatter and plain-Markdown references use the relative repository filename;
- no internal blob key leaks into published Markdown;
- one atomic commit contains both files;
- either-path collision prevents all writes;
- regenerated and newly added heroes update the stable paths;
- removed heroes drop the Markdown reference without deleting the remote image;
- missing hero bytes produce `hero_image_unavailable` before GitHub writes;
- migration and SQLite schema synchronization; and
- version synchronization at `0.8.1`.

## Release

This change ships as BlogForge `0.8.1`, through a pull request followed by deployment to `blogforge-home` and public/internal health verification.
