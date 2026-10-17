# r67: официальные шкалы перевода баллов и критерии оценивания (2026). Только данные.
#
# Шкалы (Generator_mark), загружены только там, где максимум варианта на платформе
# совпадает с официальным максимумом:
#   ЕГЭ информатика (29 перв.): таблица № 6 «Соответствие между первичными баллами и тестовыми
#   баллами ЕГЭ», решения комиссии Рособрнадзора от 30.03, 06.04, 10.04, 17.04.2026,
#   https://obrnadzor.gov.ru/wp-content/uploads/2026/04/tabliczy-sootvetstviya-pervichnyh-i-testovyh-ballov-ege.pdf
#   ОГЭ информатика (21 перв.): письмо Рособрнадзора от 18.02.2026 № 04-44, таблица 11,
#   https://doc.fipi.ru/oge/normativno-pravovye-dokumenty/04-44_18.02.2026.pdf
#
# Критерии (Generator_criteria), текст из демоверсий ФИПИ 2026:
#   ОГЭ информатика №16: https://doc.fipi.ru/oge/demoversii-specifikacii-kodifikatory/2026/inf_9_2026.zip
#     (три строки критериев №16 уже были в базе, но привязаны к №15; переносим их на №16)
#   ОГЭ математика №20–25: https://doc.fipi.ru/oge/demoversii-specifikacii-kodifikatory/2026/ma_9_2026.zip
#   ЕГЭ профильная математика (демо 2026 №13, 14, 17, 19 → номера платформы 14, 15, 18, 20 по структуре 2027):
#     https://doc.fipi.ru/ege/demoversii-specifikacii-kodifikatory/2026/ma_11_2026.zip
#
# Миграция идемпотентна (update_or_create / get_or_create по естественным ключам).

from django.db import migrations

EGE_INF_TEST = [0, 7, 14, 20, 27, 34, 40, 43, 46, 48, 51, 54, 56, 59, 62, 64, 67, 70, 72, 75,
                78, 80, 83, 85, 88, 90, 93, 95, 98, 100]

EGE_INF_COMMENTS = {
    1: "Ниже минимального балла ЕГЭ по информатике для поступления в вуз: 6 первичных = 40 тестовых (шкала Рособрнадзора 2026).",
    2: "Минимальный балл ЕГЭ по информатике для поступления в вуз: 6 первичных = 40 тестовых (шкала Рособрнадзора 2026).",
    3: "Выше минимального балла ЕГЭ по информатике (40 тестовых) (шкала Рособрнадзора 2026).",
    4: "Высокий результат: 21 первичный балл и выше = 80 тестовых и выше (шкала Рособрнадзора 2026).",
}

def _ege_inf_level(primary):
    if primary < 6:
        return 1
    if primary == 6:
        return 2
    if primary < 21:
        return 3
    return 4

# (минимальный первичный балл, отметка, mark_level, комментарий)
OGE_INF = [
    (0, 2, 1, "Отметка «2»: 0–4 первичных балла (рекомендации Рособрнадзора, письмо от 18.02.2026 № 04-44)."),
    (5, 3, 2, "Отметка «3»: 5–10 первичных баллов (рекомендации Рособрнадзора, письмо от 18.02.2026 № 04-44)."),
    (11, 4, 3, "Отметка «4»: 11–16 первичных баллов (рекомендации Рособрнадзора, письмо от 18.02.2026 № 04-44)."),
    (17, 5, 4, "Отметка «5»: 17–21 первичный балл (рекомендации Рособрнадзора, письмо от 18.02.2026 № 04-44)."),
]

ZERO = "<p>Решение не соответствует ни одному из критериев, перечисленных выше</p>"
ZERO_PRIV = "<p>Решение не соответствует ни одному из критериев, приведённых выше</p>"

# subject, level, task_number -> [(score, html)]
CRITERIA = {
    ("math", "oge", 20): [
        (2, "<p>Обоснованно получен верный ответ</p>"),
        (1, "<p>Решение доведено до конца, но допущены вычислительные ошибки, с их учётом дальнейшие шаги выполнены верно</p>"),
        (0, ZERO),
    ],
    ("math", "oge", 21): [
        (2, "<p>Ход решения задачи верный, получен верный ответ</p>"),
        (1, "<p>Верно составлена математическая модель задачи (в алгебраической или иной форме), однако решение до конца не доведено или содержит ошибки</p><p>ИЛИ</p><p>Решение в целом верное, но содержит несущественные недостатки или вычислительные ошибки</p>"),
        (0, ZERO),
    ],
    ("math", "oge", 22): [
        (2, "<p>График построен верно, верно найдены искомые значения параметра</p>"),
        (1, "<p>График построен верно, но искомые значения параметра найдены неверно или не найдены</p>"),
        (0, ZERO),
    ],
    ("math", "oge", 23): [
        (2, "<p>Ход решения верный, все его шаги выполнены правильно, получен верный ответ</p>"),
        (1, "<p>Решение в целом верное, но содержит несущественные недостатки или вычислительные ошибки</p>"),
        (0, ZERO),
    ],
    ("math", "oge", 24): [
        (2, "<p>Доказательство верное, все шаги обоснованы</p>"),
        (1, "<p>Доказательство в целом верное, но содержит несущественные недостатки</p>"),
        (0, ZERO),
    ],
    ("math", "oge", 25): [
        (2, "<p>Ход решения верный, получен верный ответ</p>"),
        (1, "<p>Решение в целом верное, но содержит несущественные недостатки или вычислительные ошибки</p>"),
        (0, ZERO),
    ],
    # ЕГЭ профиль: демо 2026 №13 (уравнение, пункты а и б)
    ("math", "ege", 14): [
        (2, "<p>Обоснованно получены верные ответы в обоих пунктах</p>"),
        (1, "<p>Обоснованно получен верный ответ в пункте а</p><p>ИЛИ</p><p>получены неверные ответы из-за вычислительной ошибки, но при этом имеется верная последовательность всех шагов решения обоих пунктов: пункта а и пункта б</p>"),
        (0, ZERO),
    ],
}

