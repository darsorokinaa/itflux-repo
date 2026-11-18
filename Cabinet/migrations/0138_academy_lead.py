from django.db import migrations, models


class Migration(migrations.Migration):

    dependencies = [
        ("Cabinet", "0137_storefront_funnel_events"),
    ]

    operations = [
        migrations.CreateModel(
            name="AcademyLead",
            fields=[
                ("id", models.BigAutoField(auto_created=True, primary_key=True, serialize=False, verbose_name="ID")),
                ("student_name", models.CharField(max_length=200, verbose_name="Имя ученика")),
                ("parent_name", models.CharField(blank=True, default="", max_length=200, verbose_name="Имя родителя")),
                ("grade", models.PositiveSmallIntegerField(choices=[(9, "9"), (10, "10"), (11, "11")], db_index=True, verbose_name="Класс")),
                ("subject", models.CharField(choices=[("oge_inf", "ОГЭ информатика"), ("ege_inf", "ЕГЭ информатика"), ("ege_math", "ЕГЭ профильная математика")], db_index=True, max_length=16, verbose_name="Предмет")),
                ("contact", models.CharField(max_length=80, verbose_name="Контакт")),
                ("comment", models.TextField(blank=True, default="", verbose_name="Комментарий")),
                ("consent", models.BooleanField(default=False, verbose_name="Согласие на обработку ПД")),
                ("consent_at", models.DateTimeField(verbose_name="Время согласия")),
                ("consent_text_version", models.CharField(max_length=64, verbose_name="Версия текста согласия")),
                ("status", models.CharField(choices=[("new", "новая"), ("contacted", "связались"), ("diagnostic_scheduled", "диагностика назначена"), ("enrolled", "записался"), ("declined", "отказ")], db_index=True, default="new", max_length=32, verbose_name="Статус")),
                ("notes", models.TextField(blank=True, default="", verbose_name="Заметки")),
                ("utm_source", models.CharField(blank=True, default="", max_length=32)),
                ("utm_medium", models.CharField(blank=True, default="", max_length=32)),
                ("utm_campaign", models.CharField(blank=True, default="", max_length=64)),
                ("utm_content", models.CharField(blank=True, default="", max_length=64)),
                ("utm_term", models.CharField(blank=True, default="", max_length=64)),
                ("referrer", models.CharField(blank=True, default="", max_length=500, verbose_name="Реферер")),
                ("ip_hash", models.CharField(blank=True, default="", max_length=64, verbose_name="Хеш IP")),
                ("created_at", models.DateTimeField(auto_now_add=True, verbose_name="Создана")),
                ("updated_at", models.DateTimeField(auto_now=True, verbose_name="Обновлена")),
            ],
            options={
                "verbose_name": "Заявка академии",
                "verbose_name_plural": "Заявки академии",
                "ordering": ("-created_at",),
                "constraints": [
                    models.CheckConstraint(
                        condition=models.Q(
                            models.Q(("grade", 9), ("subject", "oge_inf")),
                            models.Q(("grade__in", [10, 11]), ("subject__in", ["ege_inf", "ege_math"])),
                            _connector="OR",
                        ),
                        name="academy_lead_grade_subject",
                    )
                ],
            },
        ),
    ]
