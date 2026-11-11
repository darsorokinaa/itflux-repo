import django.utils.timezone
from django.conf import settings
from django.db import migrations, models


class Migration(migrations.Migration):

    dependencies = [
        ("Cabinet", "0135_paid_trainers_and_discounts"),
        migrations.swappable_dependency(settings.AUTH_USER_MODEL),
    ]

    operations = [
        migrations.AddField(
            model_name="profile",
            name="acquisition_touch",
            field=models.JSONField(
                blank=True,
                default=dict,
                help_text="utm_source, utm_medium, utm_campaign, utm_content, ref. Без почты и полного URL.",
                verbose_name="Первый источник (utm/ref)",
            ),
        ),
        migrations.CreateModel(
            name="StorefrontEvent",
            fields=[
                ("id", models.BigAutoField(auto_created=True, primary_key=True, serialize=False, verbose_name="ID")),
                ("event_name", models.CharField(choices=[("pricing_view", "Просмотр /pricing"), ("tariff_click", "Клик по тарифу"), ("promo_applied", "Промокод применён"), ("payment_created", "Платёж создан")], db_index=True, max_length=32, verbose_name="Событие")),
                ("occurred_at", models.DateTimeField(db_index=True, default=django.utils.timezone.now, verbose_name="Когда")),
                ("metadata", models.JSONField(blank=True, default=dict, verbose_name="Метаданные")),
                ("idempotency_key", models.CharField(blank=True, max_length=80, null=True, unique=True, verbose_name="Идемпотентность")),
                ("created_at", models.DateTimeField(auto_now_add=True)),
                ("user", models.ForeignKey(blank=True, null=True, on_delete=models.deletion.SET_NULL, related_name="storefront_events", to=settings.AUTH_USER_MODEL, verbose_name="Пользователь")),
            ],
            options={
                "verbose_name": "Событие витрины",
                "verbose_name_plural": "События витрины",
                "ordering": ["-occurred_at"],
            },
        ),
        migrations.AddIndex(
            model_name="storefrontevent",
            index=models.Index(fields=["event_name", "occurred_at"], name="cab_store_evt_time_idx"),
        ),
        migrations.CreateModel(
            name="TeacherUiDismissal",
            fields=[
                ("id", models.BigAutoField(auto_created=True, primary_key=True, serialize=False, verbose_name="ID")),
                ("notice_key", models.CharField(choices=[("first_day_checklist", "Чеклист первого дня"), ("premium_trial_tutor_offer", "Баннер пробного Премиума")], max_length=64, verbose_name="Ключ")),
                ("dismissed_at", models.DateTimeField(auto_now_add=True, verbose_name="Скрыто")),
                ("user", models.ForeignKey(on_delete=models.deletion.CASCADE, related_name="ui_dismissals", to=settings.AUTH_USER_MODEL, verbose_name="Пользователь")),
            ],
            options={
                "verbose_name": "Скрытое уведомление кабинета",
                "verbose_name_plural": "Скрытые уведомления кабинета",
            },
        ),
        migrations.AddConstraint(
            model_name="teacheruidismissal",
            constraint=models.UniqueConstraint(fields=("user", "notice_key"), name="cab_ui_dismiss_user_key"),
        ),
    ]
