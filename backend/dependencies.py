from datetime import datetime, timezone

from fastapi import Cookie, Depends, HTTPException, status
from sqlalchemy import select
from sqlalchemy.orm import Session as DbSession

from .config import get_settings
from .database import get_db
from .models import Session as UserSession, User
from .security import hash_session_token


def as_aware_utc(value: datetime) -> datetime:
    if value.tzinfo is None:
        return value.replace(tzinfo=timezone.utc)
    return value


def get_current_user(
    asset_session: str | None = Cookie(default=None),
    db: DbSession = Depends(get_db),
) -> User:
    if not asset_session:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Not authenticated")

    token_hash = hash_session_token(asset_session)
    user_session = db.scalar(select(UserSession).where(UserSession.token_hash == token_hash))
    if not user_session or as_aware_utc(user_session.expires_at) < datetime.now(timezone.utc):
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Session expired")

    user = db.get(User, user_session.user_id)
    if not user:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="User not found")
    return user


def require_admin(user: User = Depends(get_current_user)) -> User:
    if user.role != "admin":
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Admin only")
    return user


def session_cookie_kwargs() -> dict:
    settings = get_settings()
    return {
        "key": settings.session_cookie_name,
        "httponly": True,
        "secure": settings.session_cookie_secure,
        "samesite": settings.session_cookie_samesite,
        "path": "/",
        "max_age": settings.session_days * 24 * 60 * 60,
    }
