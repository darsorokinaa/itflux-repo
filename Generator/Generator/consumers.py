import json
import logging
import re
from urllib.parse import parse_qs

from channels.db import database_sync_to_async
from channels.generic.websocket import AsyncWebsocketConsumer
from django.apps import apps

from .answer_check import (
    answers_equal,
    expected_answer_for_variant_task,
    normalize_answer,
)

logger = logging.getLogger(__name__)


def _get_expected_answer_for_variant_task(variant_id: int, task_number_key: str) -> str:
    """
    Номер в UI варианта — это TaskList.task_number (банк), а не порядок VariantContent.order.
    Сначала ищем по task__task__task_number, затем fallback на order 1..N.
    Ключ ``t<task_id>`` — id строки Task в варианте (см. API варианта), для уникальности при коллизиях номеров.
    """
    return expected_answer_for_variant_task(variant_id, task_number_key=task_number_key)


def _token_from_scope(scope) -> str:
    qs = parse_qs((scope.get("query_string") or b"").decode("utf-8", errors="ignore"))
    for key in ("token", "lesson_token"):
        values = qs.get(key) or []
        if values and str(values[0]).strip():
            return str(values[0]).strip()
    headers = {
        k.decode("latin1").lower(): v.decode("latin1")
        for k, v in (scope.get("headers") or [])
        if isinstance(k, (bytes, bytearray))
    }
    auth = (headers.get("authorization") or "").strip()
    if auth.lower().startswith("bearer "):
        return auth[7:].strip()
    return (headers.get("x-lesson-token") or "").strip()


