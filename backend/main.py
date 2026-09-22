import asyncio
import os

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from .config import get_settings
from .database import Base, SessionLocal, engine
from .market_refresh import market_refresh_loop
from .migrations import ensure_lightweight_migrations
from .services import backfill_cost_bases
from .routers import admin, ai, analytics, auth, holdings, market, market_observation, portfolio_backup, portfolio_insights, research, settings as settings_router, transfers


def create_app() -> FastAPI:
    Base.metadata.create_all(bind=engine)
    ensure_lightweight_migrations(engine)
    with SessionLocal() as db:
        backfill_cost_bases(db)
    settings = get_settings()
    app = FastAPI(title="Asset Manager API")
    app.add_middleware(
        CORSMiddleware,
        allow_origins=[settings.app_origin],
        allow_credentials=True,
        allow_methods=["*"],
        allow_headers=["*"],
    )
    app.include_router(auth.router)
    app.include_router(admin.router)
    app.include_router(ai.router)
    app.include_router(holdings.router)
    app.include_router(transfers.router)
    app.include_router(market.router)
    app.include_router(analytics.router)
    app.include_router(portfolio_backup.router)
    app.include_router(portfolio_insights.router)
    app.include_router(research.router)
    app.include_router(market_observation.router)
    app.include_router(settings_router.router)

    @app.get("/api/health")
    def health() -> dict:
        return {"ok": True}

    @app.on_event("startup")
    async def start_market_refresh() -> None:
        if os.getenv("MARKET_REFRESH_ENABLED", "true").lower() in {"0", "false", "no"}:
            return
        app.state.market_refresh_task = asyncio.create_task(market_refresh_loop())

    @app.on_event("shutdown")
    async def stop_market_refresh() -> None:
        task = getattr(app.state, "market_refresh_task", None)
        if task:
            task.cancel()

    return app


app = create_app()
