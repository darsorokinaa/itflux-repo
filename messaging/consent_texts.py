"""Неизменяемые тексты согласия.

Версия хранит полный текст и его sha256. Метка «v1» без текста не используется.
Новая формулировка — новая версия, старая остаётся в этом модуле.
"""

from __future__ import annotations

import hashlib
import json
from typing import Any

MARKETING_CONSENT_V1 = "marketing_consent_v1"
MARKETING_PROMPT_V1 = "marketing_preferences_v1"

_VERSIONS: dict[str, dict[str, str]] = {
    MARKETING_CONSENT_V1: {
        "version": MARKETING_CONSENT_V1,
        "prompt_key": MARKETING_PROMPT_V1,
        "title": "Хотите получать новости и полезные обновления?",
        "email_label": "По электронной почте",
        "email_text": (
            "Согласен(на) получать на email, указанный в аккаунте, информационные "
            "и рекламные сообщения: новости платформы, новые возможности, "
            "специальные предложения, акции и промокоды."
        ),
        "inapp_label": "В сообщениях на платформе",
        "inapp_text": (
            "Согласен(на) получать в разделе «Сообщения» информационные и рекламные "
            "сообщения: новости, новые возможности, специальные предложения, акции и промокоды."
        ),
        "note": (
            "Согласие добровольное. Его можно изменить или отозвать в любой момент "
            "в настройках уведомлений. Системные сообщения и ответы поддержки могут "
            "направляться независимо от настроек рекламных рассылок."
        ),
        "neutral_intro": (
            "На платформе появился раздел сообщений. Здесь можно обращаться в поддержку "
            "и получать важную информацию о работе сервиса. Также вы можете отдельно "
            "выбрать, хотите ли получать новости и предложения."
        ),
    },
}


class UnknownConsentVersion(LookupError):
    pass


def get_consent_definition(version: str = MARKETING_CONSENT_V1) -> dict[str, str]:
    try:
        return dict(_VERSIONS[version])
    except KeyError as exc:
        raise UnknownConsentVersion(version) from exc


def consent_text_sha256(version: str = MARKETING_CONSENT_V1) -> str:
    definition = get_consent_definition(version)
    canonical = json.dumps(definition, ensure_ascii=False, sort_keys=True, separators=(",", ":"))
    return hashlib.sha256(canonical.encode("utf-8")).hexdigest()


def consent_snapshot(version: str = MARKETING_CONSENT_V1) -> tuple[dict[str, Any], str]:
    definition = get_consent_definition(version)
    return definition, consent_text_sha256(version)
