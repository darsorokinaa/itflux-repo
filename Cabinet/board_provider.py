"""Выбор реализации доски урока.

Не меняет доступ к уроку, сцену Excalidraw и видеопровайдер.
Откат: BOARD_PROVIDER=excalidraw и перезапуск процесса.
"""

from django.conf import settings

BOARD_PROVIDER_EXCALIDRAW = "excalidraw"
BOARD_PROVIDER_TLDRAW = "tldraw"


def get_board_provider() -> str:
    raw = str(getattr(settings, "BOARD_PROVIDER", "") or BOARD_PROVIDER_EXCALIDRAW).strip().lower()
    if raw == BOARD_PROVIDER_TLDRAW:
        return BOARD_PROVIDER_TLDRAW
    return BOARD_PROVIDER_EXCALIDRAW
