# BlogForge: Blog Author Source Brief

**Purpose:** This document is source material for writing an accurate blog post about BlogForge. It describes the product's intent, workflow, technical implementation, design choices, and current state. Treat it as a factual snapshot **as of July 30, 2026**. Do not imply features, benchmarks, customer outcomes, or future plans that are not supported here.

## The short version

BlogForge is a local-first, multi-user workshop for long-form writing. It uses AI to help an author research, plan, draft, edit, check, repurpose, and publish a post, while making the author's own voice and explicit writing rules central to the process. It is designed to avoid the usual failure mode of AI writing tools: generic, repetitive prose that feels detached from the person whose name will be on it.

The central product premise is simple: an AI-generated draft should be a coherent piece of writing that an author can genuinely make their own, not a wall of disposable text. BlogForge therefore starts with an author's voice, plans a complete argument, writes the article in a single coherent pass, and provides an editor and review tools for the final human decisions.

## The problem it was designed to solve

Many AI writing tools can produce words quickly but struggle to produce a publishable article. Common problems include:

- Prose that has no recognizable authorial voice.
- Repetitive sections because each section is generated independently.
- Familiar AI mannerisms: overused transitions, vague abstractions, em dashes, repeated sentence shapes, and banned words slipping through.
- A weak workflow between a rough idea and a finished, formatted post.
- A lack of control over sources, factual claims, revision history, credentials, and the final publishing destination.

BlogForge is intentionally built around the opposite model. It treats AI as part of a writing studio: useful for structured research and drafting, but bounded by the writer's sources, voice, rules, edits, and publishing decisions.

## Who it is for

The product is aimed at people who write substantive posts under their own names: founders, practitioners, consultants, technical writers, operators, and other writers who want AI assistance without surrendering voice or editorial ownership. It is not positioned as a one-click content farm. The intended outcome is a strong editable draft and a reliable path to a finished post.

## The core writing workflow

Each draft moves through three connected stages.

### 1. Research

The writer starts with a topic and can attach URLs, uploaded files, and notes as references. They can discuss the idea with the model before committing to an outline. The references and research conversation stay attached to the draft, so they can inform later outline generation and revisions.

The point of this stage is not simply to collect material. It gives the writer a way to establish the argument, source boundaries, and useful context before prose is generated.

### 2. Outline

The writer works with an opening hook and a set of section titles and briefs. Sections can be edited, reordered, or regenerated. The intended shape is one non-overlapping narrative arc rather than a list of loosely related points. BlogForge right-sizes the number of sections to the target length, generally about three to seven sections for a long-form article.

### 3. Sections and editing

When the outline is ready, BlogForge composes the complete post in a single model call, then maps the resulting text back into editable sections. This is a deliberate architectural choice: generating the full article in one pass helps sections build on one another, avoids repeating the thesis, and preserves a unified argument.

The writer can then edit directly, regenerate a single section, revise the whole draft with an instruction, use inline AI transformations on selected text, or restore an earlier section version. Autosave and version history protect the writer's work during those operations.

## Voice is a first-class input

BlogForge's most important differentiator is its focus on an author's voice. The **Your Voice** area brings together several kinds of information:

- A persona: identity, one-line description, and desired tone.
- Writing samples pasted by the user, fetched from a URL, uploaded from a file, or imported from a LinkedIn data export.
- “Exemplar” samples that the writer identifies as especially representative and that receive greater emphasis.
- A reusable style guide distilled by an LLM from the samples.
- Explicit rules, including banned words or phrases and prohibitions on em dashes and double hyphens.

The application can also render a **Voice Fingerprint**: an LLM-scored display of tonal dimensions, signature phrases, sentence rhythm, and banned language. An **Audition** feature lets writers try a flat sentence and see it recast in the configured voice before they use that voice for a draft.

BlogForge builds on ideas and assets absorbed from the earlier `myvoice` project: portable style packs, AI-tell detection, and prompt composition based on voice guidance.

## Voice rules are enforced, not merely requested

