"""
Выдаёт акционный тариф «Профи» на 3 месяца с даты регистрации
всем учителям, зарегистрировавшимся до 1 января 2027.
Также мигрирует legacy slug=profi → актуальный slug=pro.

python manage.py grant_registration_promo
python manage.py grant_registration_promo --dry-run
python manage.py grant_registration_promo --force
"""

from django.contrib.auth.models import User
from django.core.management.base import BaseCommand

from Cabinet.models import Profile
from Cabinet.referral_service import ReferralService, add_months
from Cabinet.registration_promo import (
    PROMO_MONTHS,
    PROMO_PLAN_SLUG,
    apply_registration_promo,
    promo_deadline,
    registration_qualifies_for_promo,
)


class Command(BaseCommand):
    help = "Акция: Профи на 3 месяца с даты регистрации (до 1 января 2027)"

    def add_arguments(self, parser):
        parser.add_argument(
            "--dry-run",
            action="store_true",
            help="Только показать, кого затронет",
        )
        parser.add_argument(
            "--force",
            action="store_true",
            help="Перезаписать подписку даже если уже есть Профи",
        )

    def handle(self, *args, **options):
        dry_run = options["dry_run"]
        force = options["force"]
        deadline = promo_deadline()
        self.stdout.write(
            f"Акция до {deadline.isoformat()} · план «{PROMO_PLAN_SLUG}» · {PROMO_MONTHS} мес."
        )

        teachers = (
            User.objects.filter(profile__role=Profile.Role.TEACHER)
            .select_related("profile", "subscription", "subscription__plan")
            .order_by("date_joined")
        )

        granted = 0
        skipped = 0
        for teacher in teachers:
            started_at = ReferralService.registration_started_at(teacher)
            if not registration_qualifies_for_promo(started_at):
                skipped += 1
                continue

            expires_at = add_months(started_at, PROMO_MONTHS)
            label = teacher.email or teacher.username
            current_sub = getattr(teacher, "subscription", None)
            current = getattr(current_sub, "plan", None)
            current_slug = current.slug if current else "—"

            if dry_run:
                self.stdout.write(
                    f"  [dry-run] {label}: {current_slug} → {PROMO_PLAN_SLUG} "
                    f"до {expires_at:%Y-%m-%d} (с {started_at:%Y-%m-%d})"
                )
                granted += 1
                continue

            result = apply_registration_promo(teacher, force=force)
            if result:
                self.stdout.write(
                    self.style.SUCCESS(
                        f"  {label}: «{result['plan_name']}» ({result['plan_slug']}) "
                        f"до {result['expires_at'][:10]}"
                    )
                )
                granted += 1
            else:
                skipped += 1
                self.stdout.write(f"  skip {label}: текущий={current_slug}")

        self.stdout.write(
            self.style.NOTICE(f"Готово: выдано/к выдаче={granted}, пропущено={skipped}")
        )
