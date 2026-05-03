"""
Дайджест сообщений об ошибках в Telegram.
Запуск вручную: python manage.py send_error_digest
Автоматически: cron каждый день в 09:00 МСК (06:00 UTC).

Добавить в crontab (crontab -e):
    0 6 * * * /path/to/venv/bin/python /path/to/Generator/manage.py send_error_digest >> /path/to/logs/digest.log 2>&1
"""
from django.core.management.base import BaseCommand

from Generator import telegram_utils
from Generator.models import ErrorReport


SUBJECT_LABELS = {
    "inf": "Информатика",
    "math": "Математика",
    "rus": "Русский язык",
    "phys": "Физика",
    "chem": "Химия",
    "bio": "Биология",
    "hist": "История",
    "soc": "Обществознание",
    "eng": "Английский язык",
    "geo": "География",
    "lit": "Литература",
}
LEVEL_LABELS = {"oge": "ОГЭ", "ege": "ЕГЭ"}

MAX_MSG_LEN = 4000


def _esc(s):
    return (s or "").replace("&", "&amp;").replace("<", "&lt;").replace(">", "&gt;")


class Command(BaseCommand):
    help = "Отправить дайджест сообщений об ошибках в Telegram (запускать в 09:00 МСК)"

    def add_arguments(self, parser):
        parser.add_argument(
            "--dry-run",
            action="store_true",
            help="Показать что будет отправлено, не отправляя и не помечая записи",
        )

    def handle(self, *args, **options):
        dry_run = options["dry_run"]

        reports = list(
            ErrorReport.objects.filter(digest_sent=False).order_by(
                "subject", "level", "task_number", "id"
            )
        )

        if not reports:
            self.stdout.write("Нет новых сообщений об ошибках.")
            return

        # Группируем по (subject, level)
        groups: dict[tuple, list[ErrorReport]] = {}
        for r in reports:
            key = (r.subject, r.level)
            groups.setdefault(key, []).append(r)

        sent_ids = []
        all_ok = True

        for (subject, level), items in groups.items():
            subject_label = SUBJECT_LABELS.get(subject, subject.capitalize())
            level_label = LEVEL_LABELS.get(str(level).lower(), str(level).upper())

            # Группируем по номеру задания внутри предмета+уровня
            by_task: dict[int | None, list[ErrorReport]] = {}
            for r in items:
                by_task.setdefault(r.task_number, []).append(r)

            total_reports = len(items)
            unique_tasks = len(by_task)
            header = (
                f"🐛 <b>Ошибки: {subject_label} {level_label}</b>\n"
                f"<i>Заданий: {unique_tasks}, жалоб: {total_reports}</i>\n"
            )
            lines = [header]

            for task_number, task_reports in sorted(
                by_task.items(), key=lambda x: (x[0] is None, x[0])
            ):
                count = len(task_reports)
                task_str = f"№{task_number}" if task_number else "№?"
                count_str = f" ({count} жалобы)" if count == 1 else f" ({count} жалоб)"

                # Уникальные непустые комментарии
                comments = [_esc(r.comment) for r in task_reports if r.comment.strip()]
                unique_comments = list(dict.fromkeys(comments))  # убираем дубли, сохраняем порядок

                entry_lines = [f"\n<b>Задание {task_str}</b>{count_str if count > 1 else ''}"]

                # ID задачи (обычно одно, но может быть несколько)
                task_ids = sorted({r.task_id for r in task_reports if r.task_id})
                if task_ids:
                    entry_lines.append(f"ID задачи: {', '.join(str(i) for i in task_ids)}")

                # Варианты
                variant_ids = sorted({r.variant_id for r in task_reports if r.variant_id})
                if variant_ids:
                    entry_lines.append(f"Варианты: {', '.join(str(v) for v in variant_ids)}")
                if unique_comments:
                    if len(unique_comments) == 1:
                        entry_lines.append(f"Комментарий: {unique_comments[0]}")
                    else:
                        entry_lines.append("Комментарии:")
                        for i, c in enumerate(unique_comments, 1):
                            entry_lines.append(f"  {i}. {c}")
                lines.append("\n".join(entry_lines))

            # Разбиваем на части, если текст слишком длинный для одного сообщения
            current_parts = []
            current_len = 0
            messages_to_send = []

            for chunk in lines:
                if current_len + len(chunk) + 1 > MAX_MSG_LEN and current_parts:
                    messages_to_send.append("\n".join(current_parts))
                    current_parts = [chunk]
                    current_len = len(chunk)
                else:
                    current_parts.append(chunk)
                    current_len += len(chunk) + 1

            if current_parts:
                messages_to_send.append("\n".join(current_parts))

            group_ok = True
            for msg in messages_to_send:
                if dry_run:
                    self.stdout.write("--- DRY RUN ---")
                    self.stdout.write(msg)
                    self.stdout.write("--- END ---\n")
                else:
                    ok = telegram_utils.send_telegram_message(msg)
                    if not ok:
                        self.stderr.write(
                            self.style.ERROR(
                                f"Не удалось отправить дайджест для {subject_label} {level_label}"
                            )
                        )
                        group_ok = False
                        all_ok = False
                        break

            if group_ok and not dry_run:
                sent_ids.extend(r.id for r in items)

        if sent_ids:
            updated = ErrorReport.objects.filter(id__in=sent_ids).update(digest_sent=True)
            self.stdout.write(
                self.style.SUCCESS(f"Дайджест отправлен. Помечено записей: {updated}")
            )
        elif dry_run:
            self.stdout.write(self.style.SUCCESS("Dry run завершён."))
        elif not all_ok:
            self.stderr.write(self.style.ERROR("Дайджест отправлен частично. Проверьте логи."))
