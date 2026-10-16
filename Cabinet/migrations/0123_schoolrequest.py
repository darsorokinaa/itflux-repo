from django.db import migrations, models


class Migration(migrations.Migration):
    dependencies = [("Cabinet", "0122_homework_auto_issue_block")]

    operations = [
        migrations.CreateModel(
            name="SchoolRequest",
            fields=[
                ("id", models.BigAutoField(auto_created=True, primary_key=True, serialize=False, verbose_name="ID")),
                ("name", models.CharField(max_length=200, verbose_name="Имя")),
                ("school", models.CharField(max_length=300, verbose_name="Школа / организация")),
                ("role", models.CharField(blank=True, max_length=120, verbose_name="Должность / роль")),
                ("phone", models.CharField(blank=True, max_length=64, verbose_name="Телефон")),
                ("email", models.EmailField(blank=True, max_length=254, verbose_name="Email")),
                ("message", models.TextField(blank=True, verbose_name="Сообщение")),
                ("consent", models.BooleanField(default=False, verbose_name="Согласие на обработку ПД")),
                ("status", models.CharField(choices=[("new", "Новая"), ("in_progress", "В работе"), ("done", "Обработана"), ("spam", "Спам")], default="new", max_length=20, verbose_name="Статус")),
                ("admin_note", models.TextField(blank=True, verbose_name="Заметка администратора")),
                ("ip_address", models.GenericIPAddressField(blank=True, null=True, verbose_name="IP")),
                ("user_agent", models.CharField(blank=True, max_length=512, verbose_name="User-Agent")),
                ("created_at", models.DateTimeField(auto_now_add=True, verbose_name="Создана")),
                ("updated_at", models.DateTimeField(auto_now=True, verbose_name="Обновлена")),
            ],
            options={"verbose_name": "Заявка от школы", "verbose_name_plural": "Заявки от школ", "ordering": ("-created_at",)},
        ),
    ]
