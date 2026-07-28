"""Deterministic checks for the 2026 lever additions."""
from uuid import uuid4

from blogforge.drafts.models import Draft, IdeaInput, Section
from blogforge.generate.geo import (
    generate_alt_text,
    generate_citation,
    generate_faq,
    generate_opener,
    generate_queries,
    generate_quotes,
    generate_table,
    generate_takeaways,
    score_structural,
)


class _PromptRecorder:
    name = "prompt-recorder"

    def __init__(self, text: str) -> None:
        self.text = text
        self.calls: list[dict[str, object]] = []

    async def complete(self, **kwargs):  # type: ignore[no-untyped-def]
        from blogforge.llm.base import LLMResponse

        self.calls.append(kwargs)
        return LLMResponse(
            text=self.text,
            input_tokens=1,
            output_tokens=1,
            model="m",
            finish_reason="stop",
        )

    @property
    def prompt(self) -> str:
        assert len(self.calls) == 1
        return str(self.calls[0]["prompt"])


def _assert_rule_pair(prompt: str, instruction: str, rationale: str) -> None:
    assert f"Rule: {instruction}\nBecause: {rationale}" in prompt


def _fake_pack(tmp_path):  # type: ignore[no-untyped-def]
    root = tmp_path / "pack"
    root.mkdir()
    (root / "stylepack.yaml").write_text(
        "spec_version: '1.0'\npack:\n  slug: dan\n  name: Dan\n  version: '1.0'\n  author: Dan\n"
        "persona:\n  identity: x\n  one_line: y\n"
    )
    (root / "style-guide.md").write_text("Be brief.\n")
    return root


def make_draft(*, title: str = "My Post", first_para: str = "", body: str = "") -> Draft:
    """Minimal single-section Draft fixture (test_geo.py has no importable
    make_draft helper — its _draft/_sec pattern copied here per the brief)."""
    content = "\n\n".join(p for p in (first_para, body) if p)
    idea = IdeaInput(topic=title, pack_slug="", provider="tanzu", model="m")
    section = Section(
        id=uuid4().hex,
        title="Body",
        content_md=content,
        status="edited",
        word_count=len(content.split()),
    )
    return Draft(title=title, idea=idea, sections=[section], stage="sections")


async def test_generate_faq_prompt_renders_grounding_skip_and_json_rules(tmp_path) -> None:  # type: ignore[no-untyped-def]
    provider = _PromptRecorder('{"faqs": [{"q": "What is BlogForge?", "a": "A drafting tool."}]}')
    draft = make_draft(body="BlogForge is a drafting tool.")

    await generate_faq(
        draft,
        _fake_pack(tmp_path),
        {},
        provider,
        model="m",
        questions=["What is BlogForge?", "What does it cost?"],
    )

    _assert_rule_pair(
        provider.prompt,
        "Base every question and answer only on the draft.",
        "Unsupported material damages factual trust and makes attribution unreliable.",
    )
    _assert_rule_pair(
        provider.prompt,
        "Answer exactly the supplied reader questions, and skip any the draft cannot support.",
        "Guessing would turn a coverage fix into unsupported content.",
    )
    _assert_rule_pair(
        provider.prompt,
        "Return JSON matching the FAQ schema.",
        "Downstream code parses this response, so extra or malformed content breaks the workflow.",
    )


async def test_generate_opener_prompt_renders_sentence_grounding_and_output_rules(tmp_path) -> None:  # type: ignore[no-untyped-def]
    provider = _PromptRecorder("BlogForge is a drafting tool that turns notes into posts.")

    await generate_opener(make_draft(), _fake_pack(tmp_path), {}, provider, model="m")

    _assert_rule_pair(
        provider.prompt,
        "Write exactly one sentence.",
        "The client prepends the result as one opening sentence.",
    )
    _assert_rule_pair(
        provider.prompt,
        "Ground the sentence only in the draft and invent nothing.",
        "Unsupported material damages factual trust and makes attribution unreliable.",
    )
    _assert_rule_pair(
        provider.prompt,
        "Return only the sentence, with no quotes, heading, or explanation.",
        "The client prepends this response verbatim.",
    )


