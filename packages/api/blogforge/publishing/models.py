"""Domain models for a user's single GitHub publishing destination."""

from typing import Literal

from pydantic import BaseModel, Field

PublishingPreset = Literal["hugo", "jekyll", "plain"]


class PublishingSettings(BaseModel):
    owner: str = Field(min_length=1, max_length=100)
    repo: str = Field(min_length=1, max_length=100)
    branch: str = Field(default="main", min_length=1, max_length=256)
    content_dir: str = Field(default="content/posts", max_length=512)
    frontmatter_preset: PublishingPreset = "hugo"
