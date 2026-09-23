"""Единая проверка текста и вложений мессенджера.

Нормализованная копия используется только для решения.
Исходный текст не изменяется и при блокировке не сохраняется.
"""

from __future__ import annotations

import hashlib
import html
import io
import re
import zipfile
from dataclasses import dataclass
from urllib.parse import unquote, urlparse

from django.conf import settings
from django.core.cache import cache

USER_MESSAGES = {
    "EXTERNAL_URL": "В сообщениях можно использовать только ссылки внутри платформы.",
    "PHONE_NUMBER": "Передавать номера телефонов через сообщения нельзя.",
    "EMAIL": (
        "Это сообщение нельзя отправить. "
        "В целях безопасности внутри платформы нельзя передавать номера телефонов, "
        "банковские реквизиты и внешние ссылки."
    ),
    "BANK_CARD": "Прямые переводы между пользователями через сообщения не поддерживаются.",
    "PAYMENT_REQUEST": "Прямые переводы между пользователями через сообщения не поддерживаются.",
    "EXTERNAL_CONTACT": (
        "Это сообщение нельзя отправить. "
        "В целях безопасности внутри платформы нельзя передавать номера телефонов, "
        "банковские реквизиты и внешние ссылки."
    ),
    "DANGEROUS_ATTACHMENT": (
        "Это сообщение нельзя отправить. "
        "В целях безопасности внутри платформы нельзя передавать номера телефонов, "
        "банковские реквизиты и внешние ссылки."
    ),
    "SPAM": "Слишком много одинаковых сообщений. Подождите немного.",
}

SERIOUS_REASONS = frozenset({
    "EXTERNAL_URL",
    "PHONE_NUMBER",
    "EMAIL",
    "BANK_CARD",
    "PAYMENT_REQUEST",
    "EXTERNAL_CONTACT",
    "DANGEROUS_ATTACHMENT",
})

