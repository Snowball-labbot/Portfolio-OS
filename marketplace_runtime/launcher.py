from __future__ import annotations

import argparse
import json
import logging
from logging.handlers import RotatingFileHandler
import os
from pathlib import Path
import secrets
import sys


def _data_dir(configured: str | None = None) -> Path:
    configured = configured or os.getenv("PORTFOLIO_OS_DATA_DIR")
    base = Path(configured) if configured else Path(os.getenv("LOCALAPPDATA") or Path.home()) / "PortfolioOS"
    base = base.expanduser().resolve()
    for child in ("config", "data", "logs", "backups", "uploads"):
        (base / child).mkdir(parents=True, exist_ok=True)
    return base


def _runtime_config(data_dir: Path) -> dict:
    path = data_dir / "config" / "runtime.json"
    if path.exists():
        return json.loads(path.read_text(encoding="utf-8"))
    config = {"schema_version": 1, "session_secret": secrets.token_urlsafe(48)}
    path.write_text(json.dumps(config, indent=2), encoding="utf-8")
    return config


def _configure_environment(port: int, data_dir: Path, config: dict) -> None:
    os.environ["PORTFOLIO_OS_DATA_DIR"] = str(data_dir)
    os.environ["DATABASE_URL"] = f"sqlite:///{(data_dir / 'data' / 'portfolio.db').as_posix()}"
    os.environ["SESSION_SECRET"] = config["session_secret"]
    os.environ["APP_ORIGIN"] = f"http://127.0.0.1:{port}"
    os.environ["SESSION_COOKIE_SECURE"] = "false"
    os.environ["SESSION_COOKIE_SAMESITE"] = "lax"
    os.environ.setdefault("ALLOW_OPEN_REGISTRATION", "true")
    bundle_root = Path(getattr(sys, "_MEIPASS", Path(__file__).resolve().parents[1]))
    os.environ.setdefault("PORTFOLIO_OS_STATIC_DIR", str(bundle_root / "frontend-dist"))


def _configure_logging(data_dir: Path) -> None:
    handler = RotatingFileHandler(data_dir / "logs" / "runtime.log", maxBytes=2_000_000, backupCount=3, encoding="utf-8")
    handler.setFormatter(logging.Formatter("%(asctime)s %(levelname)s %(name)s %(message)s"))
    root = logging.getLogger()
    root.setLevel(logging.INFO)
    root.addHandler(handler)


def main() -> None:
    parser = argparse.ArgumentParser(description="Portfolio OS local marketplace runtime")
    parser.add_argument("--port", type=int, default=41731)
    parser.add_argument("--data-dir", help="Directory for the local database, encrypted settings, and logs")
    args = parser.parse_args()
    data_dir = _data_dir(args.data_dir)
    config = _runtime_config(data_dir)
    _configure_environment(args.port, data_dir, config)
    _configure_logging(data_dir)

    import uvicorn

    uvicorn.run("marketplace_runtime.app:app", host="127.0.0.1", port=args.port, log_level="info", access_log=False)


if __name__ == "__main__":
    main()
