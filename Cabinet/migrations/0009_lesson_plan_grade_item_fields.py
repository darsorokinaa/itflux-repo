"""
Add missing fields to LessonPlan / LessonPlanItem:

LessonPlan
  + grade        (CharField, blank) — e.g. "9", "10", "11", "10–11"

LessonPlanItem
  + planned_results       (TextField, blank) — планируемые результаты урока
  + lesson_materials_notes (TextField, blank) — материалы на уроке (текстовые заметки)
"""

from django.db import migrations, models


class Migration(migrations.Migration):

    dependencies = [
        ("Cabinet", "0008_promo_codes"),
    ]

    operations = [
        # ── LessonPlan: Класс ────────────────────────────────────────────────
        migrations.AddField(
            model_name="lessonplan",
            name="grade",
            field=models.CharField(
                verbose_name="Класс",
                max_length=32,
                blank=True,
                help_text="Например: 9, 10, 11, 10–11",
            ),
        ),
        # ── LessonPlanItem: Планируемые результаты ───────────────────────────
        migrations.AddField(
            model_name="lessonplanitem",
            name="planned_results",
            field=models.TextField(
                verbose_name="Планируемые результаты",
                blank=True,
                help_text="Что ученик должен знать/уметь после этого занятия",
            ),
        ),
        # ── LessonPlanItem: Материалы на уроке (текстовые заметки) ──────────
        migrations.AddField(
            model_name="lessonplanitem",
            name="lesson_materials_notes",
            field=models.TextField(
                verbose_name="Материалы на уроке",
                blank=True,
                help_text="Описание материалов / ссылки / заметки для этого занятия",
            ),
        ),
    ]
