from datetime import datetime, timezone

from fastapi import APIRouter, Depends, HTTPException, Response, status
from sqlalchemy import select
from sqlalchemy.orm import Session as DbSession

from ..config import get_settings
from ..database import get_db
from ..dependencies import get_current_user, session_cookie_kwargs
from ..models import InviteCode, Session as UserSession, User
from ..schemas import LoginIn, RegisterIn, UserOut
from ..security import create_session_token, hash_password, hash_session_token, session_expiry, verify_password

router = APIRouter(prefix="/api/auth", tags=["auth"])


@router.get("/config")
def auth_config() -> dict[str, bool]:
    return {"allow_open_registration": get_settings().allow_open_registration}


def set_login_cookie(response: Response, db: DbSession, user: User) -> None:
    token = create_session_token()
    db.add(UserSession(user_id=user.id, token_hash=hash_session_token(token), expires_at=session_expiry()))
    response.set_cookie(value=token, **session_cookie_kwargs())


@router.post("/register", response_model=UserOut)
def register(payload: RegisterIn, response: Response, db: DbSession = Depends(get_db)) -> User:
    existing = db.scalar(select(User).where(User.email == payload.email.lower()))
    if existing:
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="Email already registered")

    invite = None
    if not get_settings().allow_open_registration:
        if not payload.invite_code:
            raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Invite code required")
        invite = db.scalar(select(InviteCode).where(InviteCode.code == payload.invite_code.strip()))
        now = datetime.now(timezone.utc)
        if not invite or not invite.is_active or invite.used_count >= invite.max_uses or (invite.expires_at and invite.expires_at < now):
            raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Invalid invite code")

    user = User(email=payload.email.lower(), password_hash=hash_password(payload.password), role="user")
    if invite:
        invite.used_count += 1
    db.add(user)
    db.flush()
    set_login_cookie(response, db, user)
    db.commit()
    db.refresh(user)
    return user


@router.post("/login", response_model=UserOut)
def login(payload: LoginIn, response: Response, db: DbSession = Depends(get_db)) -> User:
    user = db.scalar(select(User).where(User.email == payload.email.lower()))
    if not user or not verify_password(payload.password, user.password_hash):
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Invalid email or password")
    set_login_cookie(response, db, user)
    db.commit()
    return user


@router.post("/logout")
def logout(response: Response, user: User = Depends(get_current_user), db: DbSession = Depends(get_db)) -> dict:
    db.query(UserSession).filter(UserSession.user_id == user.id).delete()
    db.commit()
    response.delete_cookie(key=session_cookie_kwargs()["key"], path="/")
    return {"ok": True}


@router.get("/me", response_model=UserOut)
def me(user: User = Depends(get_current_user)) -> User:
    return user
