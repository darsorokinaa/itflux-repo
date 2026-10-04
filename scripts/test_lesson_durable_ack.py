"""Durable lesson frames are broadcast only after the save returns.

A failed save sends save_failed and does not group_send. A second save of the
same room/variant/task/student updates the one row instead of inserting another.
"""

from __future__ import annotations

import asyncio
import json
import os
import sys

os.environ.setdefault("DJANGO_SETTINGS_MODULE", "Generator.settings")

import django

django.setup()

from django.apps import apps
from django.db import transaction

from Generator.consumers import LessonConsumer


class _Layer:
    def __init__(self) -> None:
        self.sent = []

    async def group_send(self, group, event):
        self.sent.append((group, event))


def _consumer() -> tuple[LessonConsumer, _Layer, list]:
    consumer = LessonConsumer()
    consumer.group_name = "lesson-audit"
    consumer._jwt_role = "student"
    consumer._participant_name = "Audit"
    layer = _Layer()
    consumer.channel_layer = layer
    frames = []

    async def send(text_data=None, **_kwargs):
        frames.append(json.loads(text_data))

    consumer.send = send
    return consumer, layer, frames


async def _control_flow() -> None:
    payload = {
        "type": "student_answer",
        "task_number": "1",
        "answer": "42",
        "name": "Audit",
        "client_msg_id": "op-1",
    }
    consumer, layer, frames = _consumer()

    async def fail(_normalized):
        raise RuntimeError("db down")

    consumer._save_student_answer = fail
    await consumer.receive(json.dumps(payload))
    if layer.sent:
        raise SystemExit("save failure still broadcast")
    if not frames or frames[0].get("type") != "save_failed":
        raise SystemExit(f"expected save_failed, got {frames}")
    if frames[0].get("client_msg_id") != "op-1":
        raise SystemExit("save_failed lost client_msg_id")

    frames.clear()

    async def ok(_normalized):
        return None

    consumer._save_student_answer = ok
    await consumer.receive(json.dumps(payload))
    if len(layer.sent) != 1:
        raise SystemExit(f"expected one broadcast, got {len(layer.sent)}")
    echoed = layer.sent[0][1]["payload"]
    if echoed.get("client_msg_id") != "op-1" or echoed.get("type") != "student_answer":
        raise SystemExit(f"ack payload mismatch {echoed}")
    print("control_flow ok")


def _idempotent_row() -> None:
    LessonStudentsAnswer = apps.get_model("Generator", "LessonStudentsAnswer")
    room = "audit-durable-op1"
    with transaction.atomic():
        first, created_first = LessonStudentsAnswer.objects.update_or_create(
            room_id=room,
            variant_id=0,
            task_number="1",
            student="Audit",
            defaults={"answer": "42", "payload": {"client_msg_id": "op-1"}},
        )
        second, created_second = LessonStudentsAnswer.objects.update_or_create(
            room_id=room,
            variant_id=0,
            task_number="1",
            student="Audit",
            defaults={"answer": "42", "payload": {"client_msg_id": "op-1"}},
        )
        count = LessonStudentsAnswer.objects.filter(
            room_id=room, variant_id=0, task_number="1", student="Audit"
        ).count()
        transaction.set_rollback(True)
    if not created_first or created_second or first.pk != second.pk or count != 1:
        raise SystemExit(
            f"idempotency failed created={created_first},{created_second} "
            f"pk={first.pk},{second.pk} count={count}"
        )
    print("idempotent_row ok")


if __name__ == "__main__":
    asyncio.run(_control_flow())
    if "--with-db" in sys.argv:
        _idempotent_row()
