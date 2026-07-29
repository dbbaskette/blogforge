"""Repurpose previews and saving them as separate editable drafts."""

from __future__ import annotations

from pathlib import Path

import pytest

import blogforge.api.repurpose as repurpose_api
from blogforge.generate.repurpose import LengthMetadata, RepurposeResult
from tests.conftest import _seed_approved_user, _signed_client


def _source(client) -> dict[str, object]:
    source = client.post(
        "/api/drafts/import",
        json={
            "text": "# Original\n\n## First\n\nSource text.",
            "pack_slug": "dan",
            "provider": "anthropic",
            "model": "model-a",
            "target_words": 1200,
            "use_voice_profile": True,
        },
    ).json()
    return client.patch(
        f"/api/drafts/{source['id']}/tags",
        json={"tags": ["source", "essay"]},
    ).json()


async def test_generate_repurpose_returns_length_metadata(
    authed_client, monkeypatch: pytest.MonkeyPatch, tmp_path: Path
) -> None:
    client, _ = authed_client
    source = _source(client)
    (tmp_path / "stylepack.yaml").write_text("samples: []\n")

    async def fake_resolve_voice(*args, **kwargs) -> Path:
        return tmp_path

    async def fake_build_provider(*args, **kwargs) -> object:
        return object()

    async def fake_repurpose(*args, **kwargs) -> RepurposeResult:
        return RepurposeResult(
            text="Generated preview",
            length=LengthMetadata(
                metric="words",
                actual=100,
                minimum=90,
                maximum=110,
                within_target=True,
                correction_attempted=False,
            ),
        )

    monkeypatch.setattr(repurpose_api, "resolve_voice", fake_resolve_voice)
    monkeypatch.setattr(repurpose_api, "build_provider_for", fake_build_provider)
    monkeypatch.setattr(repurpose_api, "repurpose", fake_repurpose)

    response = client.post(
        f"/api/drafts/{source['id']}/repurpose",
        json={"format": "summary"},
    )

    assert response.status_code == 200
    assert response.json() == {
        "format": "summary",
        "text": "Generated preview",
        "length": {
            "metric": "words",
            "actual": 100,
            "minimum": 90,
            "maximum": 110,
            "within_target": True,
            "correction_attempted": False,
        },
    }


@pytest.mark.parametrize(
    ("fmt", "suffix"),
    [
        ("summary", "Summary"),
        ("extended", "Extended"),
        ("linkedin", "LinkedIn Post"),
    ],
)
async def test_save_variation_creates_editable_tagged_draft(
    authed_client, fmt: str, suffix: str
) -> None:
    client, _ = authed_client
    source = _source(client)

    response = client.post(
        f"/api/drafts/{source['id']}/repurpose/save",
        json={"format": fmt, "text": "## Result\n\nGenerated preview text."},
    )

    assert response.status_code == 201
    saved = response.json()
    assert saved["id"] != source["id"]
    assert saved["title"] == f"Original — {suffix}"
    assert saved["stage"] == "sections"
    assert saved["tags"] == ["source", "essay"]
    assert saved["idea"]["provider"] == "anthropic"
    assert saved["idea"]["model"] == "model-a"
    assert saved["idea"]["use_voice_profile"] is True
    assert saved["sections"][0]["title"] == "Result"
    assert saved["sections"][0]["content_md"] == "Generated preview text."
    assert saved["references"] == []
    assert saved["ideation_messages"] == []
    assert saved["hero_image_key"] is None
    assert saved["published_at"] is None

    unchanged = client.get(f"/api/drafts/{source['id']}").json()
    assert unchanged["title"] == source["title"]
    assert unchanged["sections"] == source["sections"]
    assert unchanged["tags"] == source["tags"]


async def test_save_variation_rejects_blank_preview(authed_client) -> None:
    client, _ = authed_client
    source = _source(client)

    response = client.post(
        f"/api/drafts/{source['id']}/repurpose/save",
        json={"format": "summary", "text": "   "},
    )

    assert response.status_code == 422


async def test_save_variation_rejects_unsupported_format(authed_client) -> None:
    client, _ = authed_client
    source = _source(client)

    response = client.post(
        f"/api/drafts/{source['id']}/repurpose/save",
        json={"format": "email", "text": "Preview"},
    )

    assert response.status_code == 422


async def test_save_variation_is_scoped_to_source_owner(authed_client) -> None:
    owner_client, _ = authed_client
    source = _source(owner_client)
    other_id = await _seed_approved_user("other@user.com")

    with _signed_client(other_id) as other_client:
        response = other_client.post(
            f"/api/drafts/{source['id']}/repurpose/save",
            json={"format": "summary", "text": "Preview"},
        )

    assert response.status_code == 404
