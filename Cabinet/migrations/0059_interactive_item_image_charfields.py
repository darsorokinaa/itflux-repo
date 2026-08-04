# Generated manually — safe AlterField: URLField → CharField (same varchar storage).
# Relative /media/... upload URLs must be accepted when saving interactive items.

from django.db import migrations, models


class Migration(migrations.Migration):

    dependencies = [
        ("Cabinet", "0058_grant_pro_registration_promo"),
    ]

    operations = [
        migrations.AlterField(
            model_name="flashcarditem",
            name="front_image_url",
            field=models.CharField(
                blank=True,
                default="",
                max_length=1000,
                verbose_name="Картинка на лицевой стороне",
            ),
        ),
        migrations.AlterField(
            model_name="flashcarditem",
            name="back_image_url",
            field=models.CharField(
                blank=True,
                default="",
                max_length=1000,
                verbose_name="Картинка на обратной стороне",
            ),
        ),
        migrations.AlterField(
            model_name="matchingpair",
            name="left_image_url",
            field=models.CharField(
                blank=True,
                default="",
                max_length=1000,
                verbose_name="Картинка слева",
            ),
        ),
        migrations.AlterField(
            model_name="matchingpair",
            name="right_image_url",
            field=models.CharField(
                blank=True,
                default="",
                max_length=1000,
                verbose_name="Картинка справа",
            ),
        ),
        migrations.AlterField(
            model_name="orderingitem",
            name="image_url",
            field=models.CharField(
                blank=True,
                default="",
                max_length=1000,
                verbose_name="Картинка",
            ),
        ),
        migrations.AlterField(
            model_name="quizquestion",
            name="image_url",
            field=models.CharField(
                blank=True,
                default="",
                max_length=1000,
                verbose_name="Картинка вопроса",
            ),
        ),
    ]
