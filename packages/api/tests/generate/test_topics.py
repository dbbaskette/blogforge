from blogforge.generate.topics import parse_topics


def test_parses_well_formed_json() -> None:
    raw = '{"topics": [{"title": "A", "angle": "why A"}, {"title": "B", "angle": "why B"}]}'
    out = parse_topics(raw, n=5)
    assert out == [
        {"title": "A", "angle": "why A"},
        {"title": "B", "angle": "why B"},
    ]


def test_drops_entries_without_a_title_and_defaults_angle() -> None:
    raw = '{"topics": [{"title": "", "angle": "x"}, {"title": "Real"}, {"angle": "y"}]}'
    out = parse_topics(raw, n=5)
    assert out == [{"title": "Real", "angle": ""}]


def test_caps_at_n() -> None:
    raw = '{"topics": [%s]}' % ",".join(f'{{"title": "T{i}"}}' for i in range(10))
    out = parse_topics(raw, n=3)
    assert len(out) == 3
    assert out[0] == {"title": "T0", "angle": ""}


def test_bad_json_returns_empty() -> None:
    assert parse_topics("not json at all", n=5) == []
    assert parse_topics('{"topics": "nope"}', n=5) == []
