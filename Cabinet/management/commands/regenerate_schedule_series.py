from datetime import timedelta

from django.core.management.base import BaseCommand
from django.utils import timezone

from Cabinet.choices import SeriesStatus
from Cabinet.models import ScheduleEventSeries
from Cabinet.schedule_series import DEFAULT_HORIZON_DAYS, generate_events_for_series


class Command(BaseCommand):
    help = "Regenerate future schedule events for active series"

    def add_arguments(self, parser):
        parser.add_argument("--days", type=int, default=DEFAULT_HORIZON_DAYS)

    def handle(self, *args, **options):
        days = options["days"]
        date_from = timezone.localdate()
        date_to = date_from + timedelta(days=days)
        total = 0
        for series in ScheduleEventSeries.objects.filter(status=SeriesStatus.ACTIVE):
            created = generate_events_for_series(series, date_from, date_to)
            total += len(created)
            self.stdout.write(f"Series {series.pk}: +{len(created)} events")
        self.stdout.write(self.style.SUCCESS(f"Total created: {total}"))
