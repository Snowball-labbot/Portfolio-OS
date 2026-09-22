import json
import re
import urllib.error
import urllib.request
from typing import Any

from .ai_settings import load_ai_config


class AIConfigError(RuntimeError):
    pass


class AIRequestError(RuntimeError):
    pass


def _chat_completions_url(base_url: str) -> str:
    return f"{base_url.rstrip('/')}/chat/completions"


def call_ai_chat(messages: list[dict[str, Any]], model: str, temperature: float = 0.2, *, timeout: int = 90) -> str:
    settings = load_ai_config()
    if not settings.api_key:
        raise AIConfigError("AI_API_KEY is not configured")

    payload = {
        "model": model,
        "messages": messages,
        "temperature": temperature,
    }
    data = json.dumps(payload).encode("utf-8")
    request = urllib.request.Request(
        _chat_completions_url(settings.base_url),
        data=data,
        headers={
            "Authorization": f"Bearer {settings.api_key}",
            "Content-Type": "application/json",
        },
        method="POST",
    )
    try:
        with urllib.request.urlopen(request, timeout=timeout) as response:
            body = response.read().decode("utf-8")
    except urllib.error.HTTPError as exc:
        detail = exc.read().decode("utf-8", errors="ignore")
        raise AIRequestError(detail or str(exc)) from exc
    except urllib.error.URLError as exc:
        raise AIRequestError(str(exc)) from exc
    except TimeoutError as exc:
        raise AIRequestError("Agnes 响应超时，已有报告保留，可稍后重试") from exc

    try:
        parsed = json.loads(body)
        if parsed["choices"][0].get("finish_reason") == "length":
            raise AIRequestError("AI report was truncated; retry with a shorter input")
        return parsed["choices"][0]["message"]["content"]
    except (KeyError, IndexError, TypeError, json.JSONDecodeError) as exc:
        raise AIRequestError("AI response format is not compatible") from exc


def parse_json_content(content: str) -> Any:
    text = content.strip()
    fence_match = re.search(r"```(?:json)?\s*(.*?)```", text, flags=re.DOTALL | re.IGNORECASE)
    if fence_match:
      text = fence_match.group(1).strip()
    try:
        return json.loads(text)
    except json.JSONDecodeError:
        start_candidates = [idx for idx in [text.find("["), text.find("{")] if idx >= 0]
        if not start_candidates:
            raise
        start = min(start_candidates)
        end = max(text.rfind("]"), text.rfind("}"))
        if end <= start:
            raise
        return json.loads(text[start : end + 1])