_ZERO_WIDTH = re.compile(r"[\u200b\u200c\u200d\u2060\ufeff\u00ad\u180e]")
_HOMOGLYPHS = str.maketrans({
    "а": "a", "е": "e", "о": "o", "р": "p", "с": "c", "у": "y", "х": "x", "к": "k",
    "А": "a", "Е": "e", "О": "o", "Р": "p", "С": "c", "Х": "x", "К": "k",
    "і": "i", "ї": "i", "І": "i",
})
_TLDS = frozenset({
    "ru", "su", "рф", "com", "net", "org", "io", "me", "app", "dev", "info",
    "biz", "pro", "online", "site", "shop", "xyz", "cc", "tv", "ws", "gl",
    "ly", "be", "to", "tg", "link", "click", "live", "store", "ua", "by", "kz",
})
_SCHEME = re.compile(
    r"(?:https?|hxxps?|ftp|mailto|javascript|data)\s*:\s*[^\s<>'\"]+",
    re.IGNORECASE,
)
_WWW = re.compile(r"\bwww\.[a-z0-9.-]+", re.IGNORECASE)
_BARE = re.compile(
    r"\b(?:[a-z0-9-]{1,63}\.)+(?:ru|su|com|net|org|io|me|app|dev|info|biz|pro|online|site|shop|xyz|cc|tv|ws|gl|ly|be|to|tg|link|ua|by|kz)\b(?:\s*/\s*[^\s<>'\"]*)?",
    re.IGNORECASE,
)
_EMAIL = re.compile(r"\b[a-z0-9._%+-]{1,64}@[a-z0-9.-]+\.[a-z]{2,}\b", re.IGNORECASE)
_RU_PHONE = re.compile(r"(?<!\d)(?:\+7|7|8)(?:[\s().\-/]*\d){10}(?!\d)")
_INTL_PHONE = re.compile(r"(?<!\d)\+\d(?:[\s().\-/]*\d){9,14}(?!\d)")
_CARD_GROUPED = re.compile(r"(?<!\d)(?:\d{4}[\s\-]+){3}\d{4}(?!\d)")
_LONG_DIGITS = re.compile(r"(?<!\d)\d{13,19}(?!\d)")
_LATIN_HANDLE = re.compile(r"(?<!@)@[a-z][a-z0-9_]{2,31}\b(?!\.)", re.IGNORECASE)
_ACTIVE_HTML = re.compile(
    r"<\s*/?\s*(?:script|iframe|object|embed|style|a)\b|on(?:error|load|click|mouseover)\s*=",
    re.IGNORECASE,
)
_SOCIAL = re.compile(
    r"(?:напиш\w*|пиш\w*|свяж\w*|добав\w*|мой|вот).{0,40}?"
    r"(?:телеграм\w*|телег\w*|\bтг\b|whatsapp|ватсап\w*|вацап\w*|вконтакте|\bвк\b|"
    r"вайбер\w*|viber|discord|дискорд\w*|skype|скайп\w*|instagram|инстаграм\w*|signal)",
    re.IGNORECASE,
)
_PAYMENT = re.compile(
    r"(?:"
    r"перевед\w*\s+на\s+карт|"
    r"перевод\w*\s+по\s+номер|"
    r"переведи(?:те)?\s+мне|"
    r"скинь(?:те)?\s+деньг|"
    r"скин\w*\s+(?:на\s+)?карт|"
    r"скин\w*\s+реквизит|"
    r"оплат\w*\s+(?:мне\s+)?напрямую|"
    r"оплат\w*\s+вне\s+платформ|"
    r"перевод\w*\s+напрямую|"
    r"без\s+платформ|"
    r"обойд\w*\s+комисси|"
    r"без\s+комисси\w*\s+перевод|"
    r"по\s+реквизит|"
    r"мои\s+реквизит|"
    r"номер\s+карт|"
    r"реквизит\w*\s+карт|"
    r"оплат\w*\s+на\s+карт|"
    r"карт\w*\s+для\s+оплат|"
    r"систем\w*\s+быстр\w*\s+платеж|"
    r"\bсбп\b|"
    r"перевод\w*\s+по\s+сбп|"
    r"оплат\w*\s+по\s+номер\w*\s+телефон|"
    r"перевед\w*\s+по\s+номер|"
    r"оплат\w*\s+напрямую|"
    r"так\s+дешевле.{0,40}перевод|"
    r"давай\s+без\s+платформ"
    r")",
    re.IGNORECASE,
)
_PHONE_CONTEXT = re.compile(
    r"телефон|тел\s*:|мой\s+номер|позвони|напиш\w*\s+по\s+номер|номер\s+для\s+связ",
    re.IGNORECASE,
)
_CARD_CONTEXT = re.compile(
    r"номер\s+карт|карт\w*\s+для\s+оплат|скин\w*\s+карт|реквизит\w*\s+карт|оплат\w*\s+на\s+карт|вот\s+карт\w*\s+\d",
    re.IGNORECASE,
)
_SUSPICIOUS = re.compile(r"так\s+дешевле|мой\s+ник\b", re.IGNORECASE)


class MessageBlocked(Exception):
    code = "MESSAGE_BLOCKED"

    def __init__(self, reason: str):
        self.reason = reason
        self.message = USER_MESSAGES.get(reason, USER_MESSAGES["EXTERNAL_CONTACT"])
        super().__init__(self.message)


@dataclass(frozen=True)
class SafetyDecision:
    action: str
    reason: str = ""

    @property
    def blocked(self) -> bool:
        return self.action == "block"


def allow() -> SafetyDecision:
    return SafetyDecision("allow")


def _plain(text: str) -> str:
    value = html.unescape(text or "")
    value = unquote(unquote(value))
    value = _ZERO_WIDTH.sub("", value)
    value = value.replace("ё", "е").replace("Ё", "Е")
    value = re.sub(r"\s+", " ", value)
    return value.casefold()