class LessonConsumer(AsyncWebsocketConsumer):
    VARIANT_PAYLOAD_KEY = "_lesson_current_variant"

    @staticmethod
    def _normalize_task_number(value):
        raw = str(value or "").strip()
        if not raw:
            return ""
        if len(raw) >= 2 and raw[0] == "t" and raw[1:].isdigit():
            return raw[:32]
        digits = re.sub(r"[^\d]+", "", raw)
        return digits or raw[:32]

    @staticmethod
    def _normalize_answer_value(value):
        return normalize_answer(value)

    async def connect(self):
        self.room_id = self.scope["url_route"]["kwargs"]["room_id"]
        self.group_name = f"lesson_{self.room_id}"
        self._participant_name = ""
        self._participant_role = ""
        self._jwt_role = ""

        token = _token_from_scope(self.scope)
        if not token:
            await self.close(code=4401)
            return
        try:
            normalized = await self._verify_and_normalize_token(token)
        except Exception:
            logger.info("lesson_ws rejected: invalid token room=%s", self.room_id)
            await self.close(code=4401)
            return

        token_room = str(normalized.get("room_id") or "").strip()
        if not token_room or token_room != str(self.room_id):
            await self.close(code=4403)
            return

        self._jwt_role = str(normalized.get("lesson_type") or "").strip().lower()
        if self._jwt_role in ("teacher", "tutor", "host"):
            self._jwt_role = "teacher"
        else:
            self._jwt_role = "student"
        self._participant_role = self._jwt_role
        self._participant_name = str(normalized.get("participant_name") or "").strip()

        if await self._is_lesson_session_closed():
            await self.accept()
            await self.send(
                text_data=json.dumps(
                    {
                        "type": "lesson_ended",
                        "reason": "session_closed",
                        "by_role": "server",
                    }
                )
            )
            await self.close(code=4001)
            return
        await self.channel_layer.group_add(self.group_name, self.channel_name)
        await self.accept()
        current_variant = await self._get_saved_variant()
        if current_variant:
            await self.send(
                text_data=json.dumps(
                    {
                        "type": "variant",
                        "variant_id": current_variant["variant_id"],
                        "level": current_variant["level"],
                        "subject": current_variant["subject"],
                    }
                )
            )

    async def disconnect(self, close_code):
        # Уведомляем остальных участников о выходе
        if self._participant_name:
            await self.channel_layer.group_send(
                self.group_name,
                {
                    "type": "lesson_message",
                    "payload": {
                        "type": "leave",
                        "name": self._participant_name,
                        "role": self._participant_role,
                    },
                },
            )
        if getattr(self, "group_name", None):
            await self.channel_layer.group_discard(self.group_name, self.channel_name)

    async def receive(self, text_data):
        try:
            data = json.loads(text_data)
        except (json.JSONDecodeError, TypeError):
            return
        if not isinstance(data, dict):
            return

        # Роль и имя — только из JWT; клиент не может стать учителем через join.
        if data.get("type") == "join":
            client_name = str(data.get("name") or "").strip()
            if client_name and not self._participant_name:
                self._participant_name = client_name[:200]
            data["name"] = self._participant_name
            data["role"] = self._participant_role

        msg_type = str(data.get("type") or "")
        teacher_only = {
            "variant",
            "lesson_end",
            "lesson_ended",
            "force_redirect",
            "teacher_control",
            "whiteboard_clear",
            "sync_follow",
        }
        if msg_type in teacher_only and self._jwt_role != "teacher":
            return

        normalized_variant = self._normalize_variant_message(data)
        if normalized_variant:
            if self._jwt_role != "teacher":
                return
            await self._save_variant(normalized_variant)
        normalized_answer = self._normalize_student_answer_message(data)
        if normalized_answer:
            try:
                await self._save_student_answer(normalized_answer)
            except Exception:
                logger.exception("lesson _save_student_answer failed (broadcast still sent)")
        await self.channel_layer.group_send(
            self.group_name,
            {"type": "lesson_message", "payload": data},
        )

    async def lesson_message(self, event):
        await self.send(text_data=json.dumps(event["payload"]))

    def _normalize_variant_message(self, payload):
        if not isinstance(payload, dict):
            return None
        if payload.get("type") != "variant":
            return None
        try:
            variant_id = int(payload.get("variant_id"))
        except (TypeError, ValueError):
            return None
        level = str(payload.get("level") or "").strip().lower()
        subject = str(payload.get("subject") or "").strip().lower()
        if variant_id <= 0 or not level or not subject:
            return None
        return {
            "variant_id": variant_id,
            "level": level,
            "subject": subject,
        }

    def _normalize_student_answer_message(self, payload):
        if not isinstance(payload, dict):
            return None
        if payload.get("type") != "student_answer":
            return None
        task_id_raw = payload.get("task_id")
        task_number = ""
        if task_id_raw is not None and str(task_id_raw).strip() != "":
            try:
                tid = int(task_id_raw)
                if tid > 0:
                    task_number = f"t{tid}"[:32]
            except (TypeError, ValueError):
                pass
        if not task_number:
            task_number = self._normalize_task_number(
                payload.get("task_number") or payload.get("task") or payload.get("number")
            )
        if not task_number:
            return None
        student = str(payload.get("name") or self._participant_name or "").strip()
        if not student:
            return None
        return {
            "task_number": task_number[:32],
            "student": student[:200],
            "answer": str(payload.get("answer") or ""),
            "payload": payload,
        }

    @database_sync_to_async
    def _verify_and_normalize_token(self, token: str) -> dict:
        from .views import normalize_lesson_jwt_payload, verify_lesson_token

        payload = verify_lesson_token(token)
        return normalize_lesson_jwt_payload(payload)

    @database_sync_to_async
    def _is_lesson_session_closed(self):
        LessonRoom = apps.get_model("Generator", "LessonRoom")
        return LessonRoom.objects.filter(
            room_id=self.room_id, lesson_ended_at__isnull=False
        ).exists()

    @database_sync_to_async
    def _get_saved_variant(self):
        LessonRoom = apps.get_model("Generator", "LessonRoom")
        room = LessonRoom.objects.filter(room_id=self.room_id).only("jwt_payload").first()
        if not room or not isinstance(room.jwt_payload, dict):
            return None
        return self._normalize_variant_message(
            {
                "type": "variant",
                **(room.jwt_payload.get(self.VARIANT_PAYLOAD_KEY) or {}),
            }
        )

    @database_sync_to_async
    def _save_variant(self, variant_payload):
        LessonRoom = apps.get_model("Generator", "LessonRoom")
        room = LessonRoom.objects.filter(room_id=self.room_id).only("id", "jwt_payload").first()
        if not room:
            return
        payload = dict(room.jwt_payload or {})
        payload[self.VARIANT_PAYLOAD_KEY] = variant_payload
        room.jwt_payload = payload
        room.save(update_fields=["jwt_payload", "updated_at"])

    @database_sync_to_async
    def _save_student_answer(self, normalized_answer):
        LessonRoom = apps.get_model("Generator", "LessonRoom")
        LessonStudentsAnswer = apps.get_model("Generator", "LessonStudentsAnswer")
        LessonStudentResult = apps.get_model("Generator", "LessonStudentResult")
        VariantContent = apps.get_model("Generator", "VariantContent")

        room = LessonRoom.objects.filter(room_id=self.room_id).only("jwt_payload").first()
        raw_payload = dict(room.jwt_payload or {}) if room and isinstance(room.jwt_payload, dict) else {}
        variant_payload = (
            raw_payload.get(self.VARIANT_PAYLOAD_KEY)
            if isinstance(raw_payload.get(self.VARIANT_PAYLOAD_KEY), dict)
            else {}
        )
        variant_id_raw = (
            variant_payload.get("variant_id")
            or raw_payload.get("variant_id")
            or raw_payload.get("variantId")
            or raw_payload.get("lesson_variant_id")
            or raw_payload.get("lessonVariantId")
            or raw_payload.get("vid")
            or raw_payload.get("variant")
            or raw_payload.get("test_variant_id")
            or raw_payload.get("testVariantId")
        )
        try:
            variant_id = int(variant_id_raw or 0)
        except (TypeError, ValueError):
            variant_id = 0
        variant_id = max(0, variant_id)

        teacher = str(
            raw_payload.get("teacher")
            or raw_payload.get("teacher_name")
            or raw_payload.get("teacherName")
            or ""
        ).strip()

        payload = dict(normalized_answer.get("payload") or {})
        payload["_saved_from"] = "lesson_ws"
        payload["_room_id"] = self.room_id
        task_number = self._normalize_task_number(normalized_answer.get("task_number"))
        student_answer = str(normalized_answer.get("answer") or "")
        normalized_student = self._normalize_answer_value(student_answer)
        is_empty = normalized_student == ""

        expected_answer = ""
        if variant_id > 0 and task_number:
            expected_answer = _get_expected_answer_for_variant_task(variant_id, task_number)
        is_correct = answers_equal(student_answer, expected_answer)

        LessonStudentsAnswer.objects.update_or_create(
            room_id=self.room_id[:200],
            variant_id=variant_id,
            task_number=task_number[:32],
            student=str(normalized_answer.get("student") or "")[:200],
            defaults={
                "teacher": teacher[:200],
                "answer": student_answer,
                "is_correct": is_correct,
                "is_empty": is_empty,
                "payload": payload,
            },
        )

        student_key = str(normalized_answer.get("student") or "")[:200]
        answers_qs = LessonStudentsAnswer.objects.filter(
            room_id=self.room_id[:200],
            variant_id=variant_id,
            student=student_key,
        )
        total_tasks = (
            VariantContent.objects.filter(variant_id=variant_id).count()
            if variant_id > 0
            else 0
        )
        if total_tasks <= 0:
            total_tasks = answers_qs.count()
        correct_count = answers_qs.filter(is_correct=True).count()
        non_empty_count = answers_qs.filter(is_empty=False).count()
        empty_count = max(total_tasks - non_empty_count, 0)
        wrong_count = max(total_tasks - correct_count, 0)

        prev = LessonStudentResult.objects.filter(
            room_id=self.room_id[:200],
            variant_id=variant_id,
            student=student_key,
        ).only("teacher_comment", "payload").first()
        teacher_comment = prev.teacher_comment if prev else ""
        prev_payload = dict(prev.payload or {}) if prev and isinstance(prev.payload, dict) else {}
        prev_payload.update(
            {
                "source": "lesson_ws_rollup",
                "last_task_number": task_number,
            }
        )

        LessonStudentResult.objects.update_or_create(
            room_id=self.room_id[:200],
            variant_id=variant_id,
            student=student_key,
            defaults={
                "teacher": teacher[:200],
                "total_tasks": total_tasks,
                "correct_count": correct_count,
                "wrong_count": wrong_count,
                "empty_count": empty_count,
                "teacher_comment": teacher_comment,
                "payload": prev_payload,
            },
        )
