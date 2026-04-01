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
    ORIGIN_NAME: str = "New Mexico State Capitol"
    ORIGIN_ADDRESS: str = "411 South Capitol St, Santa Fe, NM 87501"
    ORIGIN_LON: float = -105.9384
    ORIGIN_LAT: float = 35.6824
    DEFAULT_RANGE_MILES: float = 3
    CACHE_TTL_HOURS: int = 24
    CORS_ORIGINS: str = "http://localhost:5173,http://127.0.0.1:5173"
    USE_ORS_POIS: bool = False

    @property
    def cors_origins_list(self) -> list[str]:
        """Parse CORS_ORIGINS into a list, stripping whitespace."""
        if not self.CORS_ORIGINS.strip():
            return []
        return [o.strip() for o in self.CORS_ORIGINS.split(",") if o.strip()]


settings = Settings()