def _for_links(plain: str) -> str:
    # Слова «точка» и «собака» заменяются до homoglyph: иначе кириллица
    # внутри них превращается в латиницу и обход перестаёт распознаваться.
    value = plain
    value = re.sub(r"\bhxxps\b", "https", value)
    value = re.sub(r"\bhxxp\b", "http", value)
    value = re.sub(r"(?<!\w)(?:точка|тчк|dot)(?!\w)", " . ", value)
    value = re.sub(r"\s*(?:\[\.\]|\(\.\))\s*", ".", value)
    value = re.sub(r"(?<!\w)собака(?!\w)", " @ ", value)
    value = re.sub(r"\s*(?:\[at\]|\(at\))\s*", "@", value)
    value = value.translate(_HOMOGLYPHS)
    for _ in range(4):
        folded = re.sub(r"([a-z0-9-])\s*\.\s*([a-z0-9-])", r"\1.\2", value)
        folded = re.sub(r"([a-z0-9._%+-])\s*@\s*([a-z0-9-])", r"\1@\2", folded)
        if folded == value:
            break
        value = folded
    value = re.sub(
        r"\bwww(?:\s+|\.)([a-z0-9-]{1,63})(?:\s+|\.)([a-z]{2,12})\b",
        r"www.\1.\2",
        value,
    )
    return value


def link_allowlist() -> tuple[str, ...]:
    raw = getattr(settings, "MESSAGING_LINK_ALLOWLIST", None) or ("itflux.ru",)
    return tuple(item.strip().casefold().rstrip(".") for item in raw if str(item).strip())


def host_allowed(hostname: str) -> bool:
    host = (hostname or "").casefold().rstrip(".")
    if not host or host in {"localhost", "127.0.0.1", "0.0.0.0", "::1"}:
        return False
    for allowed in link_allowlist():
        if host == allowed or host.endswith("." + allowed):
            return True
    return False


def _verdict_for_url(candidate: str) -> SafetyDecision | None:
    raw = candidate.strip().strip(").,;>\"'")
    lowered = raw.casefold().replace(" ", "")
    if lowered.startswith(("javascript:", "data:", "mailto:", "ftp:")):
        return SafetyDecision("block", "EXTERNAL_URL")
    probe = raw
    if "://" not in probe and probe.startswith("www."):
        probe = "http://" + probe
    elif "://" not in probe:
        probe = "http://" + probe
    parsed = urlparse(probe)
    scheme = (parsed.scheme or "").casefold()
    if scheme in {"javascript", "data", "mailto", "ftp"}:
        return SafetyDecision("block", "EXTERNAL_URL")
    host = (parsed.hostname or "").casefold().rstrip(".")
    if not host:
        return SafetyDecision("block", "EXTERNAL_URL")
    if scheme in {"http", "https", ""} and host_allowed(host):
        return None
    return SafetyDecision("block", "EXTERNAL_URL")


def _digits(value: str) -> str:
    return re.sub(r"\D", "", value)


def _luhn(number: str) -> bool:
    if not number.isdigit() or not 13 <= len(number) <= 19:
        return False
    total = 0
    alt = False
    for char in reversed(number):
        digit = int(char)
        if alt:
            digit *= 2
            if digit > 9:
                digit -= 9
        total += digit
        alt = not alt
    return total % 10 == 0


def _strip_mentions(text: str, labels: list[str]) -> str:
    cleaned = text
    for label in sorted({item.strip() for item in labels if item and item.strip()}, key=len, reverse=True):
        cleaned = re.sub(rf"@{re.escape(label)}", " ", cleaned, flags=re.IGNORECASE)
    return cleaned


