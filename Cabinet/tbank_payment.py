"""
Провайдер оплаты Т-Банка (интернет-эквайринг, платежная форма банка).

Документация: https://developer.tbank.ru/eacq/scenarios/payments/nonPCI/

Поток:
  1) Init → PaymentURL
  2) Редирект пользователя на форму банка
  3) NotificationURL webhook → активация тарифа на месяц/год
"""

from __future__ import annotations

import hashlib
import logging
import re
import uuid
from decimal import Decimal, ROUND_HALF_UP
from typing import Any
from urllib.parse import urlparse

import requests
from django.conf import settings

from .payment_service import PaymentProviderInterface

logger = logging.getLogger(__name__)

TBANK_API_DEFAULT = "https://securepay.tinkoff.ru/v2"

# Статусы эквайринга → внутренние
_PAID_STATUSES = frozenset({"CONFIRMED", "AUTHORIZED"})
_FAILED_STATUSES = frozenset({"REJECTED", "AUTH_FAIL"})
_CANCELLED_STATUSES = frozenset({"CANCELED", "CANCELLED", "DEADLINE_EXPIRED", "REVERSED"})
_REFUNDED_STATUSES = frozenset({"REFUNDED", "PARTIAL_REFUNDED", "PARTIAL_REFUNDED_AUTHORIZED"})


def _strip_env(value: str) -> str:
    value = (value or "").strip()
    if len(value) >= 2 and value[0] == value[-1] and value[0] in ("'", '"'):
        value = value[1:-1]
    return value.strip()


def _terminal_key() -> str:
    return _strip_env(
        getattr(settings, "TBANK_TERMINAL_KEY", "")
        or getattr(settings, "PAYMENT_SHOP_ID", "")
        or ""
    )


def _password() -> str:
    return _strip_env(
        getattr(settings, "TBANK_PASSWORD", "")
        or getattr(settings, "PAYMENT_SECRET_KEY", "")
        or ""
    )


def _api_base() -> str:
    return (getattr(settings, "TBANK_API_URL", "") or TBANK_API_DEFAULT).rstrip("/")


def _ssl_verify():
    """
    Проверка TLS к API Т-Банка.
    Локально антивирус/прокси иногда ломают цепочку сертификатов —
    тогда TBANK_VERIFY_SSL=false (только для DEBUG).
    """
    raw = getattr(settings, "TBANK_VERIFY_SSL", True)
    if isinstance(raw, str):
        return raw.strip().lower() not in ("0", "false", "no", "off")
    return bool(raw)


def build_tbank_token(payload: dict[str, Any], password: str | None = None) -> str:
    """
    Token = SHA-256(конкатенация значений корневых полей + Password, ключи по алфавиту).
    Вложенные объекты/массивы в подпись не входят.
    """
    pwd = password if password is not None else _password()
    pairs: dict[str, Any] = {}
    for key, value in (payload or {}).items():
        if key == "Token":
            continue
        if isinstance(value, (dict, list)):
            continue
        if value is None:
            continue
        pairs[str(key)] = value
    pairs["Password"] = pwd
    concat = "".join(str(pairs[k]) for k in sorted(pairs.keys()))
    return hashlib.sha256(concat.encode("utf-8")).hexdigest()


def verify_tbank_token(payload: dict[str, Any], password: str | None = None) -> bool:
    token = str((payload or {}).get("Token") or "")
    if not token:
        return False
    expected = build_tbank_token(payload, password=password)
    return token.lower() == expected.lower()


def amount_to_kopecks(amount) -> int:
    value = Decimal(str(amount or 0)).quantize(Decimal("0.01"), rounding=ROUND_HALF_UP)
    kopecks = int(value * 100)
    if kopecks <= 0:
        raise ValueError("Сумма оплаты должна быть больше нуля")
    return kopecks


def _public_base() -> str:
    return (getattr(settings, "LK_PUBLIC_URL", "") or "https://itflux-academy.ru").rstrip("/")


def _is_loopback_host(host: str) -> bool:
    host = (host or "").lower()
    return host in ("localhost", "127.0.0.1", "0.0.0.0", "::1")


