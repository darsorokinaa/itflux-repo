"""python manage.py audit_jitsi_health — READ-ONLY диагностика Jitsi."""

from __future__ import annotations

import json

from django.core.management.base import BaseCommand

from Cabinet.jitsi_health import collect_host_snapshot, diagnose, format_report, inspect_settings


class Command(BaseCommand):
    help = (
        "READ-ONLY аудит Jitsi: domain/JWT (без секретов), systemd, Docker leftover, "
        "кто слушает UDP 10000, advertised IP. Ничего не перезапускает."
    )

    def add_arguments(self, parser):
        parser.add_argument("--json", action="store_true", help="Печать JSON-отчёта")

    def handle(self, *args, **options):
        cfg = inspect_settings()
        snapshot = collect_host_snapshot()
        report = diagnose(snapshot, cfg)
        if options.get("json"):
            self.stdout.write(json.dumps(report, ensure_ascii=False, indent=2, default=str))
            return
        text = format_report(report)
        style = {
            "OK": self.style.SUCCESS,
            "WARNING": self.style.WARNING,
            "CRITICAL": self.style.ERROR,
        }.get(report.get("overall"), self.style.NOTICE)
        self.stdout.write(style(text))
        self.stdout.write("Автоматических restart нет.")