async def test_generate_table_prompt_renders_grounding_and_markdown_only_rules(tmp_path) -> None:  # type: ignore[no-untyped-def]
    provider = _PromptRecorder("| Option | Cost |\n| --- | --- |\n| A | $1 |")
    draft = make_draft(body="Option A costs $1.")

    await generate_table(
        draft,
        draft.sections[0].id,
        _fake_pack(tmp_path),
        {},
        provider,
        model="m",
    )

    _assert_rule_pair(
        provider.prompt,
        "Use only facts, numbers, and options stated in the source section.",
        "Unsupported material damages factual trust and makes attribution unreliable.",
    )
    _assert_rule_pair(
        provider.prompt,
        "Return only one valid Markdown table, with no title or prose.",
        "The client splices this response directly into the source section.",
    )


async def test_generate_quotes_prompt_renders_verbatim_length_count_and_json_rules() -> None:
    source = "BlogForge turns source notes into posts."
    provider = _PromptRecorder('{"quotes": ["BlogForge turns source notes into posts."]}')

    await generate_quotes(source, provider, model="m")

    _assert_rule_pair(
        provider.prompt,
        "Copy every selected passage exactly, character for character.",
        "Changed wording would falsely attribute words to the source.",
    )
    _assert_rule_pair(
        provider.prompt,
        "Select 2-3 passages of one or two sentences and fewer than 60 words each.",
        "The citation picker needs a short, usable set of compact quotations.",
    )
    _assert_rule_pair(
        provider.prompt,
        "Return JSON matching the quotations schema.",
        "Downstream code parses this response, so extra or malformed content breaks the workflow.",
    )


async def test_generate_takeaways_prompt_renders_grounding_voice_and_json_rules(tmp_path) -> None:  # type: ignore[no-untyped-def]
    provider = _PromptRecorder('{"takeaways": ["BlogForge turns notes into posts."]}')

    await generate_takeaways(make_draft(), _fake_pack(tmp_path), provider, model="m")

    _assert_rule_pair(
        provider.prompt,
        "Ground every takeaway strictly in the draft and invent nothing.",
        "Unsupported material damages factual trust and makes attribution unreliable.",
    )
    _assert_rule_pair(
        provider.prompt,
        "Make every takeaway stand alone in the author's voice.",
        "Each bullet may be extracted independently and should still sound like the author.",
    )
    _assert_rule_pair(
        provider.prompt,
        "Return JSON matching the takeaways schema.",
        "Downstream code parses this response, so extra or malformed content breaks the workflow.",
    )


async def test_generate_alt_text_prompt_renders_limit_boilerplate_and_output_rules() -> None:
    provider = _PromptRecorder("Diagram of notes flowing into a finished post")

    await generate_alt_text(
        "![](workflow.png)",
        "The diagram shows notes flowing into BlogForge and a finished post coming out.",
        provider,
        model="m",
    )

    _assert_rule_pair(
        provider.prompt,
        "Keep the alt text under 120 characters.",
        "Concise descriptions are easier for screen-reader users to understand.",
    )
    _assert_rule_pair(
        provider.prompt,
        "Do not begin with boilerplate such as 'Image of' or 'Picture of'.",
        "Screen readers already announce that the element is an image.",
    )
    _assert_rule_pair(
        provider.prompt,
        "Return only the alt text, with no quotes or explanation.",
        "The client inserts this response directly into the image's alt-text slot.",
    )


