"""
Production: перевести учителей на тариф «Премиум» и контент на access_level=premium.

Меняет только plan / access_level. Даты подписки (expires_at и пр.) НЕ трогает.

Перед запуском на проде:
  1) python manage.py migrate          # в т.ч. Generator 0085 (access_level у Interesting)
  2) python manage.py seed_tariffs     # если тарифа premium ещё нет
  3) python manage.py grant_premium_tariff --dry-run
  4) python manage.py grant_premium_tariff

Опции:
  --dry-run         только показать изменения
  --teachers-only   только подписки
  --content-only    только уроки + интересное
"""

from __future__ import annotations

from django.contrib.auth.models import User
from django.core.management.base import BaseCommand
from django.db import transaction

from Cabinet.models import Profile, TariffPlan, TeacherSubscription
from Generator.models import InterestingItem, Lesson

PLAN_SLUG = "premium"
CONTENT_ACCESS = "premium"


class Command(BaseCommand):
    help = (
        "Прод: тариф учителей → Премиум, access_level уроков/интересного → premium. "
        "Сроки подписки не меняет."
    )

    def add_arguments(self, parser):
        parser.add_argument(
            "--dry-run",
            action="store_true",
            help="Только показать, кого и что затронет",
        )
        parser.add_argument(
            "--teachers-only",
            action="store_true",
            help="Только подписки учителей",
        )
        parser.add_argument(
            "--content-only",
            action="store_true",
            help="Только access_level уроков и интересного",
        )

    def handle(self, *args, **options):
        dry_run = options["dry_run"]
        teachers_only = options["teachers_only"]
        content_only = options["content_only"]

        if teachers_only and content_only:
            self.stderr.write(self.style.ERROR(
                "Нельзя одновременно --teachers-only и --content-only"
            ))
            return

        if not content_only:
            plan = TariffPlan.objects.filter(slug=PLAN_SLUG, is_active=True).first()
            if not plan:
                self.stderr.write(self.style.ERROR(
                    f"Тариф «{PLAN_SLUG}» не найден. Сначала: python manage.py seed_tariffs"
                ))
                return
            self._grant_teachers(plan, dry_run=dry_run)

        if not teachers_only:
            self._set_content_premium(dry_run=dry_run)

        self.stdout.write(self.style.SUCCESS(
            "Готово." + (" (dry-run, БД не менялась)" if dry_run else "")
        ))

    def _grant_teachers(self, plan: TariffPlan, *, dry_run: bool) -> None:
        teachers = (
            User.objects.filter(profile__role=Profile.Role.TEACHER)
            .select_related("profile", "subscription", "subscription__plan")
            .order_by("id")
        )
        updated = 0
        created = 0
        skipped = 0

        self.stdout.write(
            f"Учителя → «{plan.name}» ({plan.slug}), даты НЕ меняем"
            + (" [dry-run]" if dry_run else "")
        )

        for teacher in teachers:
            label = teacher.email or teacher.username
            sub = getattr(teacher, "subscription", None)
            current_slug = sub.plan.slug if sub and sub.plan_id else "—"
            expires_label = (
                sub.expires_at.strftime("%Y-%m-%d %H:%M")
                if sub and sub.expires_at
                else ("null" if sub else "—")
            )

            if sub and sub.plan_id == plan.pk:
                skipped += 1
                continue

            if dry_run:
                action = "update" if sub else "create"
                self.stdout.write(
                    f"  [dry-run] {action} {label}: {current_slug} → {plan.slug} "
                    f"(expires_at останется {expires_label})"
                )
                if sub:
                    updated += 1
                else:
                    created += 1
                continue

            with transaction.atomic():
                if sub is None:
                    # Нет подписки — создаём только с тарифом, без выдуманных дат.
                    TeacherSubscription.objects.create(
                        teacher=teacher,
                        plan=plan,
                        status=TeacherSubscription.Status.ACTIVE,
                        source=TeacherSubscription.Source.ADMIN,
                    )
                    created += 1
                    self.stdout.write(
                        self.style.SUCCESS(f"  create {label}: → {plan.slug}")
                    )
                else:
                    # Только plan. status/source/expires_at/promo/* не трогаем.
                    TeacherSubscription.objects.filter(pk=sub.pk).update(plan_id=plan.pk)
                    updated += 1
                    self.stdout.write(
                        self.style.SUCCESS(
                            f"  update {label}: {current_slug} → {plan.slug} "
                            f"(expires_at={expires_label})"
                        )
                    )

        self.stdout.write(self.style.NOTICE(
            f"Подписки: создано={created}, обновлено={updated}, "
            f"уже {PLAN_SLUG}={skipped}, учителей={teachers.count()}"
        ))

    def _set_content_premium(self, *, dry_run: bool) -> None:
        if not hasattr(InterestingItem, "access_level"):
            self.stderr.write(self.style.ERROR(
                "У InterestingItem нет access_level — сначала migrate Generator"
            ))
            return

        lessons_qs = Lesson.objects.exclude(access_level=CONTENT_ACCESS)
        interesting_qs = InterestingItem.objects.exclude(access_level=CONTENT_ACCESS)
        lessons_n = lessons_qs.count()
        interesting_n = interesting_qs.count()

        self.stdout.write(
            f"Контент → access_level={CONTENT_ACCESS}: "
            f"уроков к смене={lessons_n}, интересного к смене={interesting_n}"
            + (" [dry-run]" if dry_run else "")
        )

        if dry_run:
            for obj in lessons_qs.order_by("id"):
                self.stdout.write(
                    f"  [dry-run] lesson #{obj.pk} [{obj.access_level}] {obj.title[:70]}"
                )
            for obj in interesting_qs.order_by("id"):
                self.stdout.write(
                    f"  [dry-run] interesting #{obj.pk} [{obj.access_level}] {obj.title[:70]}"
                )
            return

        lessons_updated = lessons_qs.update(access_level=CONTENT_ACCESS)
        interesting_updated = interesting_qs.update(access_level=CONTENT_ACCESS)
        self.stdout.write(self.style.NOTICE(
            f"Контент обновлён: уроков={lessons_updated}, интересного={interesting_updated}"
        ))
