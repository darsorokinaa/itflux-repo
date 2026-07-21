"""Установка Telegram webhook для привязки аккаунтов и уведомлений."""

from __future__ import annotations

import json

from django.conf import settings
from django.core.management.base import BaseCommand, CommandError


class Command(BaseCommand):
    help = (
        "Регистрирует webhook бота: POST /api/cabinet/telegram/webhook/. "
        "Без webhook привязка Telegram и уведомления не работают."
    )

    def add_arguments(self, parser):
        parser.add_argument(
            "--url",
            default="",
            help="Полный URL webhook (по умолчанию LK_PUBLIC_URL + /api/cabinet/telegram/webhook/)",
        )
        parser.add_argument(
            "--delete",
            action="store_true",
            help="Удалить webhook (для локальной отладки через getUpdates)",
        )
        parser.add_argument(
            "--info",
            action="store_true",
            help="Показать текущий getWebhookInfo без изменений",
        )

    def handle(self, *args, **options):
        token = (getattr(settings, "TELEGRAM_BOT_TOKEN", "") or "").strip()
        if not token:
            raise CommandError("TELEGRAM_BOT_TOKEN не задан")

        base = f"https://api.telegram.org/bot{token}"

        if options["info"]:
            info = self._get(f"{base}/getWebhookInfo")
            self.stdout.write(json.dumps(info, ensure_ascii=False, indent=2))
            return

        if options["delete"]:
            result = self._api_post(f"{base}/deleteWebhook", {"drop_pending_updates": "true"})
            self.stdout.write(self.style.SUCCESS(json.dumps(result, ensure_ascii=False)))
            return

        webhook_url = (options["url"] or "").strip()
        if not webhook_url:
            public = (getattr(settings, "LK_PUBLIC_URL", "") or "").rstrip("/")
            if not public:
                raise CommandError("Задайте --url или LK_PUBLIC_URL")
            webhook_url = f"{public}/api/cabinet/telegram/webhook/"

        secret = (getattr(settings, "TELEGRAM_WEBHOOK_SECRET", "") or "").strip()
        payload = {
            "url": webhook_url,
            "drop_pending_updates": "true",
        }
        if secret:
            payload["secret_token"] = secret
        else:
            self.stdout.write(
                self.style.WARNING(
                    "TELEGRAM_WEBHOOK_SECRET пуст — webhook без secret_token "
                    "(на проде DEBUG=False запросы будут отклонены)."
                )
            )

        result = self._api_post(f"{base}/setWebhook", payload)
        if not result.get("ok"):
            raise CommandError(
                "Не удалось установить webhook. "
                f"Проверьте, что URL публично резолвится (HTTPS): {webhook_url}\n"
                f"Ответ Telegram: {json.dumps(result, ensure_ascii=False)}"
            )

        self.stdout.write(self.style.SUCCESS(f"Webhook установлен: {webhook_url}"))
        info = self._get(f"{base}/getWebhookInfo")
        self.stdout.write(json.dumps(info, ensure_ascii=False, indent=2))

    def _get(self, url: str) -> dict:
        from Generator.telegram_utils import _NO_PROXY_OPENER

        with _NO_PROXY_OPENER.open(url, timeout=20) as resp:
            return json.loads(resp.read().decode())

    def _api_post(self, url: str, data: dict) -> dict:
        import urllib.error
        import urllib.parse
        import urllib.request

        from Generator.telegram_utils import _NO_PROXY_OPENER

        body = urllib.parse.urlencode(data).encode("utf-8")
        req = urllib.request.Request(url, data=body, method="POST")
        req.add_header("Content-Type", "application/x-www-form-urlencoded")
        try:
            with _NO_PROXY_OPENER.open(req, timeout=20) as resp:
                return json.loads(resp.read().decode())
        except urllib.error.HTTPError as exc:
            raw = ""
            try:
                raw = exc.read().decode()
                return json.loads(raw) if raw else {"ok": False, "description": str(exc)}
            except Exception:
                return {"ok": False, "description": raw or str(exc)}
