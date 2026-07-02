"""
Восстанавливает записи ReferralLinkRegistration и выдаёт тариф «Профи» на 3 месяца
с даты регистрации учителям, у которых бонус не был применён.

python manage.py backfill_referral_registrations
python manage.py backfill_referral_registrations --referral-code profiteachertest
python manage.py backfill_referral_registrations --fix-existing --dry-run
"""

from django.contrib.auth.models import User
from django.core.management.base import BaseCommand
from django.db import transaction
from django.db.models import Count

from Cabinet.models import Profile, ReferralLink, ReferralLinkRegistration
from Cabinet.referral_service import ReferralService, add_months


class Command(BaseCommand):
    help = "Выдаёт реферальный тариф и заполняет таблицу регистраций по ссылкам"

    def add_arguments(self, parser):
        parser.add_argument(
            "--referral-code",
            dest="referral_code",
            default="",
            help="Код реферальной ссылки (по умолчанию — все активные ссылки)",
        )
        parser.add_argument(
            "--include-all-teachers",
            action="store_true",
            help="Обработать всех учителей без записи, а не только зарегистрированных после создания ссылки",
        )
        parser.add_argument(
            "--fix-existing",
            action="store_true",
            help="Пересчитать подписку и даты для уже существующих записей",
        )
        parser.add_argument(
            "--dry-run",
            action="store_true",
            help="Только показать, что будет сделано",
        )

    def handle(self, *args, **options):
        referral_code = (options.get("referral_code") or "").strip()
        include_all = options.get("include_all_teachers")
        fix_existing = options.get("fix_existing")
        dry_run = options.get("dry_run")

        links = ReferralLink.objects.select_related("reward_plan").filter(is_active=True)
        if referral_code:
            links = links.filter(code__iexact=referral_code)
        links = list(links.order_by("-created_at"))
        if not links:
            self.stderr.write(self.style.ERROR("Активные реферальные ссылки не найдены."))
            return

        default_link = links[0]
        processed = 0

        if fix_existing:
            processed += self._fix_existing_registrations(links, dry_run)

        teachers = (
            User.objects.filter(profile__role=Profile.Role.TEACHER)
            .select_related("profile")
            .exclude(pk__in=ReferralLinkRegistration.objects.values("user_id"))
            .order_by("date_joined")
        )

        for teacher in teachers:
            started_at = ReferralService.registration_started_at(teacher)
            if not include_all and started_at < default_link.created_at:
                continue

            link = default_link
            plan = ReferralService.resolve_reward_plan(link)
            expires_at = add_months(started_at, link.reward_months)
            label = teacher.email or teacher.username

            if dry_run:
                self.stdout.write(
                    f"  [dry-run] {label}: «{plan.name}» до {expires_at:%Y-%m-%d %H:%M} "
                    f"(с {started_at:%Y-%m-%d %H:%M}, ссылка {link.code})"
                )
                processed += 1
                continue

            with transaction.atomic():
                ReferralService.grant_subscription(
                    teacher,
                    plan,
                    link.reward_months,
                    started_at=started_at,
                )
                ReferralService.record_registration(
                    teacher,
                    link,
                    plan,
                    expires_at,
                    started_at=started_at,
                )
            self.stdout.write(
                self.style.SUCCESS(
                    f"  {label}: «{plan.name}» до {expires_at:%Y-%m-%d %H:%M} (ссылка {link.code})"
                )
            )
            processed += 1

        self._sync_registration_counts()
        suffix = " (dry-run)" if dry_run else ""
        self.stdout.write(self.style.SUCCESS(f"\nГотово: обработано {processed}{suffix}."))

    def _fix_existing_registrations(self, links, dry_run):
        default_link = links[0]
        count = 0
        qs = ReferralLinkRegistration.objects.select_related("user", "user__profile", "referral_link")
        for registration in qs:
            teacher = registration.user
            if teacher.profile.role != Profile.Role.TEACHER:
                continue
            started_at = ReferralService.registration_started_at(teacher)
            link = registration.referral_link or default_link
            plan = ReferralService.resolve_reward_plan(link)
            expires_at = add_months(started_at, link.reward_months)
            label = teacher.email or teacher.username

            if dry_run:
                self.stdout.write(
                    f"  [dry-run fix] {label}: «{plan.name}» до {expires_at:%Y-%m-%d %H:%M}"
                )
                count += 1
                continue

            with transaction.atomic():
                ReferralService.grant_subscription(
                    teacher,
                    plan,
                    link.reward_months,
                    started_at=started_at,
                )
                registration.referral_link = link
                registration.reward_plan = plan
                registration.reward_months = link.reward_months
                registration.expires_at = expires_at
                registration.save(update_fields=[
                    "referral_link", "reward_plan", "reward_months", "expires_at",
                ])
                ReferralLinkRegistration.objects.filter(pk=registration.pk).update(registered_at=started_at)
            self.stdout.write(
                self.style.SUCCESS(
                    f"  fix {label}: «{plan.name}» до {expires_at:%Y-%m-%d %H:%M}"
                )
            )
            count += 1
        return count

    def _sync_registration_counts(self):
        for link in ReferralLink.objects.annotate(actual_count=Count("registrations")):
            if link.registrations_count != link.actual_count:
                link.registrations_count = link.actual_count
                link.save(update_fields=["registrations_count", "updated_at"])
