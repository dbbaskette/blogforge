"""generate/ideation: assemble prompt, stream reply, parse JSON block."""
from __future__ import annotations

from collections.abc import AsyncIterator

from blogforge.drafts.models import (
    Draft,
    IdeaInput,
    IdeationMessage,
)
from blogforge.generate.ideation import (
    IDEATION_SYSTEM_BLOCK,
    build_ideation_prompt,
    parse_proposed_outline,
    stream_ideation,
)
from blogforge.llm.base import LLMResponse, StreamChunk


def _idea() -> IdeaInput:
    return IdeaInput(
        topic="The right amount of bureaucracy",
        bullets=["bullet a", "bullet b"],
        pack_slug="dan",
        provider="anthropic",
        model="claude-x",
        target_words=1500,
        notes="aim for skeptical readers",
    )


def _draft(messages: list[IdeationMessage] | None = None) -> Draft:
    return Draft(
        id="d-1",
        idea=_idea(),
        ideation_messages=messages or [],
        stage="research",
    )


# ── prompt assembly ──────────────────────────────────────────────────

def test_build_prompt_seeds_first_user_message_from_idea():
    """When there's no history, the seed message carries the topic +
    bullets + notes so the LLM has something to react to."""
    prompt = build_ideation_prompt(_draft(), new_user_content="", reference_context="")
    assert "The right amount of bureaucracy" in prompt
    assert "bullet a" in prompt
    assert "skeptical readers" in prompt


def test_build_prompt_appends_new_user_message():
    prompt = build_ideation_prompt(
        _draft(),
        new_user_content="actually, make 5 sections punchier",
        reference_context="",
    )
    assert "5 sections punchier" in prompt


def test_build_prompt_prepends_reference_context_to_first_user_turn():
    prompt = build_ideation_prompt(
        _draft(),
        new_user_content="",
        reference_context="## Reference Materials\n\nbody body",
    )
    assert "Reference Materials" in prompt
    # the references should appear BEFORE the topic
    assert prompt.index("Reference Materials") < prompt.index("The right amount")


def test_build_prompt_includes_prior_assistant_turns():
    history = [
        IdeationMessage(id="m-1", position=0, role="user", content="seed"),
        IdeationMessage(
            id="m-2",
            position=1,
            role="assistant",
            content="here's a draft outline...",
        ),
        IdeationMessage(id="m-3", position=2, role="user", content="cut section 4"),
    ]
    prompt = build_ideation_prompt(
        _draft(history), new_user_content="and rename section 1", reference_context=""
    )
    assert "here's a draft outline" in prompt
    assert "cut section 4" in prompt
    assert "rename section 1" in prompt


def test_ideation_system_block_mentions_json():
    assert "JSON" in IDEATION_SYSTEM_BLOCK
    assert "OutlineProposal" in IDEATION_SYSTEM_BLOCK


# ── JSON block parser ───────────────────────────────────────────────

def test_parse_extracts_fenced_json_block():
    text = '''Some prose first.

```json
{
  "opening_hook": "h",
  "sections": [
    {"id": "01", "title": "T", "brief": "b"}
  ],
  "estimated_words": 1200
}
```

And maybe more chat after.
'''
    proposal = parse_proposed_outline(text)
    assert proposal is not None
    assert proposal.opening_hook == "h"
    assert len(proposal.sections) == 1
    assert proposal.estimated_words == 1200


def test_parse_returns_none_when_no_block():
    assert parse_proposed_outline("no json here, just chat") is None


def test_parse_returns_none_on_malformed_json():
    text = "Here's an outline:\n\n```json\n{not valid json}\n```"
    assert parse_proposed_outline(text) is None


def test_parse_accepts_unfenced_json_object():
    """Some models (or older snapshots) emit a bare JSON object without fencing.

    We accept the first valid {...} as a fallback."""
    text = '''ok here:

{"opening_hook": "h", "sections": [], "estimated_words": 100}
'''
    proposal = parse_proposed_outline(text)
    assert proposal is not None
    assert proposal.estimated_words == 100


# ── streaming ───────────────────────────────────────────────────────


class _StubProvider:
    """LLMProvider double that emits a canned stream + complete()."""

    name = "stub"

    def __init__(self, chunks: list[str]):
        self._chunks = chunks
        self.last_prompt: str | None = None

    async def list_models(self):  # pragma: no cover - not used in ideation tests
        return []

    async def complete(self, **kwargs) -> LLMResponse:  # pragma: no cover
        return LLMResponse(text="")

    async def stream(self, *, model: str, prompt: str) -> AsyncIterator[StreamChunk]:
        self.last_prompt = prompt
        for c in self._chunks:
            yield StreamChunk(delta=c)


async def test_stream_ideation_yields_chunks_and_returns_message_and_outline():
    chunks = [
        "Here's my proposal:\n\n```json\n",
        '{"opening_hook": "h", "sections": [], "estimated_words": 800}',
        "\n```\n",
    ]
    provider = _StubProvider(chunks)

    collected_deltas = []
    final_text = None
    final_outline = None

    async for evt in stream_ideation(
        _draft(),
        new_user_content="please propose",
        reference_context="",
        provider=provider,
        model="claude-x",
        pack_root=None,
        manifest={},
    ):
        if evt["kind"] == "delta":
            collected_deltas.append(evt["delta"])
        elif evt["kind"] == "result":
            final_text = evt["text"]
            final_outline = evt["proposed_outline"]

    assert "".join(collected_deltas) == "".join(chunks)
    assert "please propose" in (provider.last_prompt or "")
    assert final_text is not None and "opening_hook" in final_text
    assert final_outline is not None
    assert final_outline.estimated_words == 800
