"""Interview mode selects the interview system block in stream_ideation."""
from blogforge.drafts.models import Draft, IdeaInput
from blogforge.generate.ideation import stream_ideation


class _CaptureProvider:
    """Records the prompt it's asked to stream; yields nothing."""

    def __init__(self) -> None:
        self.prompt: str | None = None

    async def stream(self, *, model: str, prompt: str):  # type: ignore[no-untyped-def]
        self.prompt = prompt
        return
        yield  # Marks this as an async generator.


def _draft() -> Draft:
    return Draft(
        idea=IdeaInput(topic="containers", pack_slug="house", provider="anthropic", model="m")
    )


async def _capture(mode: str) -> str:
    prov = _CaptureProvider()
    async for _ in stream_ideation(
        _draft(),
        new_user_content="hello",
        reference_context="",
        provider=prov,  # type: ignore[arg-type]
        model="m",
        pack_root=None,
        manifest={},
        mode=mode,
    ):
        pass
    assert prov.prompt is not None
    return prov.prompt


async def test_interview_mode_uses_interview_block() -> None:
    prompt = await _capture("interview")
    assert "interviewing the author" in prompt
    assert "Ask exactly one focused question" in prompt
    assert (
        "Rule: Ask exactly one focused question per reply.\nBecause: One concrete question "
        "keeps the interview easy to answer"
    ) in prompt
    assert (
        "Rule: Do not write the piece or propose an outline while information is still missing.\n"
        "Because: Premature drafting locks in assumptions"
    ) in prompt
    assert (
        "Rule: Emit no JSON until announcing that enough information has been gathered.\n"
        "Because: The client treats JSON as the transition"
    ) in prompt


async def test_ideate_mode_does_not_use_interview_block() -> None:
    prompt = await _capture("ideate")
    assert "interviewing the author" not in prompt
    assert "go back and forth" in prompt  # the collaborative block's wording
