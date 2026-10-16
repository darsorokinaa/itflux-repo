from django.conf import settings
from django.db import migrations, models
import django.db.models.deletion


class Migration(migrations.Migration):
    dependencies = [("Cabinet", "0123_schoolrequest"), migrations.swappable_dependency(settings.AUTH_USER_MODEL)]

    operations = [
        migrations.CreateModel(
            name="SocialAccount",
            fields=[
                ("id", models.BigAutoField(auto_created=True, primary_key=True, serialize=False, verbose_name="ID")),
                ("provider", models.CharField(choices=[("yandex", "Яндекс ID"), ("vk", "VK ID")], max_length=16, verbose_name="Провайдер")),
                ("uid", models.CharField(max_length=64, verbose_name="ID у провайдера")),
                ("email", models.EmailField(blank=True, max_length=254, verbose_name="Email у провайдера")),
                ("created_at", models.DateTimeField(auto_now_add=True, verbose_name="Привязан")),
                ("user", models.ForeignKey(on_delete=django.db.models.deletion.CASCADE, related_name="social_accounts", to=settings.AUTH_USER_MODEL)),
            ],
            options={"verbose_name": "Внешний вход", "verbose_name_plural": "Внешние входы",
                     "constraints": [models.UniqueConstraint(fields=("provider", "uid"), name="uniq_social_provider_uid")]},
        ),
    ]
