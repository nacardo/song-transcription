from pathlib import Path

from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    """Runtime configuration read from environment variables and .env files.

    All names are also usable as env vars (e.g. DATABASE_URL, APP_PASSWORD).
    Case-insensitive by default.
    """

    model_config = SettingsConfigDict(
        env_file=".env",
        env_file_encoding="utf-8",
        extra="ignore",
    )

    # Where SQLite lives. In production this maps to a mounted volume
    # (/data/app.db); locally it defaults to ./data/app.db under the backend dir.
    database_url: str = "sqlite:///./data/app.db"

    # Set in .env / container env. Login endpoint compares against this.
    # Left blank in dev = auth middleware refuses everything, forcing the user
    # to set it before anything works.
    app_password: str = ""

    # Session cookie secret for signing. Any long random string.
    session_secret: str = "dev-insecure-change-me"

    # Set true behind HTTPS (production). Left off in dev so cookies flow
    # over http://127.0.0.1:5173 during development.
    session_https_only: bool = False


settings = Settings()


def ensure_data_dir() -> None:
    """Create the SQLite file's parent directory if it doesn't exist."""
    url = settings.database_url
    if url.startswith("sqlite:///"):
        path = Path(url.removeprefix("sqlite:///"))
        path.parent.mkdir(parents=True, exist_ok=True)
