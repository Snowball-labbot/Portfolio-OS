from __future__ import annotations

import json
import urllib.error
import urllib.request

from fastapi import APIRouter, Depends, HTTPException, status
from pydantic import BaseModel, Field

from ..ai_settings import RuntimeAIConfig, delete_ai_config, load_ai_config, mask_api_key, save_ai_config
from ..dependencies import get_current_user
from ..models import User


router = APIRouter(prefix="/api/settings", tags=["settings"])


class AISettingsInput(BaseModel):
    provider: str = Field(default="agnes", max_length=32)
    base_url: str = Field(max_length=500)
    api_key: str | None = Field(default=None, max_length=1000)
    model: str = Field(max_length=128)
    vision_model: str | None = Field(default=None, max_length=128)


def _view(config: RuntimeAIConfig) -> dict:
    return {
        "provider": config.provider,
        "base_url": config.base_url,
        "model": config.model,
        "vision_model": config.vision_model,
        "configured": config.configured,
        "masked_api_key": mask_api_key(config.api_key),
        "updated_at": config.updated_at,
    }


def _merge(payload: AISettingsInput) -> RuntimeAIConfig:
    current = load_ai_config()
    api_key = (payload.api_key or "").strip() or current.api_key
    return RuntimeAIConfig(
        provider=payload.provider,
        base_url=payload.base_url,
        api_key=api_key,
        model=payload.model,
        vision_model=payload.vision_model or payload.model,
    )


def _test(config: RuntimeAIConfig) -> None:
    body = json.dumps({
        "model": config.model,
        "messages": [{"role": "user", "content": "只回复 OK"}],
        "temperature": 0,
        "max_tokens": 8,
    }).encode("utf-8")
    request = urllib.request.Request(
        f"{config.base_url.rstrip('/')}/chat/completions",
        data=body,
        headers={"Authorization": f"Bearer {config.api_key}", "Content-Type": "application/json"},
        method="POST",
    )
    try:
        with urllib.request.urlopen(request, timeout=20) as response:
            payload = json.loads(response.read().decode("utf-8"))
        if not payload.get("choices"):
            raise ValueError("API 返回格式不兼容")
    except urllib.error.HTTPError as exc:
        detail = exc.read().decode("utf-8", errors="ignore")[:500]
        raise HTTPException(status_code=status.HTTP_502_BAD_GATEWAY, detail=detail or f"API 返回 {exc.code}") from exc
    except (urllib.error.URLError, TimeoutError, ValueError, json.JSONDecodeError) as exc:
        raise HTTPException(status_code=status.HTTP_502_BAD_GATEWAY, detail=f"连接测试失败：{exc}") from exc


@router.get("/ai")
def ai_settings(_user: User = Depends(get_current_user)) -> dict:
    return _view(load_ai_config())


@router.post("/ai/test")
def test_ai_settings(payload: AISettingsInput, _user: User = Depends(get_current_user)) -> dict:
    config = _merge(payload)
    if not config.api_key:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="请先输入 API Key")
    _test(config)
    return {"ok": True, "message": "AI API 连接成功"}


@router.put("/ai")
def update_ai_settings(payload: AISettingsInput, _user: User = Depends(get_current_user)) -> dict:
    try:
        saved = save_ai_config(_merge(payload))
    except (ValueError, RuntimeError) as exc:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(exc)) from exc
    return _view(saved)


@router.delete("/ai")
def clear_ai_settings(_user: User = Depends(get_current_user)) -> dict:
    delete_ai_config()
    return {"ok": True}
