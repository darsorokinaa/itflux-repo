"""Разовые окна Б и В (+ догоняющие окна А для получивших r62 N1) и одно письмо группы Б.

Идемпотентно: повторный запуск ничего не дублирует.
  manage.py send_oneshot_popups --dry-run   # только числа, без записи в БД и без писем
  manage.py send_oneshot_popups             # после migrate
"""

from django.core.management.base import BaseCommand

from Cabinet import oneshot_popups


class Command(BaseCommand):
    help = "Разовые окна в кабинете (В > Б > А) и одно письмо Б; --dry-run — без изменений"

    def add_arguments(self, parser):
        parser.add_argument("--dry-run", action="store_true")
        parser.add_argument("--retry-failed", action="store_true", help="повторить письмо Б, если прошлая отправка упала")

    def handle(self, *args, **opts):
        res = oneshot_popups.run(dry_run=opts["dry_run"], retry_failed=opts["retry_failed"])
        self.stdout.write(
            f"oneshot now={res['now_msk']} dry_run={res['dry_run']} table_ready={res['table_ready']} "
            f"stats={res['stats']} a_by_horizon={res['a_by_horizon']}"
        )
