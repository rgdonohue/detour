"""Load configuration from environment variables."""
from pathlib import Path

from pydantic_settings import BaseSettings, SettingsConfigDict


def _env_path() -> Path:
    """Path to .env at project root."""
    return Path(__file__).resolve().parent.parent.parent / ".env"


class Settings(BaseSettings):
    model_config = SettingsConfigDict(
        env_file=_env_path(),
        env_file_encoding="utf-8",
        extra="ignore",
    )

    ORS_API_KEY: str = ""
    HOTEL_NAME: str = "New Mexico State Capitol"
    HOTEL_ADDRESS: str = "411 South Capitol St, Santa Fe, NM 87501"
    HOTEL_LON: float = -105.9384
    HOTEL_LAT: float = 35.6824
    DEFAULT_RANGE_MILES: float = 3
    CACHE_TTL_HOURS: int = 24


settings = Settings()