def _is_public_https(url: str) -> bool:
    try:
        parsed = urlparse(url)
    except Exception:
        return False
    if parsed.scheme != "https":
        return False
    host = (parsed.hostname or "").lower()
    if not host or _is_loopback_host(host):
        return False
    return True


def _is_local_dev_url(url: str) -> bool:
    """http(s)://localhost|127.0.0.1 — для локальной проверки в DEBUG."""
    try:
        parsed = urlparse(url)
    except Exception:
        return False
    if parsed.scheme not in ("http", "https"):
        return False
    return _is_loopback_host(parsed.hostname or "")


def _is_tunnel_url(url: str) -> bool:
    """Публичный туннель (ngrok и т.п.) — единственный способ получить webhook локально."""
    try:
        host = (urlparse(url).hostname or "").lower()
    except Exception:
        return False
    markers = (
        "ngrok",
        "loca.lt",
        "localtunnel",
        "trycloudflare.com",
        "serveo.net",
        "localhost.run",
    )
    return any(m in host for m in markers)


def _return_url(payment, *, status: str, custom: str) -> str:
    """
    Success/Fail URL для Init.
    В DEBUG разрешаем localhost (полный локальный цикл + sync через GetState).
    На проде — только публичный HTTPS.
    """
    custom = (custom or "").strip()
    if custom:
        sep = "&" if "?" in custom else "?"
        candidate = f"{custom}{sep}payment_id={payment.pk}&status={status}"
        if _is_public_https(candidate) or _is_public_https(custom):
            return candidate
        if getattr(settings, "DEBUG", False) and (
            _is_local_dev_url(candidate) or _is_local_dev_url(custom)
        ):
            return candidate
        logger.warning(
            "T-Bank %s URL is not public HTTPS (%s) — fallback to LK_PUBLIC_URL",
            status,
            custom,
        )
    return f"{_public_base()}/cabinet/upgrade?payment_id={payment.pk}&status={status}"


def _success_url(payment) -> str:
    return _return_url(
        payment,
        status="success",
        custom=getattr(settings, "TBANK_SUCCESS_URL", "") or "",
    )


def _fail_url(payment) -> str:
    return _return_url(
        payment,
        status="fail",
        custom=getattr(settings, "TBANK_FAIL_URL", "") or "",
    )


def _notification_url() -> str | None:
    """
    URL webhook для банка.
    В DEBUG: только явный туннель (ngrok). Прод/localhost не передаём —
    иначе банк стучится не в ту БД. Тариф локально — через GetState (sync).
    """
    custom = (getattr(settings, "TBANK_NOTIFICATION_URL", "") or "").strip()
    if getattr(settings, "DEBUG", False):
        if custom and _is_tunnel_url(custom):
            return custom
        if custom:
            logger.warning(
                "T-Bank NotificationURL пропущен в DEBUG (%s). "
                "Нужен ngrok-URL; иначе тариф через GetState на фронте.",
                custom,
            )
        return None
    return custom or f"{_public_base()}/payments/webhook/tbank/"


def _order_id_for_payment(payment) -> str:
    """Уникальный OrderId; webhook парсит id платежа до первого '-'."""
    return f"{payment.pk}-{uuid.uuid4().hex[:8]}"


def _payment_id_from_order_id(order_id) -> int:
    raw = str(order_id or "").strip()
    head = raw.split("-", 1)[0]
    return int(head)


def _safe_description(plan, billing_period: str) -> str:
    period_label = "год" if billing_period == "year" else "месяц"
    name = re.sub(r"[«»\"']", "", str(getattr(plan, "name", "") or "tariff"))
    text = f"ITFlux: tarif {name} / {period_label}"
    return text[:250]


def _item_name(plan, billing_period: str) -> str:
    period_label = "год" if billing_period == "year" else "месяц"
    name = str(getattr(plan, "name", "") or "Подписка").strip()
    text = f"Подписка ITFlux «{name}» на {period_label}"
    return text[:128]


def _receipt_email(payment) -> str:
    email = (getattr(payment.teacher, "email", None) or "").strip()
    if email:
        return email
    fallback = _strip_env(getattr(settings, "TBANK_RECEIPT_EMAIL", "") or "")
    return fallback


