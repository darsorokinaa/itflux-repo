# r76: официальная шкала ЕГЭ по математике базового уровня 2026 (первичный балл → отметка «2»–«5»).
#
# Источник — тот же документ, что и для шкалы ЕГЭ по информатике (миграция 0110):
#   «Установлены решениями комиссии Рособрнадзора по установлению соответствия между первичными
#   баллами и тестовыми баллами ЕГЭ … в 2026 году от 30.03.2026 № 04-1/КИД, от 06.04.2026
#   № 04-2/КИД, от 10.04.2026 № 04-3/КИД, от 17.04.2026 № 04-6/КИД», таблица № 5
#   «Соответствие между первичными баллами и отметками по пятибалльной системе оценивания
#   по математике базового уровня»:
#   https://obrnadzor.gov.ru/wp-content/uploads/2026/04/tabliczy-sootvetstviya-pervichnyh-i-testovyh-ballov-ege.pdf
#   «2» — 0–6, «3» — 7–11, «4» — 12–16, «5» — 17–21 (максимум 21, таблица № 1: ПБmax = 21).
#
# Профильная математика НЕ загружается: официальная шкала 2026 рассчитана на 32 первичных балла
# (таблица № 1, ПБmax = 32), а вариант платформы собран по структуре 2027 — 20 заданий, 33 балла.
#
# Хранение как у ОГЭ: строка Mark = нижняя граница отметки (score — минимальный первичный балл,
# score_exam — отметка). api_score_conversion для ege/math_base отдаёт scale="mark".
# Только данные; идемпотентна; обратная операция удаляет эти строки.

from django.db import migrations

SOURCE = (
    "таблица № 5, решения комиссии Рособрнадзора от 30.03.2026 № 04-1/КИД, 06.04.2026 № 04-2/КИД, "
    "10.04.2026 № 04-3/КИД, 17.04.2026 № 04-6/КИД"
)
# (минимальный первичный балл, отметка, mark_level, комментарий)
EGE_MATH_BASE = [
    (0, 2, 1, f"Отметка «2»: 0–6 первичных баллов, аттестат не подтверждён ({SOURCE})."),
    (7, 3, 2, f"Отметка «3»: 7–11 первичных баллов — минимальный результат ЕГЭ по базовой математике ({SOURCE})."),
    (12, 4, 3, f"Отметка «4»: 12–16 первичных баллов ({SOURCE})."),
    (17, 5, 4, f"Отметка «5»: 17–21 первичный балл ({SOURCE})."),
]


def forwards(apps, schema_editor):
    Subject = apps.get_model("Generator", "Subject")
    Level = apps.get_model("Generator", "Level")
    Mark = apps.get_model("Generator", "Mark")
    MarkComment = apps.get_model("Generator", "MarkComment")
    sub = Subject.objects.filter(subject_short="math_base").first()
    lvl = Level.objects.filter(level="ege").first()
    if sub is None or lvl is None:
        return
    for primary, grade, mark_level, text in EGE_MATH_BASE:
        comment, _ = MarkComment.objects.get_or_create(comment_text=text, defaults={"mark_level": mark_level})
        Mark.objects.update_or_create(
            subject=sub, level=lvl, score=primary,
            defaults={"score_exam": grade, "comment": comment},
        )


def backwards(apps, schema_editor):
    Mark = apps.get_model("Generator", "Mark")
    MarkComment = apps.get_model("Generator", "MarkComment")
    texts = [row[3] for row in EGE_MATH_BASE]
    Mark.objects.filter(
        subject__subject_short="math_base", level__level="ege",
        score__in=[row[0] for row in EGE_MATH_BASE],
    ).delete()
    MarkComment.objects.filter(comment_text__in=texts).delete()


class Migration(migrations.Migration):
    dependencies = [
        ("Generator", "0111_r68_official_maxima_scales_criteria"),
    ]

    operations = [
        migrations.RunPython(forwards, backwards),
    ]
