"""LinkedIn connector settings (LINKEDIN_*-prefixed).

Shared values (database_url, session_secret, cors_origins) come from the
core pencraft.config.Settings; only the LinkedIn-specific knobs live here.
"""
from functools import lru_cache

from pydantic_settings import BaseSettings, SettingsConfigDict


class LinkedInSettings(BaseSettings):
    model_config = SettingsConfigDict(
        env_prefix="LINKEDIN_",
        env_file=None,
        extra="ignore",
    )

    # OAuth app credentials (operator-supplied; empty in dev/test).
    client_id: str = ""
    client_secret: str = ""
    redirect_uri: str = "http://localhost:7890/linkedin/callback"

    # Where to send the browser after a successful connect.
    post_connect_redirect: str = "http://localhost:7880/settings"

    # LinkedIn API endpoints + the versioned header for /rest/* calls.
    authorize_url: str = "https://www.linkedin.com/oauth/v2/authorization"
    token_url: str = "https://www.linkedin.com/oauth/v2/accessToken"
    userinfo_url: str = "https://api.linkedin.com/v2/userinfo"
    api_base: str = "https://api.linkedin.com"
    api_version: str = "202401"  # LinkedIn-Version: YYYYMM

    scopes: str = "openid profile w_member_social"


@lru_cache(maxsize=1)
def get_linkedin_settings() -> LinkedInSettings:
    """Process-wide singleton. Cleared by reset_linkedin_settings_for_tests()."""
    return LinkedInSettings()


def reset_linkedin_settings_for_tests() -> None:
    get_linkedin_settings.cache_clear()
