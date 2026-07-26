"""Создать/обновить материал «История развития информатики» из ZIP или папки."""

from __future__ import annotations

import tempfile
import zipfile
from pathlib import Path

from django.core.files import File
from django.core.management.base import BaseCommand, CommandError

from Generator.models import InterestingItem

DEFAULT_TITLE = "История развития информатики"
DEFAULT_SLUG = "history-map"
DEFAULT_DESCRIPTION = (
    "Интерактивная карта: от первых вычислительных идей до цифровой эпохи. "
    "Путешествие по ключевым этапам, людям и местам."
)


def _repo_root() -> Path:
    return Path(__file__).resolve().parents[4]


def _default_source_dir() -> Path:
    return _repo_root() / "frontend" / "public" / "interesting" / "history-map"


def _zip_directory(source_dir: Path, zip_path: Path) -> None:
    with zipfile.ZipFile(zip_path, "w", compression=zipfile.ZIP_DEFLATED) as zf:
        for path in sorted(source_dir.rglob("*")):
            if not path.is_file():
                continue
            if path.name.startswith("._") or "__MACOSX" in path.parts:
                continue
            arcname = Path("history-map") / path.relative_to(source_dir)
            zf.write(path, arcname.as_posix())


class Command(BaseCommand):
    help = "Сидирует интерактив history-map в раздел «Интересное»"

    def add_arguments(self, parser):
        parser.add_argument(
            "--zip",
            dest="zip_path",
            default="",
            help="Путь к готовому ZIP (иначе соберём из папки public/interesting/history-map)",
        )
        parser.add_argument(
            "--dir",
            dest="source_dir",
            default="",
            help="Папка с интерактивом для упаковки в ZIP",
        )
        parser.add_argument(
            "--publish",
            action="store_true",
            help="Сразу опубликовать материал",
        )

    def handle(self, *args, **options):
        zip_arg = (options.get("zip_path") or "").strip()
        dir_arg = (options.get("source_dir") or "").strip()
        publish = bool(options.get("publish"))

        temp_zip = None
        try:
            if zip_arg:
                zip_path = Path(zip_arg).expanduser().resolve()
                if not zip_path.is_file():
                    raise CommandError(f"ZIP не найден: {zip_path}")
            else:
                source_dir = Path(dir_arg).expanduser().resolve() if dir_arg else _default_source_dir()
                if not source_dir.is_dir() or not (source_dir / "index.html").is_file():
                    raise CommandError(
                        "Не найдена папка с index.html. "
                        f"Ожидалась: {source_dir}"
                    )
                temp_zip = tempfile.NamedTemporaryFile(suffix=".zip", delete=False)
                temp_zip.close()
                zip_path = Path(temp_zip.name)
                self.stdout.write(f"Упаковываю {source_dir} → ZIP…")
                _zip_directory(source_dir, zip_path)

            item, created = InterestingItem.objects.get_or_create(
                slug=DEFAULT_SLUG,
                defaults={
                    "title": DEFAULT_TITLE,
                    "short_description": DEFAULT_DESCRIPTION,
                    "tag": "Интерактив",
                    "accent_color": "#1F3A8A",
                    "sort_order": 0,
                    "status": (
                        InterestingItem.Status.PUBLISHED
                        if publish
                        else InterestingItem.Status.DRAFT
                    ),
                },
            )

            with zip_path.open("rb") as fh:
                item.archive.save("history-map.zip", File(fh), save=False)

            item.title = DEFAULT_TITLE
            item.short_description = DEFAULT_DESCRIPTION
            item.tag = item.tag or "Интерактив"
            item.accent_color = item.accent_color or "#1F3A8A"
            if publish:
                item.status = InterestingItem.Status.PUBLISHED
            item.save()

            action = "создан" if created else "обновлён"
            self.stdout.write(
                self.style.SUCCESS(
                    f"InterestingItem «{item.title}» {action} (slug={item.slug}, status={item.status})"
                )
            )
        finally:
            if temp_zip is not None:
                Path(temp_zip.name).unlink(missing_ok=True)
