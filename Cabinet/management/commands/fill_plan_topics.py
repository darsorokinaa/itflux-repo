import json
from datetime import datetime, timezone as dt_tz

from django.core.management.base import BaseCommand

from Cabinet.plan_autolink import reflow_all


class Command(BaseCommand):
    help = "Reflow: темы плана по порядку для будущих автоуроков и уроков без темы (идемпотентно, без уведомлений). r42/r43"

    def add_arguments(self, parser):
        parser.add_argument("--dry-run", action="store_true")
        parser.add_argument("--teacher", type=int)
        parser.add_argument("--log", help="Дописать изменения в JSON-файл")

    def handle(self, *args, **opts):
        changes = reflow_all(teacher_id=opts.get("teacher"), dry_run=opts["dry_run"])
        if opts.get("log") and changes and not opts["dry_run"]:
            try:
                with open(opts["log"]) as fh:
                    data = json.load(fh)
            except (OSError, ValueError):
                data = []
            stamp = datetime.now(dt_tz.utc).isoformat()
            data.extend({**c, "logged_at": stamp} for c in changes)
            with open(opts["log"], "w") as fh:
                json.dump(data, fh, ensure_ascii=False, indent=1)
        by_teacher = {}
        for c in changes:
            by_teacher[c["teacher_id"]] = by_teacher.get(c["teacher_id"], 0) + 1
        self.stdout.write(json.dumps({
            "dry_run": opts["dry_run"], "changed": len(changes), "by_teacher": by_teacher,
            "non_auto_linked_changed": sum(1 for c in changes if c["from_item"] and not c["auto"]),
        }))
        if opts["dry_run"] and opts["verbosity"] > 1:
            for c in changes:
                self.stdout.write(json.dumps(c, ensure_ascii=False))
