# Interview-Style Ideation — Design Spec

**Date:** 2026-06-18
**Status:** Built (part of the Lint+Interview+Sources batch).
**Scope:** Add an AI-led "interview" mode to the research-stage ideation chat: the assistant asks the author one focused question at a time and proposes an outline only once it has enough. Reuses the entire ideation SSE + outline-accept pipeline; the only behavioral change is the system prompt + a `mode` flag.

## Goal
Today's ideation is author-led: you prompt, the AI proposes an outline. Add the inverse — the AI interviews you. You pick "Interview me," click "Start the interview," and it asks questions one at a time, building toward an outline you can accept (same accept flow).

## Decisions
- **One toggle, two modes:** `ideate` (today's collaborative chat, default) and `interview` (AI-led). The mode rides each `/ideation/message` request.
- **AI goes first:** in interview mode an empty transcript shows "Start the interview →", which posts a fixed kickoff so the assistant asks question 1 without the author writing the first prompt.
- **Ends in the existing accept flow:** the interview block instructs the model to emit the OutlineProposal JSON only once it has enough, so the existing parse + "Accept this outline" path works unchanged.

## Architecture
**Backend (no migration):**
- `generate/ideation.py`: add `INTERVIEW_SYSTEM_BLOCK` (ask exactly one question per reply; no JSON until ready; then emit the standard OutlineProposal JSON). `stream_ideation(..., mode="ideate"|"interview")` selects the block.
- `api/ideation.py`: `_MessageBody.mode: Literal["ideate","interview"] = "ideate"`, threaded through `_run_ideation` → `stream_ideation`.

**Frontend:**
- `api/ideation.ts`: `postIdeationMessage(draftId, content, mode="ideate")`.
- `ResearchPanel.tsx`: a Chat/Interview toggle in the header; mode-aware heading/placeholder; a "Start the interview →" kickoff when interview mode + empty transcript; every send carries the current `mode`.

## Testing
- Backend: `stream_ideation(mode="interview")` injects the interview block; `ideate` does not.
- Frontend: existing `ResearchPanel` send test updated for the `mode` argument; suite green.

## Out of scope
- Persisting the chosen mode on the draft (it's a per-session UI choice).
- A distinct interview transcript style (reuses the existing chat bubbles).

## Success criteria
Selecting "Interview me" + "Start the interview" makes the assistant ask one question at a time and, after a few exchanges, propose an acceptable outline — through the existing pipeline, no migration.
