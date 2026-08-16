"""Только чтение: аудит учёток учеников и приглашений."""

from __future__ import annotations

import json
from pathlib import Path

from django.contrib.auth.models import User
from django.core.management.base import BaseCommand
from django.db.models import Count
from django.utils import timezone

from Cabinet.choices import InvitationStatus, StudentStatus
from Cabinet.models import Profile, Student, StudentInvitation


class Command(BaseCommand):
    help = (
        "Аудит учёток учеников и приглашений (только чтение). "
        "python manage.py audit_student_auth [--output=student_auth_audit.json]"
    )

    def add_arguments(self, parser):
        parser.add_argument("--output", type=str, default="", help="Путь к JSON-отчёту")

    def handle(self, *args, **options):
        report = self._build_report()
        self._print_summary(report)
        output = (options.get("output") or "").strip()
        if output:
            path = Path(output)
            path.write_text(json.dumps(report, ensure_ascii=False, indent=2, default=str), encoding="utf-8")
            self.stdout.write(self.style.SUCCESS(f"Отчёт сохранён: {path}"))

    def _build_report(self) -> dict:
        now = timezone.now()
        students = Student.objects.select_related("user", "teacher")
        users_with_many_students = list(
            Student.objects.filter(user__isnull=False)
            .values("user_id")
            .annotate(cnt=Count("id"))
            .filter(cnt__gt=1)
        )
        teacher_user_dupes = list(
            Student.objects.filter(user__isnull=False)
            .values("teacher_id", "user_id")
            .annotate(cnt=Count("id"))
            .filter(cnt__gt=1)
        )
        email_dupes = list(
            Student.objects.exclude(email="")
            .values("teacher_id", "email")
            .annotate(cnt=Count("id"))
            .filter(cnt__gt=1)
        )
        login_dupes = list(
            User.objects.exclude(email="")
            .values("email")
            .annotate(cnt=Count("id"))
            .filter(cnt__gt=1)
        )
        orphan_students = students.filter(teacher__isnull=True).count()
        without_user = students.filter(user__isnull=True).exclude(status=StudentStatus.ARCHIVED).count()
        without_teacher_rel = 0
        stale_invites = StudentInvitation.objects.filter(
            status=InvitationStatus.PENDING,
            expires_at__lt=now,
        ).count()
        accepted_still_pending = 0
        reused_after_accept = StudentInvitation.objects.filter(
            status=InvitationStatus.ACCEPTED,
            pre_student__user__isnull=True,
        ).count()
        profiles_without_role = Profile.objects.filter(role="").count()
        student_users = User.objects.filter(profile__role=Profile.Role.STUDENT)
        student_users_no_roster = student_users.exclude(
            teacher_rosters__isnull=False
        ).count()

        return {
            "generated_at": now.isoformat(),
            "students_total": students.count(),
            "users_with_many_student_rows": users_with_many_students[:200],
            "duplicate_teacher_user_pairs": teacher_user_dupes[:200],
            "duplicate_emails_per_teacher": [
                {**row, "email": row["email"]} for row in email_dupes[:200]
            ],
            "duplicate_user_emails": login_dupes[:200],
            "orphan_students_no_teacher": orphan_students,
            "active_students_without_user": without_user,
            "students_without_teacher_relation": without_teacher_rel,
            "pending_invitations_expired": stale_invites,
            "accepted_invitations_unlinked_pre_student": reused_after_accept,
            "student_users_without_roster": student_users_no_roster,
            "profiles_without_role": profiles_without_role,
        }

    def _print_summary(self, report: dict) -> None:
        self.stdout.write("Аудит student auth (данные не изменены)")
        for key in (
            "students_total",
            "active_students_without_user",
            "pending_invitations_expired",
            "accepted_invitations_unlinked_pre_student",
            "student_users_without_roster",
        ):
            self.stdout.write(f"  {key}: {report.get(key)}")
        self.stdout.write(
            f"  duplicate teacher+user pairs: {len(report.get('duplicate_teacher_user_pairs') or [])}"
        )
        self.stdout.write(
            f"  users with many student rows: {len(report.get('users_with_many_student_rows') or [])}"
        )