A key design decision is that certain writing rules are not left as gentle prompt suggestions. After generation, BlogForge deterministically checks for violations such as em dashes, `--`, and configured banned language. If it finds violations, it asks the model to recast the affected text while preserving meaning and voice. If a violation still remains, a deterministic backstop removes it.

That approach distinguishes a hard rule from a hope that a prompt will be followed. It also makes the system's behavior easier to explain and verify.

## Review, quality, and human control

BlogForge has several post-draft review tools:

- **Proofreader:** style-rule linting and repetition checks for duplicated paragraphs, recycled phrases, and echoed openers, with one-click fixes.
- **Humanization Check:** a transparent display separating deterministic voice-rule findings from LLM-generated Humanize suggestions. It intentionally avoids presenting a blended “reads human” percentage as if it were a validated measurement of authorship.
- **Fact-check:** evaluates factual claims in the draft against the references attached by the writer, marking claims as supported, unsupported, or contradicted.
- **Headline and hook lab:** generates alternative titles or openings that the writer may apply.
- **Section history:** each relevant edit or regeneration can create a snapshot; a section-level diff shows additions and deletions before a writer restores a prior version.

The product's stance is that these tools should make editorial judgments visible and actionable, not conceal them behind a misleading score.

## From one article to other formats

Once a draft is complete, BlogForge can repurpose it into an X thread, LinkedIn post or article, newsletter, TL;DR, SEO meta description, email, and related outputs. “Atomize all” produces multiple channel-specific versions at once.

It also supports controlled length variations. A writer can generate a summary targeted to about 50% of the source article's word count, an extended version targeted to about 150%, or a LinkedIn post targeted to a defined character range. The application measures the result, attempts one correction when it misses the target, displays any remaining miss honestly, and can save the variation as a separate editable draft without changing the source draft.

## Output and publishing

BlogForge supports exports to Markdown, Markdown with YAML frontmatter, standalone HTML, and Word (`.docx`). It can generate a hero image with Google Imagen and include that image in HTML export and Markdown frontmatter.

The application can also publish directly to a user-configured GitHub content repository. A user configures a repository, branch, content directory, and frontmatter style (Hugo, Jekyll, or plain Markdown), then publishes from a completed draft. Generated hero graphics are stored beside the article and committed together.

The publishing implementation is deliberately conservative:

- Publishing credentials are a per-user fine-grained GitHub personal access token, separate from sign-in OAuth.
- Tokens are encrypted at rest, never returned to the browser after saving, and should be scoped only to the selected repository with Contents read/write permission.
- The first publish fixes the article's repository path; later publishes update that same path even if the title changes.
- BlogForge records the GitHub file SHA and refuses to overwrite an externally changed post. It stops with a conflict so the writer can resolve the repository copy intentionally.

The aim is to make publishing convenient without turning an automation mistake into lost work.

## Technical architecture

BlogForge is a web application with a React/Vite frontend and a Python FastAPI backend.

- **Frontend:** React, TypeScript, Vite, TipTap-based rich-text editing, and browser-side draft workflow UI.
- **Backend:** FastAPI, Pydantic, SQLAlchemy async support, Alembic migrations, and a command-line entry point (`blogforge`).
- **Data:** production-oriented deployments use PostgreSQL for structured data and S3-compatible object storage such as MinIO for blobs and uploaded content. The simplest local mode uses file-backed SQLite and filesystem storage under a configurable data directory, so local use does not require standing up Postgres or object storage.
- **Authentication and tenancy:** GitHub OAuth sign-in, an allowlist/admin model, server-side sessions, and per-user scoping for drafts, references, provider keys, and publishing settings.
- **Secrets:** provider API keys and GitHub publishing tokens are encrypted at rest. Secret material is not returned by settings APIs and is not intended to reach logs.

The API and web application are tested separately. The repository includes automated tests covering account isolation, storage, provider resolution, prompts, drafting, references, exports, publishing conflicts, and frontend workflow behavior.

## Model providers and deployment choices

