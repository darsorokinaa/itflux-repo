# r77: шкала ЕГЭ по математике профильного уровня 2026 (первичный → тестовый балл) — по решению
# владельца, с оговоркой о приблизительности.
#
# Источник — тот же документ, что для ЕГЭ информатики (0110) и базовой математики (0112):
#   решения комиссии Рособрнадзора от 30.03.2026 № 04-1/КИД, от 06.04.2026 № 04-2/КИД,
#   от 10.04.2026 № 04-3/КИД, от 17.04.2026 № 04-6/КИД, таблица № 6 (соответствие первичных
#   и тестовых баллов), таблицы № 1–2 (минимальный балл: 5 первичных = 27 тестовых):
#   https://obrnadzor.gov.ru/wp-content/uploads/2026/04/tabliczy-sootvetstviya-pervichnyh-i-testovyh-ballov-ege.pdf
#
# ОГОВОРКА: официальная шкала 2026 рассчитана на 32 первичных балла, а вариант платформы собран
# по структуре 2027 года (20 заданий, максимум 33). Первичный балл 33 приравнен к 100 тестовым —
# верхнему значению таблицы (кэп; в официальной таблице строки 33 нет). Перевод приблизительный;
# api_score_conversion отдаёт поле note с этой оговоркой (SCALE_NOTES в views.py). Когда появится
# официальная шкала под структуру 2027, заменить эту таблицу и убрать note.
#
# Только данные; идемпотентна (update_or_create); обратная операция удаляет строки ege/math.

from django.db import migrations

# индекс = первичный балл (0–32 — таблица № 6; 33 — кэп по верхнему значению)
EGE_MATH_TEST = [0, 6, 11, 17, 22, 27, 34, 40, 46, 52, 58, 64, 70, 72, 74, 76, 78, 80, 82, 84,
                 86, 88, 90, 92, 94, 95, 96, 97, 98, 99, 100, 100, 100, 100]

SRC = "шкала Рособрнадзора 2026, таблица № 6"
COMMENTS = {
    1: f"Ниже минимального балла ЕГЭ по профильной математике: 5 первичных = 27 тестовых ({SRC}).",
    2: f"Минимальный балл ЕГЭ по профильной математике: 5 первичных = 27 тестовых ({SRC}).",
    3: f"Выше минимального балла ЕГЭ по профильной математике (27 тестовых) ({SRC}).",
    4: f"Высокий результат: 12 первичных баллов и выше = 70 тестовых и выше ({SRC}).",
}


def _level(primary):
    if primary < 5:
        return 1
    if primary == 5:
        return 2
    if primary < 12:
        return 3
    return 4


def forwards(apps, schema_editor):
    Subject = apps.get_model("Generator", "Subject")
    Level = apps.get_model("Generator", "Level")
    Mark = apps.get_model("Generator", "Mark")
    MarkComment = apps.get_model("Generator", "MarkComment")
    sub = Subject.objects.filter(subject_short="math").first()
    lvl = Level.objects.filter(level="ege").first()
    if sub is None or lvl is None:
        return
    comments = {}
    for ml, text in COMMENTS.items():
        comments[ml], _ = MarkComment.objects.get_or_create(comment_text=text, defaults={"mark_level": ml})
    for primary, test in enumerate(EGE_MATH_TEST):
        Mark.objects.update_or_create(
            subject=sub, level=lvl, score=primary,
            defaults={"score_exam": test, "comment": comments[_level(primary)]},
        )


def backwards(apps, schema_editor):
    Mark = apps.get_model("Generator", "Mark")
    MarkComment = apps.get_model("Generator", "MarkComment")
    Mark.objects.filter(
        subject__subject_short="math", level__level="ege", score__in=range(len(EGE_MATH_TEST)),
    ).delete()
    MarkComment.objects.filter(comment_text__in=list(COMMENTS.values())).delete()


class Migration(migrations.Migration):
    dependencies = [
        ("Generator", "0112_r76_ege_math_base_marks_2026"),
    ]

    operations = [
        migrations.RunPython(forwards, backwards),
    ]