def build_receipt(payment, plan, *, amount_kopecks: int) -> dict[str, Any]:
    """
    Объект Receipt для Init (обязателен при подключённой онлайн-кассе / тестах чека).
    Вложенный объект — в Token не входит.
    Документация: https://developer.tbank.ru/eacq/api/init
    """
    taxation = (
        _strip_env(getattr(settings, "TBANK_TAXATION", "") or "") or "usn_income"
    ).lower()
    tax = (_strip_env(getattr(settings, "TBANK_VAT", "") or "") or "none").lower()
    ffd = (_strip_env(getattr(settings, "TBANK_FFD_VERSION", "") or "") or "1.05").strip()

    item: dict[str, Any] = {
        "Name": _item_name(plan, payment.billing_period),
        "Price": amount_kopecks,
        "Quantity": 1,
        "Amount": amount_kopecks,
        "PaymentMethod": "full_payment",
        "PaymentObject": "service",
        "Tax": tax,
    }
    # Для ФФД 1.2 нужны доп. поля позиции
    if ffd.startswith("1.2"):
        item["MeasurementUnit"] = "шт"

    receipt: dict[str, Any] = {
        "Taxation": taxation,
        "Items": [item],
    }
    email = _receipt_email(payment)
    if email:
        receipt["Email"] = email
    else:
        # Email или Phone обязателен для чека — запасной служебный
        receipt["Email"] = "noreply@itflux-academy.ru"

    if ffd.startswith("1.2"):
        receipt["FfdVersion"] = "1.2"

    return receipt


def map_tbank_status(status: str) -> str:
    status = (status or "").strip().upper()
    if status in _PAID_STATUSES:
        return "paid"
    if status in _REFUNDED_STATUSES:
        return "refunded"
    if status in _CANCELLED_STATUSES:
        return "cancelled"
    if status in _FAILED_STATUSES:
        return "failed"
    # NEW, FORM_SHOWED, AUTHORIZING, 3DS_CHECKING, … — ещё в процессе
    return "pending"


