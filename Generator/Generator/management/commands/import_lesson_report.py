# -*- coding: utf-8 -*-
"""Встроить методический отчёт после варианта в HTML каталожного урока (r79).

    manage.py import_lesson_report [файлы.report.json ...] [--dry-run] [--remove] [--json]

Без файлов берутся все Generator/Generator/lesson_report/content/*.report.json.
Идемпотентно: повторный запуск с тем же контентом ничего не меняет.
При изменении HTML пишется НОВЫЙ файл (lessons/files/<uuid>.html), Lesson.file
переключается на него под блокировкой строки; старый файл не удаляется (откат —
вернуть прежнее имя файла или запустить с --remove).
"""
from __future__ import annotations

import json
from pathlib import Path

from django.core.files.base import ContentFile
from django.core.management.base import BaseCommand, CommandError
from django.db import transaction

from Generator.models import Lesson, lesson_file_upload_to
from Generator.lesson_report import embed


class Command(BaseCommand):
    help = "Встроить отчёт после варианта (LESSON_DATA.report) в HTML каталожных уроков"

    def add_arguments(self, parser):
        parser.add_argument("paths", nargs="*", help="Файлы <slug>.report.json (по умолчанию — встроенные в репозиторий)")
        parser.add_argument("--dry-run", action="store_true", help="Только проверить и показать изменения")
        parser.add_argument("--remove", action="store_true", help="Убрать отчёт и хук из урока (откат)")
        parser.add_argument("--json", action="store_true", help="Итог в JSON")

    def handle(self, *args, **opts):
        paths = [Path(p) for p in opts["paths"]] or embed.bundled_reports()
        if not paths:
            raise CommandError("Нет файлов отчёта")
        dry = opts["dry_run"]
        summary = []
        failed = False
        for path in paths:
            item = {"file": str(path), "dry_run": dry}
            summary.append(item)
            try:
                self._one(path, item, dry=dry, remove=opts["remove"])
            except (embed.LessonReportError, Lesson.DoesNotExist, OSError, json.JSONDecodeError) as exc:
                item["status"] = "error"
                item["error"] = str(exc) if not isinstance(exc, Lesson.DoesNotExist) else "урок не найден"
                failed = True
            self._print(item, as_json=opts["json"])
        if opts["json"]:
            self.stdout.write(json.dumps(summary, ensure_ascii=False, indent=1))
        if failed:
            raise CommandError("Есть ошибки — ничего не записано для этих уроков")

    def _one(self, path: Path, item: dict, *, dry: bool, remove: bool):
        report = json.loads(path.read_text(encoding="utf-8"))
        v = embed.validate_report(report)
        if not v.ok:
            raise embed.LessonReportError("формат: " + "; ".join(v.errors[:20]))
        slug = report["lesson_slug"]
        item["slug"] = slug
        item["content_version"] = report.get("content_version")
        lesson = Lesson.objects.get(slug=slug)
        item["lesson_id"] = lesson.pk
        if not lesson.file:
            raise embed.LessonReportError("у урока нет одиночного HTML (Lesson.file); архивы пока не поддерживаются")
        old_name = lesson.file.name
        with lesson.file.storage.open(old_name, "rb") as f:
            old_html = embed.decode_html(f.read())
        data = embed.extract_lesson_data(old_html)
        cc = embed.cross_check(report, data, slug=slug)
        item["warnings"] = cc.warnings
        if not cc.ok:
            raise embed.LessonReportError("сверка с уроком: " + "; ".join(cc.errors[:20]))
        new_html = embed.strip_report(old_html) if remove else embed.embed_report(old_html, report)
        if not remove:
            # самопроверка: результат разбирается, отчёт откатывается к исходному HTML
            embed.extract_lesson_data(new_html)
            if embed.strip_report(new_html) != embed.strip_report(old_html):
                raise embed.LessonReportError("самопроверка: strip(new) != strip(old)")
        item.update(embed.describe_change(old_html, new_html))
        item["file_before"] = old_name
        if not item["changed"]:
            item["status"] = "unchanged"
            return
        if dry:
            item["status"] = "would_change"
            return
        with transaction.atomic():
            locked = Lesson.objects.select_for_update().get(pk=lesson.pk)
            if locked.file.name != old_name:
                raise embed.LessonReportError("Lesson.file изменился во время работы — повторите")
            with locked.file.storage.open(old_name, "rb") as f:
                if embed.decode_html(f.read()) != old_html:
                    raise embed.LessonReportError("HTML урока изменился во время работы — повторите")
            storage = locked.file.storage
            new_name = storage.save(lesson_file_upload_to(locked, "lesson.html"), ContentFile(new_html.encode("utf-8")))
            locked.file.name = new_name
            locked.save(update_fields=["file", "updated_at"])
        item["file_after"] = new_name
        item["status"] = "changed"

    def _print(self, item: dict, *, as_json: bool):
        if as_json:
            return
        st = item.get("status")
        head = f"[{st}] {item.get('slug') or item['file']}"
        if st == "error":
            self.stderr.write(head + ": " + item.get("error", ""))
            return
        self.stdout.write(head + f" (lesson {item.get('lesson_id')}, content_version {item.get('content_version')})")
        self.stdout.write(
            f"  файл: {item.get('file_before')} -> {item.get('file_after', '(новый файл)' if st == 'would_change' else 'без изменений')}"
        )
        self.stdout.write(
            f"  хук renderResults: {item.get('hook_before')} -> {item.get('hook_after')}; "
            f"отчёт: {item.get('report_before')} -> {item.get('report_after')}"
        )
        self.stdout.write(f"  размер: {item.get('bytes_before')} -> {item.get('bytes_after')} байт; sha {item.get('sha_before')} -> {item.get('sha_after')}")
        for w in item.get("warnings") or []:
            self.stdout.write(f"  предупреждение: {w}")
