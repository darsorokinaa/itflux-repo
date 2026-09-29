"""Провайдеры текста и изображений для ИИ-помощника.

Ключи только из settings/env. Пользователь не выбирает модель и не видит токены.
"""

from __future__ import annotations

import base64
import logging
from dataclasses import dataclass, field
from io import BytesIO
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


PROVIDER_DEFAULT = "default"
PROVIDER_WORKSHEET = "worksheet"
WORKSHEET_AGENT_MISSING = (
    "Генератор рабочих листов не подключён: задайте TIMEWEB_AI_WORKSHEET_AGENT_ID "
    "и TIMEWEB_AI_WORKSHEET_AGENT_TOKEN."
)


def _proxy_source() -> str:
    return (getattr(settings, "TIMEWEB_AI_PROXY_SOURCE", "") or "itflux").strip() or "itflux"


def _agent_headers(token: str) -> dict[str, str]:
    return {
        "Authorization": f"Bearer {token}",
        "Content-Type": "application/json",
        "x-proxy-source": _proxy_source(),
    }


def _agent_root(agent_id: str = "") -> str:
    chosen = (agent_id or getattr(settings, "TIMEWEB_AI_AGENT_ID", "") or "").strip()
    base = (getattr(settings, "TIMEWEB_AI_AGENT_BASE", "") or "").rstrip("/")
    if not chosen or not base:
        return ""
    return f"{base}/{chosen}"


def _agent_url(agent_id: str = "") -> str:
    root = _agent_root(agent_id)
    if not root:
        return ""
    return f"{root}/v1/chat/completions"


def _agent_token() -> str:
    return (getattr(settings, "TIMEWEB_AI_AGENT_TOKEN", "") or "").strip()


def _worksheet_agent_id() -> str:
    return (getattr(settings, "TIMEWEB_AI_WORKSHEET_AGENT_ID", "") or "").strip()


def _worksheet_agent_token() -> str:
    return (getattr(settings, "TIMEWEB_AI_WORKSHEET_AGENT_TOKEN", "") or "").strip()


def _gateway_key() -> str:
    return (getattr(settings, "TIMEWEB_AI_GATEWAY_KEY", "") or "").strip()


def _gateway_base() -> str:
    return (getattr(settings, "TIMEWEB_AI_GATEWAY_BASE", "") or "https://api.timeweb.ai/v1").rstrip("/")


def text_provider_configured() -> bool:
    if _complete_chat_impl is not None:
        return True
    return bool(_agent_token() and _agent_url()) or bool(_gateway_key())


def worksheet_text_provider_configured() -> bool:
    """Агент листов задан отдельно. Агент помощника и шлюз сюда не подходят."""
    if _complete_chat_impl is not None:
        return True
    agent_id = _worksheet_agent_id()
    return bool(agent_id and _worksheet_agent_token() and _agent_url(agent_id))


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
    provider_context: str = PROVIDER_DEFAULT,
) -> TextResult:
    context = (provider_context or PROVIDER_DEFAULT).strip()
    if _complete_chat_impl is not None:
        return _complete_chat_impl(
            messages,
            max_tokens=max_tokens,
            timeout=timeout,
            model=model,
            provider_context=context,
        )
    if context == PROVIDER_WORKSHEET:
        agent_id = _worksheet_agent_id()
        token = _worksheet_agent_token()
        url = _agent_url(agent_id) if agent_id else ""
        if not token or not url:
            raise ProviderError(WORKSHEET_AGENT_MISSING, billed=False, retryable=False)
        return _timeweb_agent_chat(
            messages,
            url=url,
            token=token,
            max_tokens=max_tokens,
            timeout=timeout,
            model=model,
            provider="timeweb_worksheet_agent",
        )
    if context != PROVIDER_DEFAULT:
        raise ProviderError("Неизвестный контекст AI-провайдера.", billed=False, retryable=False)
    if _agent_token() and _agent_url():
        return _timeweb_agent_chat(
            messages,
            url=_agent_url(),
            token=_agent_token(),
            max_tokens=max_tokens,
            timeout=timeout,
            model=model,
        )
    if _gateway_key():
        return _timeweb_gateway_chat(messages, max_tokens=max_tokens, timeout=timeout, model=model)
    raise ProviderError(USER_UNAVAILABLE, billed=False, retryable=True)


