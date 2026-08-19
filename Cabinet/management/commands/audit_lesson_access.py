"""Dry-run audit of Generator.Lesson shop access fields."""

from django.core.management.base import BaseCommand
from django.db.models import Q

from Generator.models import Lesson


class Command(BaseCommand):
    help = "Аудит доступа готовых уроков Generator.Lesson (dry-run)."

    def handle(self, *args, **options):
        qs = Lesson.objects.all()
        total = qs.count()
        free = qs.filter(access_level="free").count()
        teacher = qs.filter(access_level="teacher").count()
        pro = qs.filter(access_level="professional").count()
        premium = qs.filter(access_level="premium").count()
        demo_on = qs.filter(demo_enabled=True).count()
        demo_partial = qs.filter(demo_mode="partial").count()
        standalone = qs.filter(standalone_purchase_enabled=True).count()

        conflicts = []
        free_with_demo = qs.filter(access_level="free", demo_enabled=True)
        if free_with_demo.exists():
            conflicts.append(("free + demo_enabled", free_with_demo.count()))
        free_with_price = qs.filter(access_level="free", standalone_purchase_enabled=True)
        if free_with_price.exists():
            conflicts.append(("free + standalone_purchase", free_with_price.count()))
        purchase_without_price = qs.filter(standalone_purchase_enabled=True).filter(
            Q(standalone_price__isnull=True) | Q(standalone_price__lte=0)
        )
        if purchase_without_price.exists():
            conflicts.append(("standalone_purchase without price", purchase_without_price.count()))

        self.stdout.write(f"Готовых уроков (Generator.Lesson): {total}")
        self.stdout.write(f"Free: {free}")
        self.stdout.write(f"Teacher: {teacher}")
        self.stdout.write(f"Professional: {pro}")
        self.stdout.write(f"Premium: {premium}")
        self.stdout.write(f"Demo enabled: {demo_on}")
        self.stdout.write(f"Demo partial: {demo_partial}")
        self.stdout.write(f"Standalone purchase: {standalone}")
        self.stdout.write(f"Potential access conflicts: {len(conflicts)}")
        for label, count in conflicts:
            self.stdout.write(f"  - {label}: {count}")
        if not conflicts:
            self.stdout.write("Конфликтов не найдено.")
