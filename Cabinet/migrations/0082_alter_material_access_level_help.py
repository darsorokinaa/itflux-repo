from django.db import migrations, models


class Migration(migrations.Migration):

    dependencies = [
        ("Cabinet", "0081_material_entitlement_access"),
    ]

    operations = [
        migrations.AlterField(
            model_name="material",
            name="access_level",
            field=models.CharField(
                choices=[
                    ("free", "Бесплатно"),
                    ("teacher", "Учитель"),
                    ("professional", "Профи"),
                    ("premium", "Премиум"),
                    ("corporate", "Корпоративный"),
                ],
                db_index=True,
                default="free",
                help_text="Минимальный тариф: бесплатно после регистрации (Старт), Учитель, Профи, Премиум.",
                max_length=20,
                verbose_name="Уровень доступа",
            ),
        ),
    ]