def inspect_text(text: str, *, mention_labels: list[str] | None = None) -> SafetyDecision:
    """ALLOW, BLOCK или REVIEW. Исходная строка не меняется."""
    if not (text or "").strip():
        return allow()
    plain = _plain(text)
    folded = _for_links(plain)
    mentioned = _strip_mentions(plain, mention_labels or [])

    if _ACTIVE_HTML.search(plain) or _ACTIVE_HTML.search(text or ""):
        return SafetyDecision("block", "EXTERNAL_URL")

    for match in _SCHEME.finditer(folded):
        verdict = _verdict_for_url(match.group(0))
        if verdict is not None:
            return verdict

    if _EMAIL.search(folded):
        return SafetyDecision("block", "EMAIL")

    for pattern in (_WWW, _BARE):
        for match in pattern.finditer(folded):
            verdict = _verdict_for_url(match.group(0))
            if verdict is not None:
                return verdict
    if _RU_PHONE.search(plain) or _INTL_PHONE.search(plain):
        return SafetyDecision("block", "PHONE_NUMBER")
    if _PHONE_CONTEXT.search(plain) and len(_digits(plain)) >= 10:
        return SafetyDecision("block", "PHONE_NUMBER")
    if _CARD_GROUPED.search(plain):
        return SafetyDecision("block", "BANK_CARD")
    for match in _LONG_DIGITS.finditer(plain):
        if _luhn(match.group(0)) or _CARD_CONTEXT.search(plain):
            return SafetyDecision("block", "BANK_CARD")
    if _LATIN_HANDLE.search(mentioned):
        return SafetyDecision("block", "EXTERNAL_CONTACT")
    if _SOCIAL.search(plain):
        return SafetyDecision("block", "EXTERNAL_CONTACT")
    if _PAYMENT.search(plain):
        return SafetyDecision("block", "PAYMENT_REQUEST")
    if _CARD_CONTEXT.search(plain):
        return SafetyDecision("block", "BANK_CARD")
    if _SUSPICIOUS.search(plain) or any(
        not _luhn(match.group(0)) and not _CARD_CONTEXT.search(plain)
        for match in _LONG_DIGITS.finditer(plain)
    ):
        return SafetyDecision("review", "PAYMENT_REQUEST" if _SUSPICIOUS.search(plain) else "BANK_CARD")
    return allow()


def inspect_filename(name: str) -> SafetyDecision:
    base = (name or "").rsplit("/", 1)[-1].rsplit("\\", 1)[-1]
    if "." in base:
        base = base.rsplit(".", 1)[0]
    readable = base.replace("_", " ").replace("-", " ")
    return inspect_text(readable)


def inspect_qr_payload(payload: str) -> SafetyDecision:
    if (payload or "").lstrip().upper().startswith("ST0001"):
        return SafetyDecision("block", "PAYMENT_REQUEST")
    return inspect_text(payload or "")


def extract_qr_payloads(data: bytes) -> list[str]:
    try:
        from PIL import Image
    except Exception:
        return []
    try:
        image = Image.open(io.BytesIO(data))
        image.load()
        rgb = image.convert("RGB")
    except Exception:
        return []
    payloads = []
    try:
        import zxingcpp
        for item in zxingcpp.read_barcodes(rgb):
            text = getattr(item, "text", "") or ""
            if text:
                payloads.append(text)
    except Exception:
        payloads = []
    if payloads:
        return payloads
    try:
        from pyzbar.pyzbar import decode as zbar_decode
    except Exception:
        return payloads
    for item in zbar_decode(rgb):
        payloads.append(bytes(item.data).decode("utf-8", "ignore"))
    return payloads


def inspect_file(name: str, data: bytes) -> SafetyDecision:
    named = inspect_filename(name)
    if named.blocked:
        return named
    ext = (name or "").rsplit(".", 1)[-1].casefold() if "." in (name or "") else ""
    if ext == "pdf" and any(token in data for token in (b"/JavaScript", b"/JS", b"/Launch", b"/EmbeddedFile")):
        return SafetyDecision("block", "DANGEROUS_ATTACHMENT")
    if ext == "docx":
        try:
            with zipfile.ZipFile(io.BytesIO(data)) as archive:
                names = " ".join(archive.namelist())
        except zipfile.BadZipFile:
            return SafetyDecision("block", "DANGEROUS_ATTACHMENT")
        if "vbaProject.bin" in names or "oleObject" in names:
            return SafetyDecision("block", "DANGEROUS_ATTACHMENT")
    if ext in {"png", "jpg", "jpeg", "gif", "webp"}:
        decoded = False
        try:
            from PIL import Image
            from PIL.Image import DecompressionBombError
        except ImportError:
            Image = None
            DecompressionBombError = ()
        if Image is not None:
            Image.MAX_IMAGE_PIXELS = 20_000_000
            try:
                with Image.open(io.BytesIO(data)) as image:
                    image.verify()
                decoded = True
            except DecompressionBombError:
                return SafetyDecision("block", "DANGEROUS_ATTACHMENT")
            except Exception:
                decoded = False
        if decoded:
            for payload in extract_qr_payloads(data):
                verdict = inspect_qr_payload(payload)
                if verdict.blocked:
                    return verdict
    return named if named.action == "review" else allow()


