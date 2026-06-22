import pytest
from pydantic import ValidationError

from blogforge.drafts.models import IdeaInput


def _base(**over):
    data = dict(topic="T", provider="tanzu", model="openai/gpt-oss-120b", use_voice_profile=True)
    data.update(over)
    return data


def test_tanzu_is_an_allowed_provider() -> None:
    # The picker offers tanzu and generation resolves it via build_provider_for;
    # IdeaInput must accept it (regression: the Literal used to exclude tanzu).
    idea = IdeaInput(**_base(provider="tanzu"))
    assert idea.provider == "tanzu"


def test_pack_slug_optional_in_voice_profile_mode() -> None:
    # Profile mode materializes the profile and never reads pack_slug, so a
    # fresh profile-only user (no packs) can compose with an empty pack_slug.
    idea = IdeaInput(**_base(use_voice_profile=True, pack_slug=""))
    assert idea.pack_slug == ""


def test_pack_slug_required_in_pack_mode() -> None:
    with pytest.raises(ValidationError):
        IdeaInput(**_base(use_voice_profile=False, pack_slug=""))


def test_pack_mode_with_pack_slug_ok() -> None:
    idea = IdeaInput(**_base(use_voice_profile=False, pack_slug="my-pack"))
    assert idea.pack_slug == "my-pack"
