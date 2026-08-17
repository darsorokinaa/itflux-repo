"""Read-only: ассеты доски, на которые не ссылается текущая scene."""

from __future__ import annotations

import json
import re
from pathlib import Path

from django.core.management.base import BaseCommand
from django.utils import timezone

from Cabinet.models import InteractiveBoard, InteractiveBoardAsset

ASSET_URL_RE = re.compile(
    r"/api/cabinet/interactive-boards/"
    r"(?P<board_id>[0-9a-f-]{36})/assets/(?P<asset_id>[0-9a-f-]{36})/?",
    re.I,
)


class Command(BaseCommand):
    help = (
        "Отчёт по используемым и orphan-ассетам досок. Только чтение. "
        "python manage.py audit_board_assets [--output=board-assets.json]"
    )

    def add_arguments(self, parser):
        parser.add_argument("--output", type=str, default="", help="Путь к JSON-отчёту")

    def handle(self, *args, **options):
        report = self._build_report()
        self._print_summary(report)
        output = (options.get("output") or "").strip()
        if output:
            path = Path(output)
            path.write_text(
                json.dumps(report, ensure_ascii=False, indent=2, default=str),
                encoding="utf-8",
            )
            self.stdout.write(self.style.SUCCESS(f"Отчёт сохранён: {path}"))

    def _build_report(self) -> dict:
        boards = []
        orphan_total = 0
        used_total = 0
        asset_total = InteractiveBoardAsset.objects.count()
        for board in InteractiveBoard.objects.all().iterator(chunk_size=50):
            scene = board.scene_data if isinstance(board.scene_data, dict) else {}
            files = scene.get("files") if isinstance(scene.get("files"), dict) else {}
            referenced = _referenced_asset_ids(files)
            board_assets = list(
                InteractiveBoardAsset.objects.filter(board=board).values("id", "original_name", "size_bytes")
            )
            used = [row for row in board_assets if str(row["id"]) in referenced]
            orphans = [row for row in board_assets if str(row["id"]) not in referenced]
            used_total += len(used)
            orphan_total += len(orphans)
            if orphans or len(board_assets) > 50:
                boards.append({
                    "board_id": str(board.id),
                    "title": board.title,
                    "scene_files": len(files),
                    "assets": len(board_assets),
                    "used_assets": len(used),
                    "orphan_assets": len(orphans),
                })
        boards.sort(key=lambda row: row["orphan_assets"], reverse=True)
        return {
            "generated_at": timezone.now().isoformat(),
            "boards_total": InteractiveBoard.objects.count(),
            "assets_total": asset_total,
            "used_assets": used_total,
            "orphan_assets": orphan_total,
            "boards_with_orphans_or_heavy": boards[:100],
            "note": "Только чтение. Удаление ассетов не выполняется. Для cleanup нужен отдельный флаг.",
        }

    def _print_summary(self, report: dict) -> None:
        self.stdout.write("Аудит ассетов досок (данные не изменены)")
        self.stdout.write(f"  boards_total: {report['boards_total']}")
        self.stdout.write(f"  assets_total: {report['assets_total']}")
        self.stdout.write(f"  used_assets: {report['used_assets']}")
        self.stdout.write(f"  orphan_assets: {report['orphan_assets']}")
        for row in (report.get("boards_with_orphans_or_heavy") or [])[:15]:
            self.stdout.write(
                f"    board={row['board_id']} files={row['scene_files']} "
                f"assets={row['assets']} used={row['used_assets']} orphan={row['orphan_assets']}"
            )
        self.stdout.write("Repair не запускался.")


def _referenced_asset_ids(files: dict) -> set[str]:
    found = set()
    for meta in files.values():
        if not isinstance(meta, dict):
            continue
        data_url = str(meta.get("dataURL") or meta.get("url") or "")
        match = ASSET_URL_RE.search(data_url)
        if match:
            found.add(match.group("asset_id"))
    return found