async def test_generate_queries_prompt_renders_coverage_count_and_json_rules(tmp_path) -> None:  # type: ignore[no-untyped-def]
    provider = _PromptRecorder('{"queries": ["how does BlogForge work"]}')

    await generate_queries(make_draft(), _fake_pack(tmp_path), provider, model="m")

    _assert_rule_pair(
        provider.prompt,
        "Include only topics the post actually covers.",
        "Unsupported material damages factual trust and makes attribution unreliable.",
    )
    _assert_rule_pair(
        provider.prompt,
        "Return 6-10 natural-language search queries.",
        "The citation-check workflow needs a focused but useful query set.",
    )
    _assert_rule_pair(
        provider.prompt,
        "Return JSON matching the queries schema.",
        "Downstream code parses this response, so extra or malformed content breaks the workflow.",
    )


async def test_generate_citation_prompt_renders_bounded_preservation_and_output_rules(
    tmp_path,  # type: ignore[no-untyped-def]
) -> None:
    quote = "Deployments complete in twelve minutes."
    provider = _PromptRecorder(
        'Acme reports, "Deployments complete in twelve minutes."'
    )

    await generate_citation(
        "Deployments are fast.",
        "Acme report",
        "https://example.com/report",
        _fake_pack(tmp_path),
        provider,
        model="m",
        quote=quote,
    )

    _assert_rule_pair(
        provider.prompt,
        "Add only the requested source attribution and optional supplied quotation.",
        "This is a bounded citation edit, not permission to rewrite the passage.",
    )
    _assert_rule_pair(
        provider.prompt,
        "Do not change the passage's meaning or invent information.",
        "This is a bounded edit and must not damage the approved article.",
    )
    _assert_rule_pair(
        provider.prompt,
        "Preserve a supplied quotation verbatim.",
        "A changed quotation would falsely attribute words to the source.",
    )
    _assert_rule_pair(
        provider.prompt,
        "Return only the rewritten passage.",
        "The client replaces the selected passage with this response.",
    )


def test_answer_capsule_detects_capsule() -> None:
    # ~50-word link-free opening paragraph mentioning the title entity.
    opener = ("BlogForge is a drafting tool that writes long-form posts in your own "
              "voice. It researches a topic, plans one coherent outline, composes the "
              "whole draft in a single pass, and then strips the telltale phrases that "
              "make text read as machine-written, before you edit.")
    d = make_draft(title="BlogForge review", first_para=opener)
    res = score_structural(d)
    assert res["answer_capsule"]["score"] >= 80


def test_answer_capsule_flags_missing_capsule() -> None:
    d = make_draft(title="BlogForge review", first_para="Short.")
    res = score_structural(d)
    assert res["answer_capsule"]["score"] <= 50
    assert res["answer_capsule"]["findings"]


def test_definitive_language_penalizes_hedges() -> None:
    hedgy = ("It might be possible that this could perhaps work. Some believe it "
             "may help. It seems the results could arguably vary somewhat.")
    d = make_draft(body=hedgy)
    res = score_structural(d)
    assert res["definitive_language"]["score"] <= 40
    assert res["definitive_language"]["findings"]


def test_definitive_language_ignores_dated_attribution_month_may() -> None:
    # "May" the month (capitalized, in a dated attribution) is exactly the
    # GOOD form the freshness/stat_attribution levers reward — it must NOT be
    # mistaken for the hedge word "may". A genuinely hedged paragraph should
    # still score low right alongside it.
    dated = (
        "Costs fell 31% as of May 2026, per Ahrefs. In May, we shipped the fix "
        "and adoption grew 12% by June 2026, per our own dashboard."
    )
    d = make_draft(body=dated)
    res = score_structural(d)["definitive_language"]
    assert res["score"] >= 80
    assert not res["findings"]

    hedgy = ("It might be possible that this could perhaps work. Some believe it "
             "may help. It seems the results could arguably vary somewhat.")
    d2 = make_draft(body=hedgy)
    res2 = score_structural(d2)["definitive_language"]
    assert res2["score"] <= 40
    assert res2["findings"]


def test_page_front_load_rewards_facts_up_top() -> None:
    front = "We measured 42ms p95. Costs fell 31% in 2026. " * 3
    back = "This is narrative filler with no numbers at all. " * 20
    d = make_draft(body=front + back)
    assert score_structural(d)["page_front_load"]["score"] >= 70
