from blogforge.voice.enforce import (
    RuleViolations,
    build_repair_prompt,
    detect_violations,
    deterministic_backstop,
    enforce_voice_rules,
)
from blogforge.voice.packs.manifest import Banished, Manifest, Pack, Persona


def _manifest(words: tuple[str, ...] = ()) -> Manifest:
    return Manifest(
        spec_version="1.0",
        pack=Pack(slug="t", name="T", version="1", author="a"),
        persona=Persona(identity="A writer", one_line="Writes plainly."),
        banished=Banished(words=list(words)),
    )


class _FakeResp:
    def __init__(self, text: str) -> None:
        self.text = text


class _FakeProvider:
    """Records calls and replies with a fixed string."""

    def __init__(self, reply: str) -> None:
        self.reply = reply
        self.calls = 0

    async def complete(self, *, model: str, prompt: str, json_schema=None) -> _FakeResp:
        self.calls += 1
        return _FakeResp(self.reply)


def test_backstop_guarantees_no_dashes() -> None:
    em_dash = "\N{EM DASH}"
    en_dash = "\N{EN DASH}"
    out = deterministic_backstop(f"a {em_dash} b, c{en_dash}d, e--f")
    assert em_dash not in out
    assert en_dash not in out
    assert "a - b" in out
    assert "c - d" in out
    assert "e - f" in out


def test_detect_finds_em_dash_and_banished() -> None:
    v = detect_violations(_manifest(words=("delve",)), "We delve into it — really.")
    assert v.em_dash is True
    assert "delve" in v.banished


def test_detect_clean_text_has_no_violations() -> None:
    v = detect_violations(_manifest(), "The cat sat on the warm rug today.")
    assert v.any is False


def test_repair_prompt_pairs_output_constraint_with_its_reason() -> None:
    repair_prompt = build_repair_prompt("We delve into it.", RuleViolations(banished=["delve"]))
    assert "Rule: Return only the corrected text." in repair_prompt
    assert "Because: Downstream code replaces the original passage" in repair_prompt


async def test_enforce_strips_em_dash_even_if_model_ignores() -> None:
    # The model "repairs" but leaves an em dash; the deterministic backstop must
    # still guarantee it's gone.
    prov = _FakeProvider(reply="Still has — a dash in it.")
    out = await enforce_voice_rules("Original — text here.", _manifest(), prov, "m")
    assert prov.calls == 1
    assert "—" not in out


async def test_enforce_skips_clean_text_without_calling_model() -> None:
    prov = _FakeProvider(reply="should not be used")
    out = await enforce_voice_rules("The cat sat on the rug.", _manifest(), prov, "m")
    assert prov.calls == 0
    assert out == "The cat sat on the rug."
