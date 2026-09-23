"""Защита назначения сообщения.

Это ограничитель известных коммерческих сигналов, а не вывод о том,
что остальной текст юридически не является рекламой.
Сервер не подменяет purpose сам: он отклоняет сохранение.
"""

from __future__ import annotations

import re

PURPOSE_SUPPORT = "support"
PURPOSE_SYSTEM = "system"
PURPOSE_SERVICE = "service"
PURPOSE_PRODUCT_UPDATE = "product_update"
PURPOSE_MARKETING = "marketing"

PURPOSES = (
    PURPOSE_SUPPORT,
    PURPOSE_SYSTEM,
    PURPOSE_SERVICE,
    PURPOSE_PRODUCT_UPDATE,
    PURPOSE_MARKETING,
)

OPERATIONAL_PURPOSES = frozenset({
    PURPOSE_SYSTEM,
    PURPOSE_SERVICE,
    PURPOSE_PRODUCT_UPDATE,
})

_COMMERCIAL_TEXT = re.compile(
    "|".join(
        (
            r"промокод",
            r"promo\s*-?\s*code",
            r"скидк",
            r"discount",
            r"\bакци[яию]\b",
            r"специальн\w{0,8}\s+предложен",
            r"только сегодня",
            r"ограниченн\w{0,8}\s+предложен",
            r"купите",
            r"купить тариф",
            r"оформите тариф",
            r"предложение тарифа",
        )
    ),
    re.IGNORECASE,
)

_COMMERCIAL_CTA = re.compile(
    r"купить|тариф|скидк|акци|промо|upgrade|pricing",
    re.IGNORECASE,
)

_COMMERCIAL_ROUTE = re.compile(
    r"upgrade|pricing|tariff|tarif",
    re.IGNORECASE,
)


class PurposeRejected(Exception):
    def __init__(self, message: str):
        super().__init__(message)
        self.message = message


def has_commercial_signal(text: str, *, button_text: str = "", button_route: str = "") -> bool:
    blob = text or ""
    if _COMMERCIAL_TEXT.search(blob):
        return True
    if button_text and _COMMERCIAL_CTA.search(button_text):
        return True
    if button_route and _COMMERCIAL_ROUTE.search(button_route):
        return True
    return False


def assert_purpose_allowed(
    purpose: str,
    text: str,
    *,
    button_text: str = "",
    button_route: str = "",
) -> None:
    """Отклоняет system/service/product_update с явным коммерческим сигналом.

    marketing и support здесь не переписываются. Отсутствие сигнала не означает,
    что текст признан нерекламным.
    """
    if purpose not in PURPOSES:
        raise PurposeRejected("Неизвестное назначение сообщения.")
    if purpose not in OPERATIONAL_PURPOSES:
        return
    if has_commercial_signal(text, button_text=button_text, button_route=button_route):
        raise PurposeRejected(
            "В тексте или кнопке есть коммерческий сигнал. "
            "Такое сообщение можно сохранить только с назначением marketing."
        )
