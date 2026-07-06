from django.db import migrations, models


class Migration(migrations.Migration):
    dependencies = [
        ("Cabinet", "0021_lessonplan_subject"),
    ]

    operations = [
        migrations.AddField(
            model_name="flashcarditem",
            name="back_image_url",
            field=models.URLField(blank=True, default="", max_length=1000, verbose_name="Картинка на обратной стороне"),
        ),
        migrations.AddField(
            model_name="flashcarditem",
            name="front_image_url",
            field=models.URLField(blank=True, default="", max_length=1000, verbose_name="Картинка на лицевой стороне"),
        ),
        migrations.AddField(
            model_name="matchingpair",
            name="left_image_url",
            field=models.URLField(blank=True, default="", max_length=1000, verbose_name="Картинка слева"),
        ),
        migrations.AddField(
            model_name="matchingpair",
            name="right_image_url",
            field=models.URLField(blank=True, default="", max_length=1000, verbose_name="Картинка справа"),
        ),
        migrations.AddField(
            model_name="orderingitem",
            name="image_url",
            field=models.URLField(blank=True, default="", max_length=1000, verbose_name="Картинка"),
        ),
        migrations.AddField(
            model_name="quizquestion",
            name="image_url",
            field=models.URLField(blank=True, default="", max_length=1000, verbose_name="Картинка вопроса"),
        ),
    ]
