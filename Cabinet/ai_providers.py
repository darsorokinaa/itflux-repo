"""Провайдеры текста и изображений для ИИ-помощника.

Ключи только из settings/env. Пользователь не выбирает модель и не видит токены.
"""

from __future__ import annotations

import base64
import logging
from dataclasses import dataclass, field
from typing import Any, Callable

import requests
from django.conf import settings

logger = logging.getLogger(__name__)

USER_UNAVAILABLE = "AI временно недоступен. Попробуйте немного позже."


class ProviderError(Exception):
    def __init__(self, message: str = USER_UNAVAILABLE, *, billed: bool = False, retryable: bool = True):
        super().__init__(message)
        self.message = message or USER_UNAVAILABLE
        self.billed = billed
        self.retryable = retryable


@dataclass
class TextResult:
    content: str
    model: str = ""
    input_tokens: int = 0
    output_tokens: int = 0
    total_tokens: int = 0
    provider: str = ""
    provider_request_id: str = ""
    raw: dict = field(default_factory=dict)


@dataclass
class ImageResult:
    image_bytes: bytes
    mime: str = "image/png"
    provider: str = ""
    provider_request_id: str = ""
    model: str = ""


_complete_chat_impl: Callable[..., TextResult] | None = None
_generate_image_impl: Callable[..., ImageResult] | None = None


def set_provider_overrides(
    *,
    complete_chat: Callable[..., TextResult] | None = None,
    generate_image: Callable[..., ImageResult] | None = None,
):
    """Подмена провайдеров в тестах. В проде не используется."""
    global _complete_chat_impl, _generate_image_impl
    _complete_chat_impl = complete_chat
    _generate_image_impl = generate_image


def reset_provider_overrides():
    set_provider_overrides(complete_chat=None, generate_image=None)


def _agent_url() -> str:
    agent_id = (getattr(settings, "TIMEWEB_AI_AGENT_ID", "") or "").strip()
    base = (getattr(settings, "TIMEWEB_AI_AGENT_BASE", "") or "").rstrip("/")
    if not agent_id or not base:
        return ""
    return f"{base}/{agent_id}/v1/chat/completions"


def _agent_token() -> str:
    return (getattr(settings, "TIMEWEB_AI_AGENT_TOKEN", "") or "").strip()


def _gateway_key() -> str:
    return (getattr(settings, "TIMEWEB_AI_GATEWAY_KEY", "") or "").strip()


def _gateway_base() -> str:
    return (getattr(settings, "TIMEWEB_AI_GATEWAY_BASE", "") or "https://api.timeweb.ai/v1").rstrip("/")


def text_provider_configured() -> bool:
    if _complete_chat_impl is not None:
        return True
    return bool(_agent_token() and _agent_url()) or bool(_gateway_key())


def image_provider_configured() -> bool:
    if _generate_image_impl is not None:
        return True
    return bool(_gateway_key() and (getattr(settings, "TIMEWEB_AI_IMAGE_MODEL", "") or "").strip())


def complete_chat(
    messages: list[dict[str, Any]],
    *,
    max_tokens: int = 2500,
    timeout: int = 90,
    model: str = "",
) -> TextResult:
    if _complete_chat_impl is not None:
        return _complete_chat_impl(messages, max_tokens=max_tokens, timeout=timeout, model=model)
    if _agent_token() and _agent_url():
        return _timeweb_agent_chat(messages, max_tokens=max_tokens, timeout=timeout, model=model)
    if _gateway_key():
        return _timeweb_gateway_chat(messages, max_tokens=max_tokens, timeout=timeout, model=model)
    raise ProviderError(USER_UNAVAILABLE, billed=False, retryable=True)


def generate_image(prompt: str, *, size: str = "1024x1024", timeout: int = 120) -> ImageResult:
    if _generate_image_impl is not None:
        return _generate_image_impl(prompt, size=size, timeout=timeout)
    if not image_provider_configured():
        raise ProviderError(
            "Генерация изображений временно недоступна. Текстовый ИИ продолжает работать.",
            billed=False,
            retryable=True,
        )
    return _timeweb_gateway_image(prompt, size=size, timeout=timeout)


def _post_json(url: str, payload: dict, headers: dict, timeout: int) -> dict:
    try:
        response = requests.post(url, json=payload, headers=headers, timeout=timeout)
    except requests.Timeout as exc:
        raise ProviderError(USER_UNAVAILABLE, billed=False, retryable=True) from exc
    except requests.RequestException as exc:
        logger.warning("AI provider network error: %s", exc)
        raise ProviderError(USER_UNAVAILABLE, billed=False, retryable=True) from exc
    if response.status_code >= 500:
        raise ProviderError(USER_UNAVAILABLE, billed=False, retryable=True)
    if response.status_code >= 400:
        logger.warning("AI provider HTTP %s: %s", response.status_code, response.text[:400])
        raise ProviderError(USER_UNAVAILABLE, billed=False, retryable=False)
    try:
        data = response.json()
    except ValueError as exc:
        raise ProviderError(USER_UNAVAILABLE, billed=False, retryable=True) from exc
    if not isinstance(data, dict):
        raise ProviderError(USER_UNAVAILABLE, billed=False, retryable=True)
    return data


