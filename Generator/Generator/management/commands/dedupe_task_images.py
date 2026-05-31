"""
Удалить задвоенные <img> в task_template (Generator_task).

Когда импорт ФИПИ заливал в БД одновременно
  (a) текст с уже встроенным <img src="…/xs3qstsrc…png"/>
  (b) добавлял хвостом ещё один <p><img src="/media/…/xs3qstsrc…png"></p>
получался двойной рендер картинки. Эта команда чистит уже залитые записи.

Использование:
  python manage.py dedupe_task_images --dry-run     # показать, что будет
  python manage.py dedupe_task_images               # применить изменения
  python manage.py dedupe_task_images --subject math --level oge
  python manage.py dedupe_task_images --task-id 4644
"""
from __future__ import annotations

import re
from pathlib import PurePosixPath

from django.core.management.base import BaseCommand

from Generator.models import Task


_IMG_RE = re.compile(
    r"""<img\b[^>]*?\bsrc=(["'])([^"']+)\1[^>]*>""",
    re.IGNORECASE,
)


def _image_key(src: str) -> str:
    if not src:
        return ""
    s = src.strip()
    s = s.split("?", 1)[0].split("#", 1)[0]
    return PurePosixPath(s).name.lower()


def _collect_keys(html: str) -> set[str]:
    return {_image_key(src) for _q, src in _IMG_RE.findall(html or "") if src}


_P_TAIL_AFTER_IMG_RE = re.compile(
    r"""(?:\s|<br\s*/?>)*</p>""",
    re.IGNORECASE,
)
_P_HEAD_BEFORE_IMG_RE = re.compile(
    r"""<p\b[^>]*>(?:\s|<br\s*/?>)*\Z""",
    re.IGNORECASE,
)


def dedupe_html(html: str) -> tuple[str, int]:
    """Удалить повторные `<img>` (по имени файла).

    Сохраняем первое вхождение каждой картинки в документном порядке. Если
    повторный `<img>` лежит в собственном `<p>` (т.е. ничего другого в нём нет),
    удаляем `<p>…</p>` целиком, чтобы не оставалось пустых абзацев.
    """
    if not html or not isinstance(html, str):
        return html, 0

    seen: set[str] = set()
    removed = 0
    out: list[str] = []
    pos = 0

    for m in _IMG_RE.finditer(html):
        src = m.group(2) or ""
        key = _image_key(src)
        if not key or key not in seen:
            if key:
                seen.add(key)
            continue

        head = html[pos:m.start()]
        out.append(head)

        start, end = m.start(), m.end()

        # Если <img> «висит» один внутри <p>…</p>, убираем и сам абзац.
        head_match = _P_HEAD_BEFORE_IMG_RE.search(out[-1] if out else "")
        tail_match = _P_TAIL_AFTER_IMG_RE.match(html, end)

        if head_match and tail_match:
            out[-1] = out[-1][: head_match.start()]
            end = end + (tail_match.end() - tail_match.start())

        removed += 1
        pos = end

    out.append(html[pos:])
    return "".join(out), removed


class Command(BaseCommand):
    help = "Удалить задвоенные <img> в task_template (Generator_task)."

    def add_arguments(self, parser):
        parser.add_argument(
            "--dry-run",
            action="store_true",
            help="Только показать, без записи в БД",
        )
        parser.add_argument(
            "--subject",
            type=str,
            default=None,
            help="subject.subject_short (например math)",
        )
        parser.add_argument(
            "--level",
            type=str,
            default=None,
            help="level.level (например oge)",
        )
        parser.add_argument(
            "--task-id",
            type=int,
            default=None,
            help="Один Task.id, остальные фильтры игнорируются",
        )
        parser.add_argument(
            "--verbose-list",
            action="store_true",
            help="Печатать все ID изменённых задач",
        )

    def handle(self, *args, **opts):
        qs = Task.objects.all()

        if opts["task_id"]:
            qs = qs.filter(id=opts["task_id"])
        else:
            if opts["subject"]:
                qs = qs.filter(task__subject__subject_short=opts["subject"])
            if opts["level"]:
                qs = qs.filter(task__level__level=opts["level"])

        total = qs.count()
        self.stdout.write(f"Проверяю задач: {total}")

        changed = 0
        total_removed = 0
        changed_ids: list[int] = []

        for t in qs.iterator():
            html = t.task_template or ""
            keys = _collect_keys(html)
            if len(keys) == sum(1 for _ in _IMG_RE.finditer(html)):
                continue

            new_html, removed = dedupe_html(html)
            if removed <= 0 or new_html == html:
                continue

            changed += 1
            total_removed += removed
            changed_ids.append(t.id)

            if opts["verbose_list"]:
                self.stdout.write(f"  task#{t.id}: удалено {removed} <img>")

            if not opts["dry_run"]:
                t.task_template = new_html
                t.save(update_fields=["task_template"])

        action = "будет изменено" if opts["dry_run"] else "изменено"
        self.stdout.write(
            self.style.SUCCESS(
                f"\nГотово. {action}: {changed} задач, удалено повторных <img>: {total_removed}"
            )
        )
        if opts["dry_run"] and changed_ids and not opts["verbose_list"]:
            preview = ", ".join(str(i) for i in changed_ids[:20])
            more = f" (ещё {len(changed_ids) - 20})" if len(changed_ids) > 20 else ""
            self.stdout.write(f"IDs: {preview}{more}")
