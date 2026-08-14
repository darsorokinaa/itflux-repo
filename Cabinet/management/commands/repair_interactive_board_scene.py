"""Безопасное сжатие JSON сцены интерактивной доски (backup + compact)."""

from __future__ import annotations

import json
from datetime import datetime, timezone
from pathlib import Path

from django.core.management.base import BaseCommand, CommandError

from Cabinet.boards_api import compact_scene_data, scene_size_stats
from Cabinet.models import InteractiveBoard


class Command(BaseCommand):
    help = (
        "Сжимает scene_data доски: tombstones вместо геометрии удалённых элементов "
        "и удаление неиспользуемых files. Живые элементы не трогает. Идемпотентно."
    )

    def add_arguments(self, parser):
        parser.add_argument("--board-id", type=str, default=None, help="UUID InteractiveBoard")
        parser.add_argument(
            "--dry-run",
            action="store_true",
            help="Только показать статистику, не записывать",
        )
        parser.add_argument(
            "--list-oversized",
            action="store_true",
            help="Показать доски с scene > 1 МБ (без содержимого и ПДн)",
        )
        parser.add_argument(
            "--backup-dir",
            type=str,
            default="",
            help="Каталог для JSON-backup исходной сцены",
        )

    def handle(self, *args, **options):
        if options.get("list_oversized"):
            self._list_oversized()
            return
        board_id = options.get("board_id")
        if not board_id:
            raise CommandError("Укажите --board-id или --list-oversized")
        try:
            board = InteractiveBoard.objects.get(pk=board_id)
        except InteractiveBoard.DoesNotExist as exc:
            raise CommandError(f"Доска {board_id} не найдена") from exc

        scene = board.scene_data if isinstance(board.scene_data, dict) else {}
        before = scene_size_stats(scene)
        compacted, changed = compact_scene_data(scene)
        after = scene_size_stats(compacted)
        self.stdout.write(
            json.dumps(
                {
                    "board_id": str(board.id),
                    "changed": changed,
                    "before": before,
                    "after": after,
                },
                ensure_ascii=False,
            )
        )
        if options.get("dry_run") or not changed:
            return

        backup_dir = options.get("backup_dir") or str(
            Path("Cabinet") / "board_scene_backups"
        )
        path = Path(backup_dir)
        path.mkdir(parents=True, exist_ok=True)
        stamp = datetime.now(timezone.utc).strftime("%Y%m%dT%H%M%SZ")
        backup_path = path / f"{board.id}.{stamp}.json"
        backup_path.write_text(
            json.dumps(scene, ensure_ascii=False, separators=(",", ":")),
            encoding="utf-8",
        )

        board.scene_data = compacted
        board.save(update_fields=["scene_data", "updated_at"])
        self.stdout.write(f"backup={backup_path}")
        self.stdout.write(self.style.SUCCESS("scene compacted"))

    def _list_oversized(self):
        rows = []
        for board in InteractiveBoard.objects.iterator(chunk_size=50):
            scene = board.scene_data if isinstance(board.scene_data, dict) else {}
            stats = scene_size_stats(scene)
            if stats["scene_bytes"] < 1_000_000:
                continue
            rows.append(
                {
                    "board_id": str(board.id),
                    "scene_kb": round(stats["scene_bytes"] / 1024, 1),
                    "elements": stats["element_count"],
                    "deleted": stats["deleted_count"],
                    "files": stats["file_count"],
                    "unused_files": stats["unused_file_count"],
                }
            )
        rows.sort(key=lambda r: r["scene_kb"], reverse=True)
        self.stdout.write(json.dumps({"oversized": rows, "count": len(rows)}, ensure_ascii=False))
