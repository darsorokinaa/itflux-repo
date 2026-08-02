"""Диагностика комнат уроков, досок и сессий материалов."""

from __future__ import annotations

import json

from django.core.management.base import BaseCommand
from django.db.models import Count, Max, Q


class Command(BaseCommand):
    help = "Аудит комнат видеоуроков, интерактивных досок и material sessions (без персональных ответов)."

    def add_arguments(self, parser):
        parser.add_argument("--lesson-id", type=int, default=None, help="ID ScheduleEvent")
        parser.add_argument("--meeting-uuid", type=str, default=None, help="UUID VideoMeeting")
        parser.add_argument("--board-id", type=str, default=None, help="UUID InteractiveBoard")
        parser.add_argument("--json", action="store_true", help="Вывод в JSON")

    def handle(self, *args, **options):
        from Cabinet.models import InteractiveBoard, InteractiveBoardAsset, VideoMeeting
        from Cabinet.meeting_material_models import MeetingMaterialSession

        lesson_id = options.get("lesson_id")
        meeting_uuid = options.get("meeting_uuid")
        board_id = options.get("board_id")

        report: dict = {
            "meetings": {},
            "boards": {},
            "material_sessions": {},
            "issues": [],
        }

        meetings_qs = VideoMeeting.objects.all()
        if lesson_id:
            meetings_qs = meetings_qs.filter(schedule_event_id=lesson_id)
        if meeting_uuid:
            meetings_qs = meetings_qs.filter(uuid=meeting_uuid)

        status_counts = {
            row["status"]: row["c"]
            for row in meetings_qs.values("status").annotate(c=Count("id"))
        }
        report["meetings"] = {
            "total": meetings_qs.count(),
            "by_status": status_counts,
            "with_presented": meetings_qs.exclude(presented_kind="").exclude(presented_kind__isnull=True).count(),
            "live": meetings_qs.filter(status="live").count(),
        }

        boards_qs = InteractiveBoard.objects.all()
        if board_id:
            boards_qs = boards_qs.filter(pk=board_id)
        elif lesson_id:
            boards_qs = boards_qs.filter(
                Q(schedule_event_id=lesson_id) | Q(lesson_id=lesson_id)
            )

        board_total = boards_qs.count()
        asset_total = InteractiveBoardAsset.objects.filter(board__in=boards_qs).count()
        scene_sizes = []
        missing_files = 0
        orphan_image_elements = 0
        huge_scenes = 0
        duplicate_file_ids = 0
        empty_scenes = 0

        for board in boards_qs.iterator(chunk_size=100):
            scene = board.scene_data if isinstance(board.scene_data, dict) else {}
            elements = scene.get("elements") or []
            files = scene.get("files") or {}
            if not isinstance(elements, list):
                elements = []
            if not isinstance(files, dict):
                files = {}
            try:
                size = len(json.dumps(scene, ensure_ascii=False))
            except (TypeError, ValueError):
                size = 0
            scene_sizes.append(size)
            if size > 2_000_000:
                huge_scenes += 1
                report["issues"].append({
                    "type": "huge_scene",
                    "board_id": str(board.id),
                    "bytes": size,
                })
            if not elements and not files:
                empty_scenes += 1

            file_ids = set(str(k) for k in files.keys())
            seen_ids = set()
            for fid in files.keys():
                if fid in seen_ids:
                    duplicate_file_ids += 1
                seen_ids.add(fid)

            image_file_ids = set()
            for el in elements:
                if not isinstance(el, dict) or el.get("isDeleted"):
                    continue
                if el.get("type") != "image":
                    continue
                fid = str(el.get("fileId") or "")
                if not fid:
                    continue
                image_file_ids.add(fid)
                if fid not in file_ids:
                    orphan_image_elements += 1

            for fid in file_ids:
                meta = files.get(fid) or {}
                url = ""
                if isinstance(meta, dict):
                    url = str(meta.get("dataURL") or meta.get("url") or "")
                if not url:
                    missing_files += 1

        avg_size = int(sum(scene_sizes) / len(scene_sizes)) if scene_sizes else 0
        max_size = max(scene_sizes) if scene_sizes else 0

        report["boards"] = {
            "total": board_total,
            "assets": asset_total,
            "empty_scenes": empty_scenes,
            "huge_scenes": huge_scenes,
            "image_elements_without_files": orphan_image_elements,
            "files_without_url": missing_files,
            "duplicate_file_id_entries": duplicate_file_ids,
            "avg_scene_bytes": avg_size,
            "max_scene_bytes": max_size,
        }

        sessions_qs = MeetingMaterialSession.objects.all()
        if lesson_id:
            sessions_qs = sessions_qs.filter(meeting__schedule_event_id=lesson_id)
        if meeting_uuid:
            sessions_qs = sessions_qs.filter(meeting__uuid=meeting_uuid)

        mode_counts = {
            row["interaction_mode"]: row["c"]
            for row in sessions_qs.values("interaction_mode").annotate(c=Count("id"))
        }
        kind_counts = {
            row["resource_kind"]: row["c"]
            for row in sessions_qs.values("resource_kind").annotate(c=Count("id"))
        }
        report["material_sessions"] = {
            "total": sessions_qs.count(),
            "active": sessions_qs.filter(is_active=True).count(),
            "by_mode": mode_counts,
            "by_kind": kind_counts,
            "max_version": sessions_qs.aggregate(m=Max("version")).get("m") or 0,
        }

        # Активные channel groups недоступны надёжно без Redis inspect — помечаем best-effort.
        report["websockets"] = {
            "note": "Активные WS-группы смотрите в Redis/channels layer runtime",
        }

        if options.get("json"):
            self.stdout.write(json.dumps(report, ensure_ascii=False, indent=2))
            return

        self.stdout.write(self.style.MIGRATE_HEADING("=== Lesson rooms audit ==="))
        self.stdout.write(f"Meetings: {report['meetings']['total']} (live={report['meetings']['live']})")
        self.stdout.write(f"  by status: {report['meetings']['by_status']}")
        self.stdout.write(f"Boards: {report['boards']['total']}, assets={report['boards']['assets']}")
        self.stdout.write(
            f"  empty={report['boards']['empty_scenes']} huge={report['boards']['huge_scenes']} "
            f"orphan_images={report['boards']['image_elements_without_files']} "
            f"files_no_url={report['boards']['files_without_url']}"
        )
        self.stdout.write(
            f"  scene bytes avg={report['boards']['avg_scene_bytes']} "
            f"max={report['boards']['max_scene_bytes']}"
        )
        self.stdout.write(
            f"Material sessions: {report['material_sessions']['total']} "
            f"(active={report['material_sessions']['active']})"
        )
        self.stdout.write(f"  modes: {report['material_sessions']['by_mode']}")
        self.stdout.write(f"  kinds: {report['material_sessions']['by_kind']}")
        if report["issues"]:
            self.stdout.write(self.style.WARNING(f"Issues: {len(report['issues'])}"))
            for issue in report["issues"][:30]:
                self.stdout.write(f"  - {issue['type']}: board={issue.get('board_id')} bytes={issue.get('bytes')}")
        else:
            self.stdout.write(self.style.SUCCESS("No critical scene issues flagged."))
