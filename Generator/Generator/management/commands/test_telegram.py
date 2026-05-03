"""
Проверка отправки в Telegram. Запуск: python manage.py test_telegram
"""
from django.core.management.base import BaseCommand
from django.conf import settings

from Generator import telegram_utils


class Command(BaseCommand):
    help = "Проверить отправку тестового сообщения в Telegram"

    def handle(self, *args, **options):
        token = getattr(settings, "TELEGRAM_BOT_TOKEN", None) or ""
        chat_id = getattr(settings, "TELEGRAM_CHAT_ID", None) or ""
        topic_id = getattr(settings, "TELEGRAM_TOPIC_ID", None)

        self.stdout.write(f"TELEGRAM_BOT_TOKEN: {'*' * 8 if token else '(не задан)'}")
        self.stdout.write(f"TELEGRAM_CHAT_ID: {chat_id or '(не задан)'}")
        self.stdout.write(f"TELEGRAM_TOPIC_ID: {topic_id or '(не задан)'}")

        if not token or not chat_id:
            self.stderr.write(self.style.ERROR("Задайте TELEGRAM_BOT_TOKEN и TELEGRAM_CHAT_ID"))
            return

        text = "✅ Тестовое сообщение от генератора"
        success = telegram_utils.send_telegram_message(text)
        if success:
            self.stdout.write(self.style.SUCCESS("Отправлено успешно"))
        else:
            self.stderr.write(self.style.ERROR("Не удалось отправить. Проверьте логи (logging)."))
