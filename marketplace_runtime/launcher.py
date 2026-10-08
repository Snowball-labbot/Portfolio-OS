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


def resolve_cookie_policy(configured_samesite: str | None, configured_secure: bool | None) -> tuple[str, bool]:
    samesite = (configured_samesite or os.getenv("SESSION_COOKIE_SAMESITE") or "lax").strip().lower()
    if samesite not in {"lax", "strict", "none"}:
        raise SystemExit(f"Unsupported SameSite value: {samesite}")
    if configured_secure is None:
        default = "true" if samesite == "none" else "false"
        secure = os.getenv("SESSION_COOKIE_SECURE", default).strip().lower() in {"1", "true", "yes"}
    else:
        secure = configured_secure
    if samesite == "none" and not secure:
        raise SystemExit("SameSite=None requires a Secure session cookie")
    return samesite, secure


def _configure_environment(port: int, data_dir: Path, config: dict, cookie_samesite: str, cookie_secure: bool) -> None:
    os.environ["PORTFOLIO_OS_DATA_DIR"] = str(data_dir)
    os.environ["DATABASE_URL"] = f"sqlite:///{(data_dir / 'data' / 'portfolio.db').as_posix()}"
    os.environ["SESSION_SECRET"] = config["session_secret"]
    os.environ["APP_ORIGIN"] = f"http://127.0.0.1:{port}"
    os.environ["SESSION_COOKIE_SECURE"] = "true" if cookie_secure else "false"
    os.environ["SESSION_COOKIE_SAMESITE"] = cookie_samesite
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
    parser.add_argument(
        "--cookie-samesite",
        choices=("lax", "strict", "none"),
        default=None,
        help="Session cookie SameSite policy (default: lax, or SESSION_COOKIE_SAMESITE)",
    )
    parser.add_argument(
        "--cookie-secure",
        action=argparse.BooleanOptionalAction,
        default=None,
        help="Mark the session cookie Secure (default: follows --cookie-samesite, or SESSION_COOKIE_SECURE)",
    )
    args = parser.parse_args()
    data_dir = _data_dir(args.data_dir)
    config = _runtime_config(data_dir)
    cookie_samesite, cookie_secure = resolve_cookie_policy(args.cookie_samesite, args.cookie_secure)
    _configure_environment(args.port, data_dir, config, cookie_samesite, cookie_secure)
    _configure_logging(data_dir)
    logging.getLogger("marketplace-runtime").info(
        "Listening on http://127.0.0.1:%s (session cookie SameSite=%s secure=%s)",
        args.port,
        cookie_samesite,
        cookie_secure,
    )

    import uvicorn

    uvicorn.run("marketplace_runtime.app:app", host="127.0.0.1", port=args.port, log_level="info", access_log=False)


if __name__ == "__main__":
    main()
