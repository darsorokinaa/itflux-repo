from django.db import migrations, models


class Migration(migrations.Migration):

    dependencies = [
        ("Generator", "0033_announcement_theme_worksheet_bg"),
    ]

    operations = [
        migrations.CreateModel(
            name="ErrorReport",
            fields=[
                ("id", models.AutoField(auto_created=True, primary_key=True, serialize=False, verbose_name="ID")),
                ("subject", models.CharField(max_length=50, verbose_name="Предмет")),
                ("level", models.CharField(max_length=10, verbose_name="Уровень")),
                ("task_number", models.IntegerField(blank=True, null=True, verbose_name="Номер задания")),
                ("task_id", models.IntegerField(blank=True, null=True, verbose_name="ID задачи")),
                ("variant_id", models.IntegerField(blank=True, null=True, verbose_name="ID варианта")),
                ("error_type", models.CharField(
                    choices=[
                        ("typo", "Опечатка"),
                        ("wrong_condition", "Неверное условие"),
                        ("wrong_answer", "Не сходится ответ"),
                        ("other", "Другое"),
                    ],
                    max_length=30,
                    verbose_name="Тип ошибки",
                )),
                ("comment", models.TextField(blank=True, default="", verbose_name="Комментарий")),
                ("created_at", models.DateTimeField(auto_now_add=True, verbose_name="Дата отправки")),
                ("is_fixed", models.BooleanField(default=False, verbose_name="Исправлено")),
                ("digest_sent", models.BooleanField(default=False, verbose_name="Отправлено в дайджест")),
            ],
            options={
                "verbose_name": "Сообщение об ошибке",
                "verbose_name_plural": "Сообщения об ошибках",
                "ordering": ["-created_at"],
            },
        ),
    ]
