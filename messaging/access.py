"""Кто кому может написать. Роль берётся из профиля в БД, не из запроса."""

from __future__ import annotations

from datetime import timedelta

from django.contrib.auth.models import User
from django.db.models import Q
from django.utils import timezone

from Cabinet.choices import StudentStatus
from Cabinet.models import Student, StudentSubject
from Cabinet.plan_subjects import LEGACY_SUBJECT_LABELS

# Новое сообщение — только активная связь. Пауза и архив оставляют чтение истории.
WRITE_STATUSES = (StudentStatus.ACTIVE,)
HISTORY_STATUSES = (StudentStatus.ACTIVE, StudentStatus.PAUSED, StudentStatus.ARCHIVED)
LINKED_STATUSES = WRITE_STATUSES
ONLINE_WINDOW = timedelta(minutes=3)
RECENT_WINDOW = timedelta(hours=24)


def profile_of(user):
    profile = getattr(user, "profile", None)
    if profile is not None:
        return profile
    try:
        return user.profile
    except Exception:
        return None


def role_of(user) -> str:
    profile = profile_of(user)
    if profile is None or profile.account_blocked or not profile.account_active:
        return ""
    return profile.role or ""


def display_name_of(user) -> str:
    profile = profile_of(user)
    if profile is not None:
        label = profile.get_display_name()
        if label:
            return label
    full = user.get_full_name().strip()
    return full or user.username


def initials_of(name: str) -> str:
    parts = [part for part in (name or "").replace(".", " ").split() if part]
    if not parts:
        return "•"
    if len(parts) == 1:
        return parts[0][:1].upper()
    return (parts[0][:1] + parts[1][:1]).upper()


def presence_of(user) -> str:
    profile = profile_of(user)
    if profile is None or not profile.last_activity:
        return ""
    delta = timezone.now() - profile.last_activity
    if delta <= ONLINE_WINDOW:
        return "online"
    if delta <= RECENT_WINDOW:
        return "recent"
    return ""


def pair_key(user_a_id: int, user_b_id: int) -> str:
    left, right = sorted((int(user_a_id), int(user_b_id)))
    return f"{left}:{right}"


def _link_statuses(teacher, student_user) -> set[str]:
    return set(
        Student.objects.filter(teacher=teacher, user=student_user).values_list("status", flat=True)
    )


def _student_link_statuses(actor, target) -> set[str] | None:
    actor_role = role_of(actor)
    target_role = role_of(target)
    if actor_role == "teacher" and target_role == "student":
        return _link_statuses(actor, target)
    if actor_role == "student" and target_role == "teacher":
        return _link_statuses(target, actor)
    return None


def can_direct_message(actor, target) -> bool:
    """Новое личное сообщение: teacher↔teacher или активная строка Student."""
    if actor is None or target is None or actor.pk == target.pk:
        return False
    actor_role = role_of(actor)
    target_role = role_of(target)
    if not actor_role or not target_role:
        return False
    if actor_role == "teacher" and target_role == "teacher":
        return True
    statuses = _student_link_statuses(actor, target)
    if statuses is None:
        return False
    return bool(statuses.intersection(WRITE_STATUSES))


def can_read_direct_history(actor, target) -> bool:
    """История остаётся при паузе и архиве. Удаление — только retention."""
    if actor is None or target is None or actor.pk == target.pk:
        return False
    actor_role = role_of(actor)
    target_role = role_of(target)
    if not actor_role or not target_role:
        return False
    if actor_role == "teacher" and target_role == "teacher":
        return True
    statuses = _student_link_statuses(actor, target)
    if statuses is None:
        return False
    return bool(statuses.intersection(HISTORY_STATUSES))


def _subject_label(code: str, title: str = "") -> str:
    if title:
        return title
    return LEGACY_SUBJECT_LABELS.get((code or "").strip().lower(), "")


def teacher_subject_line(teacher, student_user=None) -> str:
    subjects = StudentSubject.objects.filter(status="active")
    if student_user is not None:
        scoped = subjects.filter(student__teacher=teacher, student__user=student_user)
    else:
        scoped = subjects.filter(student__teacher=teacher)
    row = scoped.order_by("id").first()
    if row is None:
        return "Преподаватель"
    label = _subject_label(row.subject, row.title)
    if label:
        return f"Преподаватель · {label}"
    return "Преподаватель"


def student_line(teacher, student_user) -> str:
    roster = Student.objects.filter(teacher=teacher, user=student_user).first()
    if roster is None:
        return "Ученик"
    if roster.grade:
        return f"Ваш ученик · {roster.grade} класс"
    return "Ваш ученик"


