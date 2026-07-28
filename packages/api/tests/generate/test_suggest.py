from blogforge.generate.suggest import _build_prompt, parse_suggestions


def test_prompt_renders_rules_for_reword_suggestions() -> None:
    prompt = _build_prompt("reword", "SYSTEM", "# Draft", 4)
    assert "Rule: Preserve the target's meaning and the author's voice." in prompt
    assert (
        "Rule: Do not use banished words or phrases.\n"
        "Because: These terms conflict with the author's established voice"
    ) in prompt
    assert (
        "Rule: Do not use em dashes.\n"
        "Because: This text will be read by a text-to-speech engine"
    ) in prompt
    assert "Rule: Return JSON matching the suggestions schema." in prompt
    assert "Because: Downstream code parses this response" in prompt
    assert (
        "Rule: Do not copy the `Rule` or `Because` labels or their rationales into "
        "suggestions."
    ) in prompt


def test_prompt_renders_rules_for_fact_check_suggestions() -> None:
    prompt = _build_prompt("fact_check", "SYSTEM", "# Draft", 4)
    rule = "Rule: Do not assert whether a claim is true or false; flag only what to check."
    assert rule in prompt
    assert (
        "Because: This assistant has the draft, not the evidence needed to verify factual truth."
        in prompt
    )


def test_prompt_renders_rules_for_expand_suggestions() -> None:
    prompt = _build_prompt("expand", "SYSTEM", "# Draft", 4)
    assert "Rule: Do not write the addition itself." in prompt
    assert (
        "Because: This workflow offers editorial direction while leaving the prose to the author."
        in prompt
    )


def test_parses_well_formed_suggestions() -> None:
    raw = (
        '{"suggestions": ['
        '{"target": "We grew 300%.", "note": "verify the stat", "options": []},'
        '{"target": "It was good.", "note": "vague", '
        '"options": ["It doubled retention.", "It won."]}'
        "]}"
    )
    out = parse_suggestions(raw, n=5)
    assert len(out) == 2
    assert out[0] == {"target": "We grew 300%.", "note": "verify the stat", "options": []}
    assert out[1]["options"] == ["It doubled retention.", "It won."]


def test_drops_entries_without_target_and_coerces_options() -> None:
    raw = (
        '{"suggestions": [{"target": "", "note": "x"}, '
        '{"target": "Keep", "note": "", "options": ["a", "", "b"]}]}'
    )
    out = parse_suggestions(raw, n=5)
    assert out == [{"target": "Keep", "note": "", "options": ["a", "b"]}]


def test_caps_at_n_and_defaults_options() -> None:
    raw = '{{"suggestions": [{}]}}'.format(",".join(f'{{"target": "T{i}"}}' for i in range(8)))
    out = parse_suggestions(raw, n=3)
    assert len(out) == 3
    assert out[0] == {"target": "T0", "note": "", "options": []}


def test_bad_json_returns_empty() -> None:
    assert parse_suggestions("nope", n=5) == []
    assert parse_suggestions('{"suggestions": "notalist"}', n=5) == []
