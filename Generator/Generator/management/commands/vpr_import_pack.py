"""Импорт авторских пакетов ВПР.

Без --apply ничего не пишет. --apply кладёт неактивные задачи и файлы в закрытое
хранилище. Скрипты из архива не запускаются. Production этой командой из облака не трогаем.
"""

import json

from django.core.management.base import BaseCommand, CommandError
from django.db import transaction

from Generator.vpr_answer_spec import APPLY_READY_PACKS, dry_run_zip
from Generator.vpr_pack_import import apply_zip


class Command(BaseCommand):
    help = "Dry-run пакета ВПР. Запись только с явным --apply, задачи остаются неактивными."

    def add_arguments(self, parser):
        parser.add_argument("paths", nargs="+", help="ZIP пакетов ma7/ma8/ma10/inf7/inf8 v2")
        parser.add_argument("--apply", action="store_true", help="Записать в текущую базу. Без флага только отчёт.")
        parser.add_argument("--batch", default="", help="Метка партии для source_key и отката.")

    def handle(self, *args, **options):
        reports = [dry_run_zip(path) for path in options["paths"]]
        total = sum(item.get("count") or 0 for item in reports)
        blocked = []
        for path, report in zip(options["paths"], reports):
            for row in report.get("files") or []:
                pack = row.get("pack")
                if pack not in APPLY_READY_PACKS or row.get("obsolete") or row.get("hold"):
                    blocked.append(f"{path}: пакет {pack} не в apply-ready")
            if not report.get("ok"):
                blocked.append(f"{path}: {'; '.join(report.get('errors') or ['ошибка dry-run'])}")
        summary = {
            "applied": False,
            "count": total,
            "reports": reports,
            "blocked": blocked,
        }
        if not options["apply"]:
            self.stdout.write(json.dumps(summary, ensure_ascii=False, indent=2))
            if blocked:
                raise CommandError("dry-run не прошёл")
            return
        if blocked:
            raise CommandError("запись отклонена:\n" + "\n".join(blocked))
        batch = (options["batch"] or "").strip()
        if not batch:
            raise CommandError("для --apply нужна метка --batch")
        with transaction.atomic():
            written = [apply_zip(path, batch=batch) for path in options["paths"]]
        summary["applied"] = True
        summary["written"] = written
        summary["active"] = False
        self.stdout.write(json.dumps(summary, ensure_ascii=False, indent=2))
