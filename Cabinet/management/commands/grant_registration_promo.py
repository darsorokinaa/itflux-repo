"""
Выдаёт акционный тариф стартовой акции (Премиум) на N месяцев
с даты регистрации всем учителям в окне акции.

Параметры акции — в БД (Cabinet → Акции, код launch-premium).

python manage.py grant_registration_promo
python manage.py grant_registration_promo --dry-run
python manage.py grant_registration_promo --force
"""

from django.contrib.auth.models import User
from django.core.management.base import BaseCommand

from Cabinet.models import Profile
from Cabinet.referral_service import ReferralService, add_months
from Cabinet.registration_promo import (
    apply_registration_promo,
    ensure_launch_promotion,
    promo_deadline,
    promo_months,
    promo_plan_slug,
    registration_qualifies_for_promo,
)


class Command(BaseCommand):
    help = "Стартовая акция: Премиум на 3 месяца с даты регистрации (запись в Акциях)"

    def add_arguments(self, parser):
        parser.add_argument(
            "--dry-run",
            action="store_true",
            help="Только показать, кого затронет",
        )
        parser.add_argument(
            "--force",
            action="store_true",
            help="Перезаписать подписку даже если уже есть Премиум",
        )

    def handle(self, *args, **options):
        dry_run = options["dry_run"]
        force = options["force"]
        promo = ensure_launch_promotion()
        if promo is None:
            self.stderr.write(self.style.ERROR(
                "Нет тарифа «premium» и записи акции. Сначала: python manage.py seed_tariffs"
            ))
            return

        deadline = promo_deadline()
        slug = promo_plan_slug()
        months = promo_months()
        self.stdout.write(
            f"Акция «{promo.name}» (код {promo.code}, активна={promo.is_active}) "
            f"до {deadline.isoformat()} · план «{slug}» · {months} мес."
        )
        self.stdout.write(
            "Завершить можно в админке: Cabinet → Акции → снять «Активна» "
            "или изменить «Можно получить до»."
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
            if not force and not registration_qualifies_for_promo(started_at):
                skipped += 1
                continue

            expires_at = add_months(started_at, months)
            label = teacher.email or teacher.username
            current_sub = getattr(teacher, "subscription", None)
            current = getattr(current_sub, "plan", None)
            current_slug = current.slug if current else "—"

            if dry_run:
                self.stdout.write(
                    f"  [dry-run] {label}: {current_slug} → {slug} "
                    f"до {expires_at:%Y-%m-%d} (с {started_at:%Y-%m-%d})"
                )
                granted += 1
                continue

            result = apply_registration_promo(teacher, force=force)
            if result:
                until = (result.get("expires_at") or "")[:10] or "без срока"
                self.stdout.write(
                    self.style.SUCCESS(
                        f"  {label}: «{result['plan_name']}» ({result['plan_slug']}) "
                        f"до {until}"
                    )
                )
                granted += 1
            else:
                skipped += 1
                self.stdout.write(f"  skip {label}: текущий={current_slug}")

        self.stdout.write(
            self.style.NOTICE(f"Готово: выдано/к выдаче={granted}, пропущено={skipped}")
        )
