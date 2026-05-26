# Pencraft

Local-first long-form drafting tool. Give Pencraft a topic and a [myvoice](https://github.com/dbbaskette/myvoice) style pack; it proposes an outline, lets you edit it, then expands each section in your voice.

> **Status:** Phase 1 (v1). Design committed; implementation in progress.

## Why

[myvoice](https://github.com/dbbaskette/myvoice) gives writers a portable style pack and a Compose & test loop that rewrites paragraphs in their voice. Pencraft starts a level above: paste a topic, get a 1,000–3,000 word draft you can refine. Same voice rules, same lint, just a longer surface.

## How it works

Three stages per draft:

1. **Idea** — topic, optional bullets, pick a pack and a model.
2. **Outline** — Pencraft proposes an opening hook + 5–9 sections with briefs. Edit titles, reorder, regenerate; nothing's written to disk yet beyond the draft itself.
3. **Sections** — Pencraft expands each section as the pack would (parallel, streaming). Edit any section by hand or regenerate just that one. Download the assembled markdown when you're done.

Drafts persist to `~/.pencraft/drafts/`. Resume any time.

## Quick start

1. Install myvoice and add an API key (`pipx install myvoice && myvoice serve` → Settings).
2. Install Pencraft: `pipx install pencraft`.
3. Run `pencraft serve`. Browser opens at `localhost:7880`.
4. Click "+ New draft", fill in a topic, pick a voice pack, generate outline, expand sections.
5. Download the `.md` when you're happy.

![3-stage flow](docs/screenshots/pencraft-flow.png)

## Install

```bash
brew install pipx
pipx ensurepath
pipx install pencraft
pencraft serve
```

Browser opens at `http://localhost:7880`.

Pencraft reads API keys from `~/.myvoice/config.yaml`. Add at least one provider key in myvoice's Settings page (`localhost:7878`) before generating.

## Requires

- [myvoice](https://github.com/dbbaskette/myvoice) installed and configured (Pencraft imports `myvoice` as a library for pack loading + lint + prompt composition).
- An API key for one of: Anthropic, OpenAI, Google. Set in myvoice's Settings.

## Design

See `docs/superpowers/specs/2026-05-26-pencraft-v1-design.md`.

## Development

```bash
./scripts/dev.sh         # backend on :7880, Vite dev on :7881
./scripts/install-local.sh   # build wheel + install into local-venv/
./scripts/run-local.sh       # run the installed wheel
```