def _parse_chat_payload(data: dict, provider: str, fallback_model: str) -> TextResult:
    choices = data.get("choices") or []
    content = ""
    if choices:
        message = (choices[0] or {}).get("message") or {}
        content = (message.get("content") or choices[0].get("text") or "") or ""
    usage = data.get("usage") or {}
    input_tokens = int(usage.get("prompt_tokens") or 0)
    output_tokens = int(usage.get("completion_tokens") or 0)
    total_tokens = int(usage.get("total_tokens") or (input_tokens + output_tokens))
    return TextResult(
        content=str(content).strip(),
        model=str(data.get("model") or fallback_model or ""),
        input_tokens=input_tokens,
        output_tokens=output_tokens,
        total_tokens=total_tokens,
        provider=provider,
        provider_request_id=str(data.get("id") or data.get("response_id") or ""),
        raw=data,
    )


def _timeweb_agent_chat(messages, *, max_tokens: int, timeout: int, model: str) -> TextResult:
    url = _agent_url()
    payload: dict[str, Any] = {
        "messages": messages,
        "max_tokens": max(64, int(max_tokens or 2500)),
        "stream": False,
    }
    if model:
        payload["model"] = model
    data = _post_json(
        url,
        payload,
        {
            "Authorization": f"Bearer {_agent_token()}",
            "Content-Type": "application/json",
        },
        timeout,
    )
    result = _parse_chat_payload(data, "timeweb_agent", model)
    if not result.content:
        raise ProviderError(USER_UNAVAILABLE, billed=True, retryable=False)
    return result


def _timeweb_gateway_chat(messages, *, max_tokens: int, timeout: int, model: str) -> TextResult:
    chosen = (model or getattr(settings, "TIMEWEB_AI_TEXT_MODEL", "") or "").strip()
    if not chosen:
        raise ProviderError(USER_UNAVAILABLE, billed=False, retryable=True)
    url = f"{_gateway_base()}/chat/completions"
    data = _post_json(
        url,
        {
            "model": chosen,
            "messages": messages,
            "max_tokens": max(64, int(max_tokens or 2500)),
            "stream": False,
        },
        {
            "Authorization": f"Bearer {_gateway_key()}",
            "Content-Type": "application/json",
        },
        timeout,
    )
    result = _parse_chat_payload(data, "timeweb_gateway", chosen)
    if not result.content:
        raise ProviderError(USER_UNAVAILABLE, billed=True, retryable=False)
    return result


def _timeweb_gateway_image(prompt: str, *, size: str, timeout: int) -> ImageResult:
    model = (getattr(settings, "TIMEWEB_AI_IMAGE_MODEL", "") or "").strip()
    url = f"{_gateway_base()}/images/generations"
    data = _post_json(
        url,
        {
            "model": model,
            "prompt": prompt[:4000],
            "n": 1,
            "size": size or "1024x1024",
            "response_format": "b64_json",
        },
        {
            "Authorization": f"Bearer {_gateway_key()}",
            "Content-Type": "application/json",
        },
        timeout,
    )
    items = data.get("data") or []
    if not items:
        raise ProviderError(USER_UNAVAILABLE, billed=True, retryable=False)
    item = items[0] or {}
    b64 = item.get("b64_json") or ""
    image_url = item.get("url") or ""
    if b64:
        try:
            raw = base64.b64decode(b64)
        except (ValueError, TypeError) as exc:
            raise ProviderError(USER_UNAVAILABLE, billed=True, retryable=False) from exc
        return ImageResult(
            image_bytes=raw,
            mime="image/png",
            provider="timeweb_gateway",
            provider_request_id=str(data.get("id") or ""),
            model=model,
        )
    if image_url:
        try:
            downloaded = requests.get(image_url, timeout=timeout)
            downloaded.raise_for_status()
        except requests.RequestException as exc:
            raise ProviderError(USER_UNAVAILABLE, billed=True, retryable=False) from exc
        mime = downloaded.headers.get("Content-Type") or "image/png"
        return ImageResult(
            image_bytes=downloaded.content,
            mime=mime.split(";")[0].strip() or "image/png",
            provider="timeweb_gateway",
            provider_request_id=str(data.get("id") or ""),
            model=model,
        )
    raise ProviderError(USER_UNAVAILABLE, billed=True, retryable=False)
