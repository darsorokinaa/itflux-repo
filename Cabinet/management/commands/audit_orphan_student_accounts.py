"""Read-only: ученики без связи Teacher↔Student (orphan accounts)."""

from __future__ import annotations

import json
from pathlib import Path

from django.contrib.auth.models import User
from django.core.management.base import BaseCommand
from django.utils import timezone

from Cabinet.choices import InvitationStatus
from Cabinet.models import Profile, Student, StudentInvitation


class Command(BaseCommand):
    help = (
        "Поиск student-аккаунтов без записи Student в ростере (только чтение). "
        "python manage.py audit_orphan_student_accounts [--output=orphans.json]"
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
        now = timezone.now()
        student_users = User.objects.filter(profile__role=Profile.Role.STUDENT).order_by("id")
        orphans = []
        for user in student_users.exclude(teacher_rosters__isnull=False).iterator():
            invites = list(
                StudentInvitation.objects.filter(accepted_by=user).values(
                    "id", "status", "teacher_id", "email", "pre_student_id"
                )[:10]
            )
            pending = list(
                StudentInvitation.objects.filter(
                    email__iexact=user.email or "",
                    status=InvitationStatus.PENDING,
                ).exclude(email="").values("id", "teacher_id", "token")[:10]
            )
            orphans.append({
                "user_id": user.id,
                "email": user.email,
                "username": user.username,
                "date_joined": user.date_joined.isoformat(),
                "is_active": user.is_active,
                "accepted_invitations": invites,
                "pending_invites_by_email": pending,
            })

        accepted_unlinked_pre_student = list(
            StudentInvitation.objects.filter(
                status=InvitationStatus.ACCEPTED,
                pre_student_id__isnull=False,
                pre_student__user__isnull=True,
            ).values("id", "teacher_id", "pre_student_id", "accepted_by_id", "email")[:200]
        )

        return {
            "generated_at": now.isoformat(),
            "student_users_total": student_users.count(),
            "orphan_student_users": len(orphans),
            "orphans": orphans[:500],
            "accepted_invitations_unlinked_pre_student": accepted_unlinked_pre_student,
            "note": "Только чтение. Repair не выполняется.",
        }

    def _print_summary(self, report: dict) -> None:
        self.stdout.write("Аудит orphan student accounts (данные не изменены)")
        self.stdout.write(f"  student_users_total: {report['student_users_total']}")
        self.stdout.write(f"  orphan_student_users: {report['orphan_student_users']}")
        self.stdout.write(
            "  accepted_invitations_unlinked_pre_student: "
            f"{len(report.get('accepted_invitations_unlinked_pre_student') or [])}"
        )
        for row in (report.get("orphans") or [])[:20]:
            self.stdout.write(
                f"    user_id={row['user_id']} email={row['email'] or '-'} "
                f"joined={row['date_joined']}"
            )
        self.stdout.write("Repair не запускался. Для применения нужен отдельный флаг.")
