from blogforge.generate.suggest import parse_suggestions


def test_parses_well_formed_suggestions() -> None:
    raw = (
        '{"suggestions": ['
        '{"target": "We grew 300%.", "note": "verify the stat", "options": []},'
        '{"target": "It was good.", "note": "vague", "options": ["It doubled retention.", "It won."]}'
        "]}"
    )
    out = parse_suggestions(raw, n=5)
    assert len(out) == 2
    assert out[0] == {"target": "We grew 300%.", "note": "verify the stat", "options": []}
    assert out[1]["options"] == ["It doubled retention.", "It won."]


def test_drops_entries_without_target_and_coerces_options() -> None:
    raw = '{"suggestions": [{"target": "", "note": "x"}, {"target": "Keep", "note": "", "options": ["a", "", "b"]}]}'
    out = parse_suggestions(raw, n=5)
    assert out == [{"target": "Keep", "note": "", "options": ["a", "b"]}]


def test_caps_at_n_and_defaults_options() -> None:
    raw = '{"suggestions": [%s]}' % ",".join(f'{{"target": "T{i}"}}' for i in range(8))
    out = parse_suggestions(raw, n=3)
    assert len(out) == 3
    assert out[0] == {"target": "T0", "note": "", "options": []}


def test_bad_json_returns_empty() -> None:
    assert parse_suggestions("nope", n=5) == []
    assert parse_suggestions('{"suggestions": "notalist"}', n=5) == []
