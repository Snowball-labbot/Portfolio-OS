from functools import lru_cache
import os
from pathlib import Path
from typing import Literal

from pydantic_settings import BaseSettings, SettingsConfigDict


def default_data_dir() -> Path:
    configured = os.getenv("PORTFOLIO_OS_DATA_DIR")
    if configured:
        return Path(configured).expanduser().resolve()
    base = Path(os.getenv("LOCALAPPDATA") or Path.home() / ".local" / "share")
    return (base / "PortfolioOS").resolve()


def default_database_url() -> str:
    database_path = default_data_dir() / "data" / "portfolio.db"
    database_path.parent.mkdir(parents=True, exist_ok=True)
    return f"sqlite:///{database_path.as_posix()}"


class Settings(BaseSettings):
    database_url: str = default_database_url()
    session_secret: str = "dev-change-me"
    app_origin: str = "http://127.0.0.1:41731"
    session_cookie_name: str = "asset_session"
    session_cookie_samesite: Literal["lax", "strict", "none"] = "lax"
    session_cookie_secure: bool = False
    session_days: int = 14
    allow_open_registration: bool = True
    ai_api_key: str | None = None
    ai_base_url: str = "https://api.agnes-ai.cn/v1"
    ai_model: str = "agnes-2.5-flash"
    ai_vision_model: str = "agnes-2.5-flash"
    auto_brief_user_email: str | None = None
    auto_brief_enabled: bool = True
    # The review is generated at bedtime in the user's local (Shanghai) time.
    auto_brief_market_close_hour: int = 22
    auto_brief_market_close_minute: int = 0

    model_config = SettingsConfigDict(env_file=".env", env_file_encoding="utf-8", extra="ignore")


@lru_cache
def get_settings() -> Settings:
    return Settings()
