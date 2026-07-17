from datetime import datetime

from blogforge.db.models import Draft, User, UserPublishingSettings


async def test_publishing_settings_defaults_and_belongs_to_user(session) -> None:
    user = User(email="publisher@example.com", status="approved", role="user")
    session.add(user)
    await session.flush()

    settings = UserPublishingSettings(user_id=user.id, owner="dbbaskette", repo="blog-content")
    session.add(settings)
    await session.commit()

    assert settings.branch == "main"
    assert settings.content_dir == "content/posts"
    assert settings.frontmatter_preset == "hugo"
    assert isinstance(settings.created_at, datetime)


async def test_draft_publication_metadata_defaults_to_unpublished(session) -> None:
    user = User(email="writer@example.com", status="approved", role="user")
    session.add(user)
    await session.flush()
    draft = Draft(user_id=user.id, title="Post", stage="research", idea={"topic": "Post"})
    session.add(draft)
    await session.commit()

    assert draft.published_at is None
    assert draft.published_path is None
    assert draft.published_sha is None
    assert draft.published_commit_url is None
