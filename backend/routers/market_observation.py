from fastapi import APIRouter, Depends, Query
from sqlalchemy.orm import Session as DbSession

from ..database import get_db
from ..dependencies import get_current_user
from ..models import User
from ..research.market_observation import macro_tape, market_scores, score_history, social_top_ten
from ..schemas import MacroTapeOut, MarketScoreOut, SocialMentionOut


router = APIRouter(prefix="/api/market-observation", tags=["market-observation"])


@router.get("/social-top10", response_model=list[SocialMentionOut])
def get_social_top10(
    refresh: bool = False,
    user: User = Depends(get_current_user),
) -> list[dict]:
    del user
    return social_top_ten(force=refresh)


@router.get("/scores", response_model=list[MarketScoreOut])
def get_market_scores(
    refresh: bool = False,
    user: User = Depends(get_current_user),
    db: DbSession = Depends(get_db),
) -> list[dict]:
    del user
    return market_scores(db, force=refresh)


@router.get("/macro-tape", response_model=MacroTapeOut)
def get_macro_tape(
    refresh: bool = False,
    user: User = Depends(get_current_user),
    db: DbSession = Depends(get_db),
) -> dict:
    return macro_tape(db, user.id, force=refresh)


@router.get("/scores/{symbol}/history")
def get_score_history(
    symbol: str,
    days: int = Query(default=365, ge=7, le=1825),
    user: User = Depends(get_current_user),
    db: DbSession = Depends(get_db),
) -> list[dict]:
    del user
    return [{
        "date": item.as_of_date.isoformat(),
        "score": float(item.score),
        "valuation_score": float(item.valuation_score),
        "trend_score": float(item.trend_score),
        "macro_score": float(item.macro_score),
        "volatility_score": float(item.volatility_score),
    } for item in score_history(db, symbol, days)]
