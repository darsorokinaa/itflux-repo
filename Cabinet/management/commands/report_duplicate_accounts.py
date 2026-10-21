"""r91: отчёт (только чтение) о вероятных дублях учеников, созданных через Яндекс/VK.

python manage.py report_duplicate_accounts [--json]
Персональные данные маскируются: инициалы и email вида ni***@gmail.com.
"""
import json

from django.core.management.base import BaseCommand

from Cabinet.r91_duplicates import find_duplicates


class Command(BaseCommand):
    help = "Вероятные дубли аккаунтов учеников (OAuth, пустые). Ничего не меняет."

    def add_arguments(self, parser):
        parser.add_argument("--json", action="store_true")

    def handle(self, *args, **opts):
        rows = find_duplicates()
        if opts["json"]:
            self.stdout.write(json.dumps(rows, default=str, ensure_ascii=False, indent=1))
            return
        if not rows:
            self.stdout.write("Вероятных дублей не найдено.")
            return
        self.stdout.write(f"Найдено вероятных дублей: {len(rows)}")
        for r in rows:
            self.stdout.write(
                f"dup user={r['dup_id']} {r['dup_initials']} created={r['dup_created']:%Y-%m-%d %H:%M} "
                f"email={r['dup_email'] or '—'} role={r['dup_role']} via={','.join(r['dup_providers'])} "
                f"last_login={r['dup_last_login'] and r['dup_last_login'].strftime('%Y-%m-%d %H:%M')} "
                f"-> existing user={r['orig_id']} email={r['orig_email'] or '—'} role={r['orig_role']} "
                f"student_records={r['orig_student_ids']}"
            )