BlogForge supports several ways to generate content. A writer chooses a provider per draft.

- **Anthropic, OpenAI, and Google:** users supply their own API keys in Settings; the keys are encrypted at rest. The app can show per-draft estimates using a static rate card.
- **Tanzu:** when deployed to Tanzu Platform with a bound GenAI model, BlogForge can use the bound model without requiring a user-provided key.
- **Claude CLI and Codex CLI:** when the backend runs on a host with the relevant CLI installed and authenticated, BlogForge can generate through the user's subscription rather than a direct API key. The CLI routes can use web search and fetch capabilities where the underlying CLI supports them.

The application can run with Docker in a production-like Postgres/MinIO stack, in a single local container with persisted filesystem data, directly on a host with SQLite, or on Tanzu Platform using the Python buildpack. This flexibility reflects the local-first goal: the useful default should not require a large infrastructure footprint.

## Design principles worth emphasizing in a blog

### Coherence over section-by-section volume

Generating the article as a whole is more important than generating many isolated snippets quickly. It makes the argument more coherent and reduces repetition.

### Voice and constraints over generic fluency

The system makes an author's samples, style guide, and hard rules visible inputs. It does not assume a fluent-looking model response is automatically a good fit for the author.

### Transparent checks over synthetic certainty

The Humanization Check reports concrete lint findings and advisory model suggestions rather than claiming to know whether writing “reads human” by means of a percentage.

### Human editorial ownership over autonomous publishing

AI can produce drafts, alternatives, and fixes, but writers decide what to keep, what to publish, and how to resolve conflicts. Version history, reference-backed checks, and safe publishing behavior reinforce that role.

### Local-first practicality with multi-user safeguards

The software is designed to be easy to run locally while still supporting multi-user accounts, per-user data boundaries, encrypted credentials, and more production-oriented deployment paths.

## Current status and recent work

As of July 30, 2026, BlogForge is an active, evolving project. Recent repository work includes:

- Draft length variations that can be saved as new drafts.
- Replacing a blended humanity percentage with a more transparent humanization review.
- Rule rationales that make model and voice constraints easier to understand.
- GitHub publishing, including generated hero-image sidecar publishing.
- Per-user GitHub publishing configuration and safer republishing behavior.

The project versioning visible in the web package is in the 0.x stage, which is appropriate context for a blog: the product is capable and end-to-end, while its workflows and presentation are still being deliberately refined.

## Claims to make carefully

Avoid these unsupported or misleading claims:

- Do not say BlogForge proves that text was written by a human or detects AI authorship. Its humanization tools report rule findings and model suggestions, not forensic certainty.
- Do not claim factual accuracy is guaranteed. Fact-checking compares claims with attached references and highlights issues for the writer to judge.
- Do not frame it as fully autonomous publishing. The writer configures a destination, initiates publishing, and handles repository conflicts deliberately.
- Do not imply every model provider, deployment configuration, or optional integration is required for normal use.
- Do not claim public adoption, performance figures, or time savings without separately sourced evidence.

## Useful story angles

A strong blog can lead with one of these narratives:

1. **Why AI writing needs a workshop, not a generate button.** Explain the shift from generic generation toward voice, planning, editing, and publishing safeguards.
2. **The technical reason a full draft is generated in one pass.** Explore the relationship between generation architecture and a coherent argument.
3. **What “write in my voice” requires beyond a prompt.** Cover samples, exemplars, distilled guidance, banned language, deterministic enforcement, and review.
4. **Designing AI quality checks without fake precision.** Use the Humanization Check as an example of choosing transparent findings over an attractive but misleading score.
5. **Making direct publishing safe enough to be useful.** Discuss per-user credentials, encrypted storage, stable paths, and SHA-conflict protection.

## Suggested framing

The most faithful framing is that BlogForge is an opinionated writing environment. It uses AI for speed and leverage, but it is built for writers who care about voice, argument, sources, revision, and the final published artifact. The distinctive idea is not that it can generate a blog post. It is that it treats the full path from personal voice to safe publication as one connected system.