_PROOF_3 = [
    (3, "<p>Имеется верное доказательство утверждения пункта а и обоснованно получен верный ответ в пункте б</p>"),
    (2, "<p>Получен обоснованный ответ в пункте б</p><p>ИЛИ</p><p>имеется верное доказательство утверждения пункта а, но при обоснованном решении пункта б получен неверный ответ из-за арифметической ошибки</p>"),
    (1, "<p>Имеется верное доказательство утверждения пункта а,</p><p>ИЛИ</p><p>при обоснованном решении пункта б получен неверный ответ из-за арифметической ошибки,</p><p>ИЛИ</p><p>обоснованно получен верный ответ в пункте б с использованием утверждения пункта а, при этом пункт а не выполнен</p>"),
    (0, ZERO_PRIV),
]
# демо 2026 №14 (стереометрия) и №17 (планиметрия)
CRITERIA[("math", "ege", 15)] = _PROOF_3
CRITERIA[("math", "ege", 18)] = _PROOF_3
# демо 2026 №19 (числа и их свойства)
CRITERIA[("math", "ege", 20)] = [
    (4, "<p>Обоснованно получены верные ответы в пунктах а, б и в</p>"),
    (3, "<p>Обоснованно получен верный ответ в пункте в и обоснованно получен верный ответ в пункте а или б</p>"),
    (2, "<p>Обоснованно получены верные ответы в пунктах а и б</p><p>ИЛИ</p><p>обоснованно получен верный ответ в пункте в</p>"),
    (1, "<p>Обоснованно получен верный ответ в пункте а или б</p>"),
    (0, ZERO),
]


def _task_list(apps, subject, level, number):
    TaskList = apps.get_model("Generator", "TaskList")
    return TaskList.objects.filter(
        subject__subject_short=subject, level__level=level, task_number=number
    ).order_by("id").first()


def forwards(apps, schema_editor):
    Subject = apps.get_model("Generator", "Subject")
    Level = apps.get_model("Generator", "Level")
    Mark = apps.get_model("Generator", "Mark")
    MarkComment = apps.get_model("Generator", "MarkComment")
    Criteria = apps.get_model("Generator", "Criteria")

    inf = Subject.objects.filter(subject_short="inf").first()
    ege = Level.objects.filter(level="ege").first()
    oge = Level.objects.filter(level="oge").first()

    if inf and ege:
        comments = {}
        for lvl, text in EGE_INF_COMMENTS.items():
            comments[lvl], _ = MarkComment.objects.get_or_create(comment_text=text, defaults={"mark_level": lvl})
        for primary, test in enumerate(EGE_INF_TEST):
            Mark.objects.update_or_create(
                subject=inf, level=ege, score=primary,
                defaults={"score_exam": test, "comment": comments[_ege_inf_level(primary)]},
            )
    if inf and oge:
        for primary, grade, lvl, text in OGE_INF:
            comment, _ = MarkComment.objects.get_or_create(comment_text=text, defaults={"mark_level": lvl})
            Mark.objects.update_or_create(
                subject=inf, level=oge, score=primary,
                defaults={"score_exam": grade, "comment": comment},
            )

    # ОГЭ информатика: критерии №16 (программа, тесты) ошибочно привязаны к №15.
    tl15 = _task_list(apps, "inf", "oge", 15)
    tl16 = _task_list(apps, "inf", "oge", 16)
    if tl15 and tl16:
        Criteria.objects.filter(task_number=tl15, axis_code="", criteria_text__icontains="тест").update(task_number=tl16)

    for (subject, level, number), rows in CRITERIA.items():
        tl = _task_list(apps, subject, level, number)
        if tl is None:
            continue
        for score, text in rows:
            Criteria.objects.get_or_create(
                task_number=tl, axis_code="", criteria_score=score, criteria_text=text,
            )


def backwards(apps, schema_editor):
    Mark = apps.get_model("Generator", "Mark")
    MarkComment = apps.get_model("Generator", "MarkComment")
    Criteria = apps.get_model("Generator", "Criteria")
    texts = list(EGE_INF_COMMENTS.values()) + [row[3] for row in OGE_INF]
    Mark.objects.filter(subject__subject_short="inf", level__level__in=("ege", "oge")).delete()
    MarkComment.objects.filter(comment_text__in=texts).delete()
    tl15 = _task_list(apps, "inf", "oge", 15)
    tl16 = _task_list(apps, "inf", "oge", 16)
    if tl15 and tl16:
        Criteria.objects.filter(task_number=tl16, axis_code="", criteria_text__icontains="тест").update(task_number=tl15)
    for (subject, level, number), rows in CRITERIA.items():
        tl = _task_list(apps, subject, level, number)
        if tl is None:
            continue
        Criteria.objects.filter(task_number=tl, axis_code="", criteria_text__in=[t for _, t in rows]).delete()


class Migration(migrations.Migration):

    dependencies = [
        ("Generator", "0109_ege_inf_26_27_max_score_2"),
    ]

    operations = [
        migrations.RunPython(forwards, backwards),
    ]
