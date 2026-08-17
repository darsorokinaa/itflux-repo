"""Watchdog: протухшие LIVE-комнаты → finished. ScheduleEvent и биллинг не трогает."""

from __future__ import annotations

import json

from django.core.management.base import BaseCommand

from Cabinet.video_meeting_service import expire_stale_live_meetings


class Command(BaseCommand):
    help = (
        "Технически закрывает зависшие LIVE-видеокомнаты. "
        "По умолчанию dry-run. Не проводит занятие и не меняет биллинг. "
        "python manage.py expire_stale_live_meetings [--apply] [--json]"
    )

    def add_arguments(self, parser):
        parser.add_argument(
            "--apply",
            action="store_true",
            help="Применить закрытие комнат. Без флага только отчёт.",
        )
        parser.add_argument("--json", action="store_true", help="Печать JSON-отчёта")

    def handle(self, *args, **options):
        apply = bool(options.get("apply"))
        report = expire_stale_live_meetings(dry_run=not apply)
        if options.get("json"):
            self.stdout.write(json.dumps(report, ensure_ascii=False, indent=2, default=str))
            return
        mode = "APPLY" if apply else "DRY-RUN"
        self.stdout.write(f"expire_stale_live_meetings [{mode}]")
        self.stdout.write(f"  checked: {report['checked']}")
        self.stdout.write(f"  would_expire_or_expired: {len(report['expired'])}")
        self.stdout.write(f"  skipped: {len(report['skipped'])}")
        for row in report["expired"][:50]:
            self.stdout.write(
                f"    meeting={row['uuid']} event={row['event_id']} "
                f"event_status={row['event_status']} ends_at={row['ends_at']}"
            )
        if not apply:
            self.stdout.write("Изменения не применены. Для закрытия комнат: --apply")
        else:
            self.stdout.write(self.style.SUCCESS("Протухшие LIVE-комнаты переведены в finished."))
