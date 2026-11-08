"""Импорт авторских пакетов ВПР.

Без --apply ничего не пишет. --apply кладёт неактивные задачи и файлы в закрытое
хранилище. Скрипты из архива не запускаются. Production этой командой из облака не трогаем.
После активации партию можно только выключить (--deactivate-batch), не удалить.
"""

import json

from django.core.management.base import BaseCommand, CommandError
from django.db import transaction

from Generator.vpr_answer_spec import APPLY_READY_PACKS, dry_run_zip
from Generator.vpr_pack_import import activate_batch, apply_zip, deactivate_batch, rollback_batch


class Command(BaseCommand):
    help = "Dry-run пакета ВПР. Запись только с явным --apply, задачи остаются неактивными."

    def add_arguments(self, parser):
        parser.add_argument("paths", nargs="*", help="ZIP пакетов ma7/ma8/ma10/inf7/inf8 v2")
        parser.add_argument("--apply", action="store_true", help="Записать неактивные задачи. Без флага только отчёт.")
        parser.add_argument("--batch", default="", help="Метка партии для source_key, активации и отката.")
        parser.add_argument("--activate-batch", default="", help="Сделать активными только задачи этой партии.")
        parser.add_argument(
            "--deactivate-batch",
            default="",
            help="Выключить партию, не удаляя задачи и файлы. Это единственный обратный шаг после активации.",
        )
        parser.add_argument(
            "--rollback-batch",
            default="",
            help="Удалить черновик партии, который ещё не активировали и никуда не включили.",
        )

    def handle(self, *args, **options):
        if self._run_batch_command(options):
            return
        if not options["paths"]:
            raise CommandError("нужен хотя бы один zip либо --activate-batch/--deactivate-batch/--rollback-batch")
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

    def _run_batch_command(self, options) -> bool:
        activate = (options.get("activate_batch") or "").strip()
        deactivate = (options.get("deactivate_batch") or "").strip()
        rollback = (options.get("rollback_batch") or "").strip()
        chosen = [name for name in (activate, deactivate, rollback) if name]
        if not chosen:
            return False
        if len(chosen) > 1:
            raise CommandError("нужна одна операция: активация, деактивация или откат")
        if options["paths"] or options["apply"]:
            raise CommandError("активация, деактивация и откат не принимают архивы и --apply")
        try:
            result = _batch_result(activate, deactivate, rollback)
        except RuntimeError as exc:
            raise CommandError(str(exc)) from exc
        self.stdout.write(json.dumps(result, ensure_ascii=False, indent=2))
        return True


def _batch_result(activate: str, deactivate: str, rollback: str) -> dict:
    if activate:
        return activate_batch(activate)
    if deactivate:
        return deactivate_batch(deactivate)
    return rollback_batch(rollback)