def student_display_name(teacher, student_user) -> str:
    roster = (
        Student.objects.filter(teacher=teacher, user=student_user)
        .select_related("user__profile")
        .first()
    )
    profile = profile_of(student_user)
    if profile is not None and (profile.display_name or profile.name or profile.surname):
        return profile.get_display_name()
    if roster is not None:
        roster_name = f"{roster.first_name} {roster.last_name}".strip()
        if roster_name:
            return roster_name
    return display_name_of(student_user)


def peer_section(viewer_role: str, peer_role: str) -> str:
    if peer_role == "student" and viewer_role == "teacher":
        return "students"
    return "teachers"


def _contact_payload(viewer, person, *, conversation_id=None) -> dict:
    viewer_role = role_of(viewer)
    peer_role = role_of(person)
    if viewer_role == "teacher" and peer_role == "student":
        name = student_display_name(viewer, person)
        subtitle = student_line(viewer, person)
    elif peer_role == "teacher":
        name = display_name_of(person)
        student_user = viewer if viewer_role == "student" else None
        subtitle = teacher_subject_line(person, student_user)
    else:
        name = display_name_of(person)
        subtitle = ""
    payload = {
        "user_id": person.id,
        "name": name,
        "role": peer_role,
        "section": peer_section(viewer_role, peer_role),
        "subtitle": subtitle,
        "initials": initials_of(name),
        "presence": presence_of(person),
        "conversation_id": str(conversation_id) if conversation_id else None,
    }
    if peer_role == "teacher":
        payload["login"] = person.username
        payload["email"] = person.email or ""
    return payload


def _matches(query: str, *parts: str) -> bool:
    needle = (query or "").strip().casefold()
    if not needle:
        return True
    haystack = " ".join(part for part in parts if part).casefold()
    return needle in haystack


def search_contacts(viewer, query: str = "", limit: int = 30) -> list[dict]:
    """Только люди, которым viewer реально может написать. Чужие ученики не попадают."""
    from .models import Conversation

    viewer_role = role_of(viewer)
    if viewer_role not in {"teacher", "student"}:
        return []
    needle = (query or "").strip()
    direct_ids = {
        row.pair_key: row.id
        for row in Conversation.objects.filter(kind=Conversation.Kind.DIRECT).filter(
            Q(pair_key__startswith=f"{viewer.id}:") | Q(pair_key__endswith=f":{viewer.id}")
        )
    }

    def existing_id(person_id: int):
        return direct_ids.get(pair_key(viewer.id, person_id))

    people: list[User] = []
    if viewer_role == "teacher":
        students = Student.objects.filter(
            teacher=viewer,
            user__isnull=False,
            status__in=LINKED_STATUSES,
        ).select_related("user__profile")
        if needle:
            students = students.filter(
                Q(first_name__icontains=needle)
                | Q(last_name__icontains=needle)
                | Q(user__profile__display_name__icontains=needle)
                | Q(user__profile__name__icontains=needle)
                | Q(user__profile__surname__icontains=needle)
                | Q(user__first_name__icontains=needle)
                | Q(user__last_name__icontains=needle)
            )
        people.extend(row.user for row in students.order_by("last_name", "first_name")[:limit])
        if len(needle) >= 3:
            teachers = (
                User.objects.filter(
                    profile__role="teacher",
                    profile__account_active=True,
                    profile__account_blocked=False,
                )
                .exclude(pk=viewer.pk)
                .select_related("profile")
                .filter(Q(username__icontains=needle) | Q(email__icontains=needle))
                .order_by("username")[:limit]
            )
            people.extend(teachers)
    else:
        teacher_ids = Student.objects.filter(
            user=viewer,
            status__in=LINKED_STATUSES,
        ).values_list("teacher_id", flat=True)
        if len(needle) >= 3:
            teachers = (
                User.objects.filter(
                    pk__in=teacher_ids,
                    profile__role="teacher",
                    profile__account_active=True,
                    profile__account_blocked=False,
                )
                .select_related("profile")
                .filter(Q(username__icontains=needle) | Q(email__icontains=needle))
                .order_by("username")[:limit]
            )
            people.extend(teachers)

    seen = set()
    contacts = []
    for person in people:
        if person.id in seen or not can_direct_message(viewer, person):
            continue
        seen.add(person.id)
        payload = _contact_payload(viewer, person, conversation_id=existing_id(person.id))
        if needle and payload["role"] == "teacher" and not _matches(needle, payload.get("login"), payload.get("email")):
            continue
        if needle and payload["role"] != "teacher" and not _matches(needle, payload["name"], payload["subtitle"]):
            continue
        contacts.append(payload)
        if len(contacts) >= limit:
            break
    return contacts
