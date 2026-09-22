from __future__ import annotations

import os
from pathlib import Path
import sys
from threading import Event, Thread

from fastapi import HTTPException as FastAPIHTTPException
from fastapi.responses import FileResponse
from starlette.exceptions import HTTPException
from starlette.staticfiles import StaticFiles

from backend.main import app
from .scheduler import run_scheduler


stop_scheduler = Event()
scheduler_thread: Thread | None = None


@app.on_event("startup")
def start_marketplace_scheduler() -> None:
    global scheduler_thread
    if scheduler_thread and scheduler_thread.is_alive():
        return
    stop_scheduler.clear()
    scheduler_thread = Thread(target=run_scheduler, args=(stop_scheduler,), daemon=True, name="portfolio-os-scheduler")
    scheduler_thread.start()


@app.on_event("shutdown")
def stop_marketplace_scheduler() -> None:
    stop_scheduler.set()
    if scheduler_thread:
        scheduler_thread.join(timeout=5)


def _static_dir() -> Path:
    configured = os.getenv("PORTFOLIO_OS_STATIC_DIR")
    if configured:
        return Path(configured).resolve()
    bundle_root = Path(getattr(sys, "_MEIPASS", Path(__file__).resolve().parents[1]))
    return bundle_root / "frontend-dist"


class SpaStaticFiles(StaticFiles):
    async def get_response(self, path: str, scope):
        try:
            return await super().get_response(path, scope)
        except HTTPException as exc:
            if exc.status_code != 404:
                raise
            return FileResponse(Path(self.directory) / "index.html")


static_dir = _static_dir()
if static_dir.exists():
    @app.api_route(
        "/api/{unmatched_path:path}",
        methods=["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
        include_in_schema=False,
    )
    async def unknown_api_route(unmatched_path: str) -> None:
        raise FastAPIHTTPException(status_code=404, detail="API endpoint not found")

    app.mount("/", SpaStaticFiles(directory=static_dir, html=True), name="marketplace-frontend")
