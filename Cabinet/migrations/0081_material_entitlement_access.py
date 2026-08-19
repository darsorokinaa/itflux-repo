from django.conf import settings
from django.db import migrations, models
import django.db.models.deletion


def enable_demo_for_paid_materials(apps, schema_editor):
    Material = apps.get_model("Cabinet", "Material")
    Material.objects.exclude(access_level__in=["free", "", None]).update(demo_enabled=True)


def noop(apps, schema_editor):
    pass


class Migration(migrations.Migration):

    dependencies = [
        migrations.swappable_dependency(settings.AUTH_USER_MODEL),
        ("Cabinet", "0080_billing_ledger_key"),
    ]

    operations = [
        migrations.AddField(
            model_name="material",
            name="standalone_purchase_enabled",
            field=models.BooleanField(
                default=False,
                help_text="Можно купить этот материал отдельно, даже если текущий тариф ниже требуемого.",
                verbose_name="Отдельная покупка",
            ),
        ),
        migrations.AddField(
            model_name="material",
            name="standalone_price",
            field=models.DecimalField(
                blank=True,
                decimal_places=2,
                max_digits=10,
                null=True,
                verbose_name="Цена отдельной покупки",
            ),
        ),
        migrations.AddField(
            model_name="material",
            name="standalone_currency",
            field=models.CharField(default="RUB", max_length=8, verbose_name="Валюта покупки"),
        ),
        migrations.AddField(
            model_name="material",
            name="demo_enabled",
            field=models.BooleanField(
                default=False,
                help_text="Одноразовое демо для зарегистрированных пользователей без полного доступа.",
                verbose_name="Демоверсия",
            ),
        ),
        migrations.AddField(
            model_name="material",
            name="demo_duration_minutes",
            field=models.PositiveSmallIntegerField(
                default=45,
                help_text="TTL demo-session. Обновление страницы внутри окна не расходует демо повторно.",
                verbose_name="Длительность демо (мин)",
            ),
        ),
        migrations.AddField(
            model_name="payment",
            name="purpose",
            field=models.CharField(
                choices=[("subscription", "Подписка"), ("material", "Покупка материала")],
                db_index=True,
                default="subscription",
                max_length=20,
                verbose_name="Назначение",
            ),
        ),
        migrations.CreateModel(
            name="MaterialPurchase",
            fields=[
                ("id", models.BigAutoField(auto_created=True, primary_key=True, serialize=False, verbose_name="ID")),
                ("amount", models.DecimalField(decimal_places=2, default=0, max_digits=10, verbose_name="Сумма")),
                ("currency", models.CharField(default="RUB", max_length=8, verbose_name="Валюта")),
                (
                    "status",
                    models.CharField(
                        choices=[
                            ("pending", "Ожидает"),
                            ("paid", "Оплачена"),
                            ("refunded", "Возврат"),
                            ("cancelled", "Отменена"),
                        ],
                        db_index=True,
                        default="pending",
                        max_length=20,
                        verbose_name="Статус",
                    ),
                ),
                ("purchased_at", models.DateTimeField(blank=True, null=True, verbose_name="Куплено")),
                (
                    "valid_until",
                    models.DateTimeField(
                        blank=True,
                        help_text="Пусто — бессрочный доступ.",
                        null=True,
                        verbose_name="Действует до",
                    ),
                ),
                ("created_at", models.DateTimeField(auto_now_add=True)),
                ("updated_at", models.DateTimeField(auto_now=True)),
                (
                    "material",
                    models.ForeignKey(
                        on_delete=django.db.models.deletion.CASCADE,
                        related_name="purchases",
                        to="Cabinet.material",
                        verbose_name="Материал",
                    ),
                ),
                (
                    "payment",
                    models.OneToOneField(
                        blank=True,
                        null=True,
                        on_delete=django.db.models.deletion.SET_NULL,
                        related_name="material_purchase",
                        to="Cabinet.payment",
                        verbose_name="Платёж",
                    ),
                ),
                (
                    "user",
                    models.ForeignKey(
                        on_delete=django.db.models.deletion.CASCADE,
                        related_name="material_purchases",
                        to=settings.AUTH_USER_MODEL,
                        verbose_name="Пользователь",
                    ),
                ),
            ],
            options={
                "verbose_name": "Покупка материала",
                "verbose_name_plural": "Покупки материалов",
                "ordering": ["-purchased_at", "-created_at"],
            },
        ),
        migrations.CreateModel(
            name="MaterialDemoAccess",
            fields=[
                ("id", models.BigAutoField(auto_created=True, primary_key=True, serialize=False, verbose_name="ID")),
                ("opened_at", models.DateTimeField(verbose_name="Открыто")),
                ("expires_at", models.DateTimeField(verbose_name="Сессия до")),
                ("session_finished_at", models.DateTimeField(blank=True, null=True, verbose_name="Сессия завершена")),
                ("terms_accepted_at", models.DateTimeField(blank=True, null=True, verbose_name="Условия приняты")),
                ("created_at", models.DateTimeField(auto_now_add=True)),
                (
                    "material",
                    models.ForeignKey(
                        on_delete=django.db.models.deletion.CASCADE,
                        related_name="demo_accesses",
                        to="Cabinet.material",
                        verbose_name="Материал",
                    ),
                ),
                (
                    "user",
                    models.ForeignKey(
                        on_delete=django.db.models.deletion.CASCADE,
                        related_name="material_demo_accesses",
                        to=settings.AUTH_USER_MODEL,
                        verbose_name="Пользователь",
                    ),
                ),
            ],
            options={
                "verbose_name": "Демодоступ к материалу",
                "verbose_name_plural": "Демодоступы к материалам",
            },
        ),
        migrations.AddConstraint(
            model_name="materialpurchase",
            constraint=models.UniqueConstraint(
                condition=models.Q(status="paid"),
                fields=("user", "material"),
                name="cab_mat_purchase_user_material_paid_uniq",
            ),
        ),
        migrations.AddIndex(
            model_name="materialpurchase",
            index=models.Index(fields=["user", "status"], name="cab_mat_purch_user_status_idx"),
        ),
        migrations.AddConstraint(
            model_name="materialdemoaccess",
            constraint=models.UniqueConstraint(
                fields=("user", "material"),
                name="cab_mat_demo_user_material_uniq",
            ),
        ),
        migrations.RunPython(enable_demo_for_paid_materials, noop),
    ]
