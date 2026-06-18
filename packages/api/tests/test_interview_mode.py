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
        yield  # noqa: unreachable — marks this an async generator


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
    assert "EXACTLY ONE focused question" in prompt


async def test_ideate_mode_does_not_use_interview_block() -> None:
    prompt = await _capture("ideate")
    assert "interviewing the author" not in prompt
    assert "go back and forth" in prompt  # the collaborative block's wording