def generate_worksheet_background(prompt: str, *, timeout: int = 180) -> str:
    """Картинка фона листа через Responses API агента.

    Документация агента: POST /v1/responses с инструментом image_generation.
    Байты лежат в output[].result, а не в ссылке на хранилище.
    В тестах, где подменён чат, сетевой вызов не делается.
    """
    return _agent_image(prompt, size="1024x1536", thumb=(1200, 1800), timeout=timeout)


def generate_content_image(prompt: str, *, timeout: int = 180) -> str:
    """Иллюстрация внутри задания: квадратный кадр, объект по центру."""
    return _agent_image(prompt, size="1024x1024", thumb=(960, 960), timeout=timeout)


def _agent_image(prompt: str, *, size: str, thumb: tuple[int, int], timeout: int) -> str:
    if _complete_chat_impl is not None or _generate_image_impl is not None:
        return ""
    agent_id = _worksheet_agent_id()
    token = _worksheet_agent_token()
    root = _agent_root(agent_id)
    if not agent_id or not token or not root:
        return ""
    try:
        data = _post_json(
            f"{root}/v1/responses",
            {
                "input": (prompt or "")[:4000],
                "tools": [{
                    "type": "image_generation",
                    "size": size,
                    "quality": "medium",
                    "output_format": "jpeg",
                    "output_compression": 70,
                    "background": "opaque",
                }],
                "tool_choice": "required",
            },
            _agent_headers(token),
            timeout,
        )
    except ProviderError:
        logger.warning("worksheet image request failed")
        return ""
    return _background_from_agent_payload(data, thumb=thumb)


def _background_from_agent_payload(data: dict, thumb: tuple[int, int] = (1200, 1800)) -> str:
    encoded = ""
    for item in data.get("output") or []:
        if not isinstance(item, dict) or item.get("type") != "image_generation_call":
            continue
        result = item.get("result") or ""
        if isinstance(result, str) and len(result) > 1000:
            encoded = result
            break
    if not encoded:
        return ""
    try:
        raw = base64.b64decode(encoded, validate=False)
    except (ValueError, TypeError):
        logger.warning("worksheet background image is not base64")
        return ""
    if len(raw) < 1000:
        return ""
    return _jpeg_data_url(raw, thumb=thumb)


def _jpeg_data_url(raw: bytes, thumb: tuple[int, int] = (1200, 1800)) -> str:
    try:
        from PIL import Image
    except ImportError:
        logger.warning("Pillow is not installed, worksheet background skipped")
        return ""
    try:
        image = Image.open(BytesIO(raw))
        image = image.convert("RGB")
        image.thumbnail(thumb, Image.Resampling.LANCZOS)
        out = BytesIO()
        image.save(out, format="JPEG", quality=74, optimize=True)
    except Exception:
        logger.warning("worksheet background image could not be encoded")
        return ""
    payload = base64.b64encode(out.getvalue()).decode("ascii")
    return "data:image/jpeg;base64," + payload


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


def _timeweb_agent_chat(
    messages,
    *,
    url: str,
    token: str,
    max_tokens: int,
    timeout: int,
    model: str,
    provider: str = "timeweb_agent",
) -> TextResult:
    payload: dict[str, Any] = {
        "messages": messages,
        "max_tokens": max(64, int(max_tokens or 2500)),
        "stream": False,
    }
    if model:
        payload["model"] = model
    data = _post_json(url, payload, _agent_headers(token), timeout)
    result = _parse_chat_payload(data, provider, model)
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
