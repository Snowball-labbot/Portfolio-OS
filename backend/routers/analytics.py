from decimal import Decimal

from fastapi import APIRouter, Depends
from sqlalchemy import select
from sqlalchemy.orm import Session as DbSession

from ..database import get_db
from ..dependencies import get_current_user
from ..models import Holding, User
from ..schemas import SummaryOut, SummarySlice
from ..services import total_cost_cny, trend_points

router = APIRouter(prefix="/api/analytics", tags=["analytics"])


@router.get("/summary", response_model=SummaryOut)
def summary(user: User = Depends(get_current_user), db: DbSession = Depends(get_db)) -> SummaryOut:
    holdings = db.scalars(select(Holding).where(Holding.user_id == user.id, Holding.archived_at.is_(None))).all()
    total_value = sum((h.current_value_cny for h in holdings), Decimal("0"))
    current_cost = sum((total_cost_cny(h) for h in holdings), Decimal("0"))
    realized_gain = sum((h.realized_gain_cny for h in holdings), Decimal("0"))
    unrealized_gain = total_value - current_cost
    total_gain = unrealized_gain + realized_gain
    by_type: dict[str, dict] = {}
    for holding in holdings:
        bucket = by_type.setdefault(holding.type, {"type": holding.type, "value_cny": Decimal("0"), "count": 0})
        bucket["value_cny"] += holding.current_value_cny
        bucket["count"] += 1
    return SummaryOut(
        total_value_cny=total_value,
        total_cost_cny=total_value - total_gain,
        unrealized_gain_cny=unrealized_gain,
        realized_gain_cny=realized_gain,
        total_gain_cny=total_gain,
        slices=[SummarySlice(**value) for value in by_type.values()],
    )


@router.get("/trend")
def trend(range: str = "week", user: User = Depends(get_current_user), db: DbSession = Depends(get_db)) -> list[dict]:
    return trend_points(db, user.id, range)
