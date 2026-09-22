from __future__ import annotations

import base64
import ctypes
from ctypes import wintypes
from dataclasses import asdict, dataclass
from datetime import datetime, timezone
import json
import os
from pathlib import Path
import tempfile
from threading import RLock
from typing import Any

from .config import default_data_dir, get_settings


SCHEMA_VERSION = 1
_lock = RLock()


@dataclass(frozen=True)
class RuntimeAIConfig:
    provider: str
    base_url: str
    api_key: str
    model: str
    vision_model: str
    updated_at: str | None = None

    @property
    def configured(self) -> bool:
        return bool(self.api_key and self.base_url and self.model)


def _settings_path() -> Path:
    path = default_data_dir() / "config" / "ai-credentials.json"
    path.parent.mkdir(parents=True, exist_ok=True)
    return path


class _DataBlob(ctypes.Structure):
    _fields_ = [("cbData", wintypes.DWORD), ("pbData", ctypes.POINTER(ctypes.c_ubyte))]


def _blob(data: bytes) -> tuple[_DataBlob, Any]:
    buffer = ctypes.create_string_buffer(data)
    return _DataBlob(len(data), ctypes.cast(buffer, ctypes.POINTER(ctypes.c_ubyte))), buffer


def _protect(data: bytes) -> bytes:
    if os.name != "nt":
        if os.getenv("PORTFOLIO_OS_ALLOW_INSECURE_KEYSTORE", "").lower() not in {"1", "true", "yes"}:
            raise RuntimeError("The marketplace credential store requires Windows DPAPI")
        return data
    source, source_buffer = _blob(data)
    output = _DataBlob()
    crypt32 = ctypes.windll.crypt32
    if not crypt32.CryptProtectData(ctypes.byref(source), "Portfolio OS", None, None, None, 0, ctypes.byref(output)):
        raise ctypes.WinError()
    try:
        del source_buffer
        return ctypes.string_at(output.pbData, output.cbData)
    finally:
        ctypes.windll.kernel32.LocalFree(output.pbData)


def _unprotect(data: bytes) -> bytes:
    if os.name != "nt":
        if os.getenv("PORTFOLIO_OS_ALLOW_INSECURE_KEYSTORE", "").lower() not in {"1", "true", "yes"}:
            raise RuntimeError("The marketplace credential store requires Windows DPAPI")
        return data
    source, source_buffer = _blob(data)
    output = _DataBlob()
    crypt32 = ctypes.windll.crypt32
    if not crypt32.CryptUnprotectData(ctypes.byref(source), None, None, None, None, 0, ctypes.byref(output)):
        raise ctypes.WinError()
    try:
        del source_buffer
        return ctypes.string_at(output.pbData, output.cbData)
    finally:
        ctypes.windll.kernel32.LocalFree(output.pbData)


def _environment_config() -> RuntimeAIConfig:
    settings = get_settings()
    return RuntimeAIConfig(
        provider="agnes" if "agnes" in settings.ai_base_url.lower() else "openai-compatible",
        base_url=settings.ai_base_url,
        api_key=settings.ai_api_key or "",
        model=settings.ai_model,
        vision_model=settings.ai_vision_model,
    )


def load_ai_config() -> RuntimeAIConfig:
    with _lock:
        path = _settings_path()
        if not path.exists():
            return _environment_config()
        envelope = json.loads(path.read_text(encoding="utf-8"))
        encrypted = base64.b64decode(envelope["payload"])
        payload = json.loads(_unprotect(encrypted).decode("utf-8"))
        return RuntimeAIConfig(
            provider=str(payload.get("provider") or "openai-compatible"),
            base_url=str(payload.get("base_url") or "").rstrip("/"),
            api_key=str(payload.get("api_key") or ""),
            model=str(payload.get("model") or ""),
            vision_model=str(payload.get("vision_model") or payload.get("model") or ""),
            updated_at=payload.get("updated_at"),
        )


def save_ai_config(config: RuntimeAIConfig) -> RuntimeAIConfig:
    normalized = RuntimeAIConfig(
        provider=config.provider.strip().lower() or "openai-compatible",
        base_url=config.base_url.strip().rstrip("/"),
        api_key=config.api_key.strip(),
        model=config.model.strip(),
        vision_model=(config.vision_model or config.model).strip(),
        updated_at=datetime.now(timezone.utc).isoformat(),
    )
    if not normalized.base_url.startswith(("https://", "http://127.0.0.1", "http://localhost")):
        raise ValueError("API Base URL 必须使用 HTTPS；仅本机服务可使用 HTTP")
    if not normalized.api_key:
        raise ValueError("API Key 不能为空")
    if not normalized.model:
        raise ValueError("模型名称不能为空")

    encrypted = _protect(json.dumps(asdict(normalized), ensure_ascii=False).encode("utf-8"))
    envelope = {"schema_version": SCHEMA_VERSION, "payload": base64.b64encode(encrypted).decode("ascii")}
    path = _settings_path()
    with _lock:
        with tempfile.NamedTemporaryFile("w", encoding="utf-8", delete=False, dir=path.parent, suffix=".tmp") as handle:
            json.dump(envelope, handle, ensure_ascii=False)
            temporary = Path(handle.name)
        temporary.replace(path)
    return normalized


def delete_ai_config() -> None:
    with _lock:
        _settings_path().unlink(missing_ok=True)


def mask_api_key(value: str) -> str | None:
    if not value:
        return None
    if len(value) <= 8:
        return "*" * len(value)
    return f"{value[:3]}{'*' * min(12, len(value) - 7)}{value[-4:]}"
