import uuid

import django.db.models.deletion
from django.conf import settings
from django.db import migrations, models


LIMITS = {"start": 3, "teacher": 8}


def seed_limits(apps, schema_editor):
    TariffPlan = apps.get_model("Cabinet", "TariffPlan")
    for slug, limit in LIMITS.items():
        TariffPlan.objects.filter(slug=slug).update(max_variants_per_student_monthly=limit)


def unseed(apps, schema_editor):
    pass


class Migration(migrations.Migration):
    dependencies = [
        migrations.swappable_dependency(settings.AUTH_USER_MODEL),
        ("Cabinet", "0131_r95_cdn_switch_event"),
    ]

    operations = [
        migrations.AddField(
            model_name="tariffplan",
            name="max_variants_per_student_monthly",
            field=models.PositiveIntegerField(
                blank=True,
                null=True,
                help_text="r125: уникальных вариантов одному ученику в календарный месяц. Пусто — без лимита",
                verbose_name="Вариантов на ученика / мес",
            ),
        ),
        migrations.CreateModel(
            name="VariantLiveSession",
            fields=[
                ("id", models.UUIDField(default=uuid.uuid4, editable=False, primary_key=True, serialize=False)),
                ("variant_id", models.PositiveIntegerField(db_index=True, verbose_name="Вариант")),
                ("variant_url", models.CharField(max_length=500, verbose_name="Ссылка на вариант")),
                ("title", models.CharField(blank=True, max_length=255, verbose_name="Название")),
                ("created_at", models.DateTimeField(auto_now_add=True)),
                ("closed_at", models.DateTimeField(blank=True, null=True)),
                ("homework", models.ForeignKey(blank=True, null=True, on_delete=django.db.models.deletion.SET_NULL, related_name="variant_live_sessions", to="Cabinet.homework")),
                ("student", models.ForeignKey(blank=True, help_text="Если указан — подключиться может только этот ученик", null=True, on_delete=django.db.models.deletion.SET_NULL, related_name="variant_live_sessions", to="Cabinet.student")),
                ("teacher", models.ForeignKey(on_delete=django.db.models.deletion.CASCADE, related_name="variant_live_sessions", to=settings.AUTH_USER_MODEL)),
            ],
            options={"ordering": ["-created_at"], "verbose_name": "Live-решение варианта", "verbose_name_plural": "Live-решения вариантов"},
        ),
        migrations.CreateModel(
            name="VariantIssuance",
            fields=[
                ("id", models.BigAutoField(auto_created=True, primary_key=True, serialize=False, verbose_name="ID")),
                ("variant_id", models.PositiveIntegerField()),
                ("month", models.CharField(help_text="YYYY-MM по Москве", max_length=7)),
                ("source", models.CharField(choices=[("homework", "Домашнее задание"), ("live_solve", "Решение по ссылке"), ("lesson", "Показ на уроке")], max_length=20)),
                ("created_at", models.DateTimeField(auto_now_add=True)),
                ("student", models.ForeignKey(on_delete=django.db.models.deletion.CASCADE, related_name="variant_issuances", to="Cabinet.student")),
                ("teacher", models.ForeignKey(on_delete=django.db.models.deletion.CASCADE, related_name="variant_issuances", to=settings.AUTH_USER_MODEL)),
            ],
            options={"verbose_name": "Выдача варианта", "verbose_name_plural": "Выдачи вариантов"},
        ),
        migrations.AddConstraint(
            model_name="variantissuance",
            constraint=models.UniqueConstraint(fields=("teacher", "student", "variant_id", "month"), name="uniq_variant_issuance_month"),
        ),
        migrations.AddIndex(
            model_name="variantissuance",
            index=models.Index(fields=["teacher", "student", "month"], name="variant_iss_t_s_m"),
        ),
        migrations.RunPython(seed_limits, unseed),
    ]
