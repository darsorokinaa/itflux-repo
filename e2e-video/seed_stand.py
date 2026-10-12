"""Создаёт только тестовых пользователей и одно занятие в itflux_video_e2e."""

import json
import os
import sys
from datetime import timedelta
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
RUN = Path(__file__).resolve().parent / ".run"
os.environ.setdefault("DJANGO_SETTINGS_MODULE", "stand_settings")

import django

django.setup()

from django.conf import settings
from django.contrib.auth.models import User
from django.db import connection
from django.utils import timezone

from Cabinet.livekit_service import decode_livekit_jwt, generate_livekit_jwt, livekit_is_configured
from Cabinet.models import InteractiveBoard, Profile, ScheduleEvent, Student, VideoMeeting
from Cabinet.schedule_service import create_single_event
from Cabinet.video_meeting_service import get_or_create_meeting_for_event, start_meeting

E2E_DB = "itflux_video_e2e"
TEACHER_USERNAME = "video-e2e-teacher"
STUDENT_USERNAME = "video-e2e-student"
TITLE = "Стенд видеосвязи"


def assert_database():
    name = settings.DATABASES["default"]["NAME"]
    if name != E2E_DB:
        raise SystemExit(f"refusing settings database {name}")
    with connection.cursor() as cursor:
        cursor.execute("SELECT current_database()")
        current = cursor.fetchone()[0]
    if current != E2E_DB:
        raise SystemExit(f"refusing connected database {current}")
    return current


def ensure_user(username, role, name, surname):
    user = User.objects.filter(username=username).first()
    created = user is None
    if user is None:
        user = User.objects.create_user(
            username=username,
            password=os.environ["E2E_PASSWORD"],
            email=f"{username}@example.test",
        )
    else:
        user.set_password(os.environ["E2E_PASSWORD"])
        user.email = f"{username}@example.test"
        user.save(update_fields=["password", "email"])
    Profile.objects.filter(user=user).update(
        role=role,
        name=name,
        surname=surname,
        account_active=True,
        account_blocked=False,
    )
    return user, created


def main():
    current = assert_database()
    teacher, teacher_created = ensure_user(
        TEACHER_USERNAME, Profile.Role.TEACHER, "Стенд", "Преподаватель",
    )
    student_user, student_created = ensure_user(
        STUDENT_USERNAME, Profile.Role.STUDENT, "Стенд", "Ученик",
    )
    student, _ = Student.objects.get_or_create(
        teacher=teacher,
        user=student_user,
        defaults={
            "first_name": "Стенд",
            "last_name": "Ученик",
            "status": "active",
        },
    )
    now = timezone.now()
    event = (
        ScheduleEvent.objects.filter(owner=teacher, title=TITLE)
        .exclude(status__in=[ScheduleEvent.Status.CANCELLED, ScheduleEvent.Status.DONE, ScheduleEvent.Status.COMPLETED])
        .order_by("-id")
        .first()
    )
    if event is None:
        event = create_single_event(
            teacher=teacher,
            data={
                "title": TITLE,
                "starts_at": now - timedelta(minutes=5),
                "ends_at": now + timedelta(minutes=55),
                "event_type": "individual_lesson",
                "format": "online",
                "notify_participants": False,
            },
            student_ids=[student.pk],
            notify=False,
        )
    meeting, _created = get_or_create_meeting_for_event(event=event, created_by=teacher)
    meeting = start_meeting(meeting=meeting, user=teacher)
    board, _board_created = InteractiveBoard.objects.get_or_create(
        owner=teacher,
        schedule_event=event,
        defaults={"title": "Доска стенда", "student": student},
    )
    # Доску не показываем сразу: звонок должен быть виден, показ открывает проверка.
    claims = {}
    if livekit_is_configured():
        for label, user, moderator in (
            ("teacher", teacher, True),
            ("student", student_user, False),
        ):
            token = generate_livekit_jwt(
                room_name=meeting.room_name,
                user=user,
                is_moderator=moderator,
            )
            video = decode_livekit_jwt(token)["video"]
            claims[label] = {
                "canPublishData": bool(video.get("canPublishData")),
                "roomAdmin": bool(video.get("roomAdmin")),
                "roomMatches": video.get("room") == meeting.room_name,
            }
            del token
    foreign = User.objects.exclude(username__in=[TEACHER_USERNAME, STUDENT_USERNAME]).count()
    state = {
        "database": current,
        "meetingUuid": str(meeting.uuid),
        "meetingStatus": meeting.status,
        "roomSuffix": meeting.room_name[-8:],
        "boardId": str(board.id),
        "teacher": TEACHER_USERNAME,
        "student": STUDENT_USERNAME,
        "teacherCreated": teacher_created,
        "studentCreated": student_created,
        "otherUsers": foreign,
        "livekitConfigured": livekit_is_configured(),
        "claims": claims,
        "baseUrl": "http://127.0.0.1:5011",
    }
    RUN.mkdir(parents=True, exist_ok=True)
    (RUN / "state.json").write_text(json.dumps(state, ensure_ascii=False, indent=2), encoding="utf-8")
    print(json.dumps({
        "database": current,
        "meetingStatus": meeting.status,
        "livekitConfigured": state["livekitConfigured"],
        "claims": claims,
        "otherUsers": foreign,
    }, ensure_ascii=False))


if __name__ == "__main__":
    try:
        main()
    except Exception as exc:
        print(f"seed failed: {type(exc).__name__}: {exc}", file=sys.stderr)
        raise
