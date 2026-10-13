from django.db import migrations, models
import django.db.models.deletion


class Migration(migrations.Migration):

    dependencies = [
        ("Cabinet", "0120_meeting_call_route"),
    ]

    operations = [
        migrations.CreateModel(
            name="KonturTalkRoom",
            fields=[
                ("id", models.BigAutoField(auto_created=True, primary_key=True, serialize=False, verbose_name="ID")),
                ("room_name", models.CharField(max_length=64, unique=True, verbose_name="Имя комнаты")),
                (
                    "provisioned_at",
                    models.DateTimeField(blank=True, null=True, verbose_name="Создана в Контур.Толк"),
                ),
                ("created_at", models.DateTimeField(auto_now_add=True)),
                ("updated_at", models.DateTimeField(auto_now=True)),
                (
                    "meeting",
                    models.OneToOneField(
                        on_delete=django.db.models.deletion.CASCADE,
                        related_name="kontur_talk_room",
                        to="Cabinet.videomeeting",
                        verbose_name="Видеоконференция",
                    ),
                ),
            ],
            options={
                "verbose_name": "Комната Контур.Толк",
                "verbose_name_plural": "Комнаты Контур.Толк",
            },
        ),
    ]
