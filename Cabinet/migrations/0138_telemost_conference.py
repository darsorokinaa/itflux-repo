# ruff: noqa: RUF012
import django.db.models.deletion
from django.db import migrations, models


class Migration(migrations.Migration):
    dependencies = [
        ("Cabinet", "0137_storefront_funnel_events"),
    ]

    operations = [
        migrations.CreateModel(
            name="TelemostConference",
            fields=[
                (
                    "id",
                    models.BigAutoField(
                        auto_created=True,
                        primary_key=True,
                        serialize=False,
                        verbose_name="ID",
                    ),
                ),
                (
                    "conference_id",
                    models.CharField(blank=True, default="", max_length=128),
                ),
                ("join_url", models.URLField(max_length=500)),
                (
                    "waiting_room_level",
                    models.CharField(default="PUBLIC", max_length=32),
                ),
                ("created_at", models.DateTimeField(auto_now_add=True)),
                (
                    "meeting",
                    models.OneToOneField(
                        on_delete=django.db.models.deletion.CASCADE,
                        related_name="telemost_conference",
                        to="Cabinet.videomeeting",
                    ),
                ),
            ],
            options={
                "verbose_name": "Конференция Телемоста",
                "verbose_name_plural": "Конференции Телемоста",
            },
        ),
    ]
