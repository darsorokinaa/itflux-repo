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
        "удаление неиспользуемых files и округление точек живых штрихов до 0.01 px "
        "(version не меняется). Идемпотентно."
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
            "--all",
            action="store_true",
            help="Все доски: со --dry-run — только сводка размеров до/после",
        )
        parser.add_argument(
            "--min-bytes",
            type=int,
            default=1_000_000,
            help="Для --all: обрабатывать доски со сценой не меньше этого размера",
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
        if options.get("all"):
            self._all(options)
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

        self._write(board, scene, compacted, options)
        self.stdout.write(self.style.SUCCESS("scene compacted"))

    def _write(self, board, scene, compacted, options):
        """Пишем только если version не изменилась (нет гонки с autosave)."""
        backup_dir = options.get("backup_dir") or str(Path("Cabinet") / "board_scene_backups")
        path = Path(backup_dir)
        path.mkdir(parents=True, exist_ok=True)
        stamp = datetime.now(timezone.utc).strftime("%Y%m%dT%H%M%SZ")
        backup_path = path / f"{board.id}.{stamp}.json"
        backup_path.write_text(
            json.dumps(scene, ensure_ascii=False, separators=(",", ":")),
            encoding="utf-8",
        )
        updated = InteractiveBoard.objects.filter(pk=board.pk, version=board.version).update(
            scene_data=compacted
        )
        self.stdout.write(f"backup={backup_path} updated={updated}")
        return updated

    def _all(self, options):
        dry = bool(options.get("dry_run"))
        min_bytes = int(options.get("min_bytes") or 0)
        total_before = total_after = boards = changed_count = 0
        rows = []
        qs = InteractiveBoard.objects.only("id", "version", "scene_data")
        for board in qs.iterator(chunk_size=20):
            scene = board.scene_data if isinstance(board.scene_data, dict) else {}
            before = scene_size_stats(scene)["scene_bytes"]
            if before < min_bytes:
                continue
            compacted, changed = compact_scene_data(scene)
            after = scene_size_stats(compacted)["scene_bytes"] if changed else before
            boards += 1
            total_before += before
            total_after += after
            if changed:
                changed_count += 1
                if not dry:
                    self._write(board, scene, compacted, options)
            rows.append({"board_id": str(board.id), "before_kb": round(before / 1024), "after_kb": round(after / 1024)})
        rows.sort(key=lambda r: r["before_kb"], reverse=True)
        self.stdout.write(json.dumps({
            "dry_run": dry,
            "boards": boards,
            "changed": changed_count,
            "total_before_mb": round(total_before / 1e6, 1),
            "total_after_mb": round(total_after / 1e6, 1),
            "top": rows[:15],
        }, ensure_ascii=False))

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
