from django.conf import settings
from django.db import migrations, models
import django.db.models.deletion


class Migration(migrations.Migration):

    dependencies = [
        migrations.swappable_dependency(settings.AUTH_USER_MODEL),
        ("Cabinet", "0083_material_demo_preview_mode"),
        ("Generator", "0086_update_url_and_link_text"),
    ]

    operations = [
        migrations.AlterField(
            model_name="payment",
            name="purpose",
            field=models.CharField(
                choices=[
                    ("subscription", "Подписка"),
                    ("material", "Покупка материала"),
                    ("lesson", "Покупка готового урока"),
                ],
                db_index=True,
                default="subscription",
                max_length=20,
                verbose_name="Назначение",
            ),
        ),
        migrations.CreateModel(
            name="LessonPurchase",
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
                    "lesson",
                    models.ForeignKey(
                        on_delete=django.db.models.deletion.CASCADE,
                        related_name="purchases",
                        to="Generator.lesson",
                        verbose_name="Готовый урок",
                    ),
                ),
                (
                    "payment",
                    models.OneToOneField(
                        blank=True,
                        null=True,
                        on_delete=django.db.models.deletion.SET_NULL,
                        related_name="lesson_purchase",
                        to="Cabinet.payment",
                        verbose_name="Платёж",
                    ),
                ),
                (
                    "user",
                    models.ForeignKey(
                        on_delete=django.db.models.deletion.CASCADE,
                        related_name="lesson_purchases",
                        to=settings.AUTH_USER_MODEL,
                        verbose_name="Пользователь",
                    ),
                ),
            ],
            options={
                "verbose_name": "Покупка готового урока",
                "verbose_name_plural": "Покупки готовых уроков",
                "ordering": ["-purchased_at", "-created_at"],
            },
        ),
        migrations.CreateModel(
            name="LessonDemoAccess",
            fields=[
                ("id", models.BigAutoField(auto_created=True, primary_key=True, serialize=False, verbose_name="ID")),
                ("opened_at", models.DateTimeField(verbose_name="Открыто")),
                ("expires_at", models.DateTimeField(verbose_name="Сессия до")),
                ("session_finished_at", models.DateTimeField(blank=True, null=True, verbose_name="Сессия завершена")),
                ("terms_accepted_at", models.DateTimeField(blank=True, null=True, verbose_name="Условия приняты")),
                ("created_at", models.DateTimeField(auto_now_add=True)),
                (
                    "lesson",
                    models.ForeignKey(
                        on_delete=django.db.models.deletion.CASCADE,
                        related_name="demo_accesses",
                        to="Generator.lesson",
                        verbose_name="Готовый урок",
                    ),
                ),
                (
                    "user",
                    models.ForeignKey(
                        on_delete=django.db.models.deletion.CASCADE,
                        related_name="lesson_demo_accesses",
                        to=settings.AUTH_USER_MODEL,
                        verbose_name="Пользователь",
                    ),
                ),
            ],
            options={
                "verbose_name": "Демодоступ к готовому уроку",
                "verbose_name_plural": "Демодоступы к готовым урокам",
            },
        ),
        migrations.AddConstraint(
            model_name="lessonpurchase",
            constraint=models.UniqueConstraint(
                condition=models.Q(("status", "paid")),
                fields=("user", "lesson"),
                name="cab_les_purchase_user_lesson_paid_uniq",
            ),
        ),
        migrations.AddIndex(
            model_name="lessonpurchase",
            index=models.Index(fields=["user", "status"], name="cab_les_purch_user_status_idx"),
        ),
        migrations.AddConstraint(
            model_name="lessondemoaccess",
            constraint=models.UniqueConstraint(
                fields=("user", "lesson"),
                name="cab_les_demo_user_lesson_uniq",
            ),
        ),
    ]