class TBankPaymentProvider(PaymentProviderInterface):
    """Готовая платёжная форма Т-Банка (non-PCI redirect)."""

    def create_checkout(self, payment, plan) -> str:
        terminal = _terminal_key()
        password = _password()
        if not terminal or not password:
            raise ValueError(
                "Т-Банк не настроен: задайте TBANK_TERMINAL_KEY и TBANK_PASSWORD "
                "(или PAYMENT_SHOP_ID / PAYMENT_SECRET_KEY)."
            )

        amount = payment.final_amount if payment.final_amount is not None else payment.amount
        kopecks = amount_to_kopecks(amount)
        order_id = _order_id_for_payment(payment)

        body: dict[str, Any] = {
            "TerminalKey": terminal,
            "Amount": kopecks,
            "OrderId": order_id,
            "Description": _safe_description(plan, payment.billing_period),
            "SuccessURL": _success_url(payment),
            "FailURL": _fail_url(payment),
            # Чек для онлайн-кассы / тестового сценария «Формирование чека»
            "Receipt": build_receipt(payment, plan, amount_kopecks=kopecks),
        }
        notification_url = _notification_url()
        if notification_url:
            body["NotificationURL"] = notification_url
        email = _receipt_email(payment)
        if email:
            body["DATA"] = {"Email": email}

        body["Token"] = build_tbank_token(body, password=password)

        logger.info(
            "T-Bank Init URLs payment_id=%s SuccessURL=%s FailURL=%s NotificationURL=%s",
            payment.pk,
            body.get("SuccessURL"),
            body.get("FailURL"),
            body.get("NotificationURL") or "(omitted)",
        )

        url = f"{_api_base()}/Init"
        verify = _ssl_verify()
        if not verify:
            logger.warning("T-Bank Init: TLS verification disabled (TBANK_VERIFY_SSL=false)")
        try:
            response = requests.post(url, json=body, timeout=30, verify=verify)
            data = response.json()
        except requests.exceptions.SSLError as exc:
            logger.exception("T-Bank Init SSL error")
            raise ValueError(
                "Ошибка SSL при обращении к Т-Банку (часто из‑за антивируса/прокси). "
                "Для локальной проверки добавьте в Generator/.env: TBANK_VERIFY_SSL=false "
                f"и перезапустите Django. Детали: {exc}"
            ) from exc
        except Exception as exc:
            logger.exception("T-Bank Init request failed")
            raise ValueError(f"Не удалось связаться с Т-Банком: {exc}") from exc

        if not data.get("Success"):
            details = (data.get("Details") or "").strip()
            message = (data.get("Message") or "Init rejected").strip()
            error_code = data.get("ErrorCode")
            logger.error("T-Bank Init error: %s", data)
            # 204/205 — почти всегда неверная пара TerminalKey/Password
            if str(error_code) in ("204", "205") or "токен" in details.lower():
                raise ValueError(
                    "Т-Банк отклонил платёж: неверный TerminalKey или Password. "
                    "В ЛК эквайринга откройте магазин → Терминалы → нужный терминал "
                    "(для DEMO — тестовый), скопируйте ключ и пароль заново в "
                    "Generator/.env (без пробелов) и перезапустите Django. "
                    f"Ответ банка: [{error_code}] {details or message}"
                )
            raise ValueError(
                f"Т-Банк отклонил платёж: [{error_code}] {details or message}"
            )

        payment_url = (data.get("PaymentURL") or "").strip()
        provider_payment_id = str(data.get("PaymentId") or "")
        if not payment_url or not provider_payment_id:
            raise ValueError("Т-Банк не вернул PaymentURL/PaymentId")

        meta = dict(payment.metadata or {})
        meta.update(
            {
                "tbank_status": data.get("Status"),
                "tbank_order_id": order_id,
                "plan_slug": getattr(plan, "slug", None) or meta.get("plan_slug"),
                "billing_period": payment.billing_period,
                "amount_kopecks": kopecks,
            }
        )
        payment.provider_payment_id = provider_payment_id
        payment.provider = "tbank"
        payment.metadata = meta
        payment.save(
            update_fields=["provider_payment_id", "provider", "metadata", "updated_at"]
        )
        return payment_url

    def check_status(self, payment) -> dict:
        terminal = _terminal_key()
        password = _password()
        if not terminal or not password or not payment.provider_payment_id:
            return {
                "status": payment.status,
                "provider_payment_id": payment.provider_payment_id or "",
            }

        body = {
            "TerminalKey": terminal,
            "PaymentId": str(payment.provider_payment_id),
        }
        body["Token"] = build_tbank_token(body, password=password)
        try:
            response = requests.post(
                f"{_api_base()}/GetState",
                json=body,
                timeout=20,
                verify=_ssl_verify(),
            )
            data = response.json()
        except Exception as exc:
            logger.warning("T-Bank GetState failed: %s", exc)
            return {
                "status": payment.status,
                "provider_payment_id": payment.provider_payment_id or "",
                "error": str(exc),
            }

        mapped = map_tbank_status(data.get("Status") or "")
        return {
            "status": mapped if mapped != "pending" else payment.status,
            "provider_status": data.get("Status"),
            "provider_payment_id": str(data.get("PaymentId") or payment.provider_payment_id),
            "raw_success": bool(data.get("Success")),
        }

    def parse_webhook(self, payload: dict) -> dict:
        payload = payload or {}
        if not verify_tbank_token(payload):
            raise ValueError("invalid_tbank_token")

        try:
            payment_id = _payment_id_from_order_id(payload.get("OrderId"))
        except (TypeError, ValueError) as exc:
            raise ValueError("invalid_order_id") from exc

        provider_status = str(payload.get("Status") or "")
        mapped = map_tbank_status(provider_status)
        provider_payment_id = str(payload.get("PaymentId") or "")
        event_id = f"tbank_{provider_payment_id}_{provider_status}"

        return {
            "payment_id": payment_id,
            "status": mapped,
            "event_id": event_id,
            "provider_payment_id": provider_payment_id,
            "provider_status": provider_status,
        }
