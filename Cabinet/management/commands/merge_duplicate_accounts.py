"""r91: слияние пустого OAuth-дубля с существующим аккаунтом ученика.

По умолчанию — только просмотр (dry-run). Изменения — лишь с --apply и явными парами:
  python manage.py merge_duplicate_accounts --pair 553:430            # dry-run
  python manage.py merge_duplicate_accounts --pair 553:430 --apply    # выполнить

Что делает с --apply (в одной транзакции):
  1) переносит внешние входы (Яндекс/VK) дубля на существующий аккаунт — следующий вход
     через тот же Яндекс/VK попадёт в аккаунт ученика;
  2) деактивирует дубль (is_active=False, account_active=False). Ничего не удаляет.
Отказывается, если дубль не пустой или пара не совпадает с отчётом report_duplicate_accounts
(можно обойти --force-pair после ручной проверки). Уведомлений не отправляет.
"""
from django.contrib.auth import get_user_model
from django.core.management.base import BaseCommand, CommandError
from django.db import transaction

from Cabinet.models import SocialAccount
from Cabinet.r91_duplicates import find_duplicates, is_empty, usage_counts

User = get_user_model()


class Command(BaseCommand):
    help = "Слияние пустых OAuth-дублей с аккаунтом ученика (по умолчанию dry-run)."

    def add_arguments(self, parser):
        parser.add_argument("--pair", action="append", default=[], help="DUP_ID:EXISTING_ID")
        parser.add_argument("--apply", action="store_true", help="Выполнить (без флага — dry-run)")
        parser.add_argument("--dry-run", action="store_true", help="Явный dry-run (по умолчанию)")
        parser.add_argument("--force-pair", action="store_true", help="Разрешить пару вне отчёта")

    def handle(self, *args, **o):
        if not o["pair"]:
            raise CommandError("Укажите хотя бы одну пару --pair DUP_ID:EXISTING_ID")
        apply = o["apply"] and not o["dry_run"]
        known = {(r["dup_id"], r["orig_id"]) for r in find_duplicates()}
        for raw in o["pair"]:
            try:
                dup_id, orig_id = (int(x) for x in raw.split(":"))
            except ValueError:
                raise CommandError(f"Неверная пара: {raw}")
            if (dup_id, orig_id) not in known and not o["force_pair"]:
                raise CommandError(f"Пары {dup_id}:{orig_id} нет в отчёте report_duplicate_accounts")
            dup, orig = User.objects.get(pk=dup_id), User.objects.get(pk=orig_id)
            if not is_empty(dup):
                raise CommandError(f"user={dup_id} не пустой: {usage_counts(dup)}")
            socials = list(SocialAccount.objects.filter(user=dup))
            plan = [f"move social {s.provider} (id={s.id}) user {dup_id} -> {orig_id}" for s in socials]
            plan.append(f"deactivate user {dup_id} (is_active=False, profile.account_active=False)")
            for line in plan:
                self.stdout.write(("APPLY " if apply else "DRY-RUN ") + line)
            if not apply:
                continue
            with transaction.atomic():
                for s in socials:
                    if SocialAccount.objects.filter(user=orig, provider=s.provider).exclude(pk=s.pk).exists():
                        self.stdout.write(f"  skip {s.provider}: у user={orig_id} уже есть вход этого провайдера")
                        continue
                    s.user = orig
                    s.save(update_fields=["user"])
                User.objects.filter(pk=dup_id).update(is_active=False)
                prof = getattr(dup, "profile", None)
                if prof is not None:
                    prof.account_active = False
                    prof.save(update_fields=["account_active"])
            self.stdout.write(self.style.SUCCESS(f"Готово: {dup_id} -> {orig_id}"))