def assert_internal_route(route: str) -> None:
    value = (route or "").strip()
    if not value:
        return
    if not value.startswith("/") or value.startswith("//") or "\\" in value or ".." in value or "://" in value:
        raise MessageBlocked("EXTERNAL_URL")
    parsed = urlparse(value)
    if parsed.scheme or parsed.netloc:
        raise MessageBlocked("EXTERNAL_URL")


def mention_labels_for(conversation) -> list[str]:
    from .access import display_name_of
    labels = []
    for row in conversation.participants.select_related("user__profile").filter(hidden_at__isnull=True):
        labels.append(display_name_of(row.user))
        if row.user.username:
            labels.append(row.user.username)
    return labels


def enforce_text(user, conversation, text: str) -> SafetyDecision:
    decision = inspect_text(text, mention_labels=mention_labels_for(conversation))
    _record(user, conversation, decision, text)
    if decision.blocked:
        raise MessageBlocked(decision.reason)
    return decision


def enforce_file(user, conversation, name: str, data: bytes) -> None:
    decision = inspect_file(name, data)
    _record(user, conversation, decision, name)
    if decision.blocked:
        raise MessageBlocked(decision.reason)


def spam_fanout(user, conversation, text: str) -> None:
    normalized = _plain(text)
    if len(normalized) < 12:
        return
    digest = hashlib.sha256(normalized.encode()).hexdigest()
    key = f"msg-spam:{user.id}:{digest}"
    current = list(cache.get(key) or [])
    marker = str(conversation.id)
    if marker not in current:
        current.append(marker)
    limit = int(getattr(settings, "MESSAGING_SPAM_FANOUT", 12))
    cache.set(key, current[:50], timeout=120)
    if len(current) >= limit:
        decision = SafetyDecision("block", "SPAM")
        _record(user, conversation, decision, text)
        raise MessageBlocked("SPAM")


def _record(user, conversation, decision: SafetyDecision, material: str) -> None:
    if decision.action == "allow":
        return
    from .models import MessagingAuditLog
    from .retention import KIND_AUDIT_LOGS, retention_until_for
    digest = hashlib.sha256((material or "").encode()).hexdigest()
    MessagingAuditLog.objects.create(
        actor=user if getattr(user, "pk", None) else None,
        action="message_blocked" if decision.blocked else "message_review",
        object_kind="conversation",
        object_id=str(getattr(conversation, "id", "") or ""),
        meta={"reason": decision.reason, "sha256": digest},
        retention_until=retention_until_for(KIND_AUDIT_LOGS),
    )
    if not decision.blocked or decision.reason not in SERIOUS_REASONS or user is None:
        return
    count_key = f"msg-block:{user.id}"
    try:
        count = cache.incr(count_key)
    except ValueError:
        cache.set(count_key, 1, timeout=60 * 60 * 24)
        count = 1
    if count == 1:
        cache.touch(count_key, timeout=60 * 60 * 24)
    flag = f"msg-moderation:{user.id}"
    if count >= 3 and cache.add(flag, 1, timeout=60 * 60 * 24):
        MessagingAuditLog.objects.create(
            actor=user,
            action="moderation_review",
            object_kind="user",
            object_id=str(user.id),
            meta={"reason": decision.reason, "count": count},
            retention_until=retention_until_for(KIND_AUDIT_LOGS),
        )
