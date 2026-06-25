from django.db import migrations, models
import django.db.models.deletion


class Migration(migrations.Migration):

    dependencies = [
        ("Cabinet", "0016_interactive_background_image"),
    ]

    operations = [
        migrations.AlterField(
            model_name="interactive",
            name="interactive_type",
            field=models.CharField(
                choices=[
                    ("flashcards", "Карточки"),
                    ("matching", "Сопоставление"),
                    ("ordering", "Собери порядок"),
                    ("quiz", "Викторина"),
                ],
                max_length=20,
                verbose_name="Тип",
            ),
        ),
        migrations.CreateModel(
            name="QuizQuestion",
            fields=[
                ("id", models.BigAutoField(auto_created=True, primary_key=True, serialize=False, verbose_name="ID")),
                ("question_text", models.TextField(verbose_name="Вопрос")),
                (
                    "answers",
                    models.JSONField(
                        blank=True,
                        default=list,
                        help_text='[{"id": "a1", "text": "...", "is_correct": true}]',
                        verbose_name="Варианты ответов",
                    ),
                ),
                (
                    "answer_type",
                    models.CharField(
                        choices=[("single", "Один правильный"), ("multiple", "Несколько правильных")],
                        default="single",
                        max_length=10,
                        verbose_name="Тип ответа",
                    ),
                ),
                ("explanation", models.TextField(blank=True, verbose_name="Пояснение")),
                ("points", models.PositiveSmallIntegerField(default=1, verbose_name="Баллы")),
                ("order", models.PositiveIntegerField(default=0, verbose_name="Порядок")),
                (
                    "interactive",
                    models.ForeignKey(
                        on_delete=django.db.models.deletion.CASCADE,
                        related_name="quiz_questions",
                        to="Cabinet.interactive",
                        verbose_name="Интерактив",
                    ),
                ),
            ],
            options={
                "verbose_name": "Вопрос викторины",
                "verbose_name_plural": "Вопросы викторины",
                "ordering": ["order", "id"],
            },
        ),
    ]
