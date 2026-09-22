from secrets import token_urlsafe

from fastapi import APIRouter, Depends
from sqlalchemy.orm import Session as DbSession

from ..database import get_db
from ..dependencies import require_admin
from ..models import InviteCode, User
from ..schemas import InviteCreateIn, InviteOut

router = APIRouter(prefix="/api/admin", tags=["admin"])


@router.post("/invites", response_model=InviteOut)
def create_invite(payload: InviteCreateIn, user: User = Depends(require_admin), db: DbSession = Depends(get_db)) -> InviteCode:
    code = token_urlsafe(12)
    invite = InviteCode(code=code, created_by=user.id, max_uses=payload.max_uses, expires_at=payload.expires_at)
    db.add(invite)
    db.commit()
    db.refresh(invite)
    return invite
