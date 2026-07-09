"""GET /api/help/rules — live rule data for the Help page."""
from __future__ import annotations


def test_help_rules_shape(authed_client) -> None:
    client, _uid = authed_client
    r = client.get("/api/help/rules")
    assert r.status_code == 200
    j = r.json()
    h, g = j["humanize"], j["geo"]
    assert "plethora" in [w.lower() for w in h["words"]]
    assert h["patterns"] and all(p["title"] and p["body"] for p in h["patterns"])
    lenses = {lens["key"]: lens for lens in h["lenses"]}
    assert {"flow", "voice", "imperfections", "soul"} <= set(lenses)
    for key in ("flow", "voice", "imperfections", "soul"):
        assert lenses[key]["points"], f"{key} lens should have non-empty points"
    guardrail_points = lenses["guardrail"]["points"]
    assert guardrail_points, "guardrail lens should have non-empty points"
    assert any("never invent" in p.lower() for p in guardrail_points)
    levers = {lever["key"]: lever for lever in g["levers"]}
    assert len(levers) == 27
    assert abs(sum(lever["weight"] for lever in g["levers"]) - 1.0) < 1e-9
    assert levers["information_gain"]["detection"] == "judgment"
    assert levers["answer_capsule"]["detection"] == "structural"
    assert all(lever["impact"] for lever in g["levers"])
