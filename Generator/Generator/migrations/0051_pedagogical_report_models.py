# -*- coding: utf-8 -*-
from django.db import migrations, models


def seed_pedagogical_content(apps, schema_editor):
    PedagogicalRecommendation = apps.get_model("Generator", "PedagogicalRecommendation")
    ReportConclusionTemplate = apps.get_model("Generator", "ReportConclusionTemplate")
    ReportNextStepTemplate = apps.get_model("Generator", "ReportNextStepTemplate")

    rows = [
        {
            "subtopic": "Перевод в десятичную систему",
            "short_recommendation": "Разобрать алгоритм перевода числа в десятичную систему и решить 3–5 базовых задач.",
            "detailed_recommendation": "Повторить разрядный способ перевода: каждую цифру умножать на степень основания и складывать результаты.",
            "next_lesson_action": "Начать занятие с 3 коротких примеров на перевод чисел в десятичную систему.",
        },
        {
            "subtopic": "Сравнение чисел в разных системах счисления",
            "short_recommendation": "Повторить сравнение чисел через перевод к одной системе счисления.",
            "detailed_recommendation": "Отработать правило: сначала привести числа к одной системе, затем сравнить значения.",
            "next_lesson_action": "Дать 3–4 пары чисел в разных системах и разобрать сравнение пошагово.",
        },
        {
            "subtopic": "Вычитание",
            "short_recommendation": "Отработать вычитание в недесятичных системах счисления.",
            "detailed_recommendation": "Повторить перенос разряда и отличие вычислений в двоичной, восьмеричной и шестнадцатеричной системах.",
            "next_lesson_action": "Решить несколько примеров на вычитание с подробной записью каждого шага.",
        },
        {
            "subtopic": "Истинные логические высказывания",
            "short_recommendation": "Повторить истинность и ложность простых логических высказываний.",
            "detailed_recommendation": "Разобрать, как определять истинность высказывания и работать с отрицанием.",
            "next_lesson_action": "Провести короткую разминку на определение истинных и ложных высказываний.",
        },
        {
            "subtopic": "Построение таблицы истинности",
            "topic": "Логика",
            "short_recommendation": "Разобрать таблицы истинности на 2 переменные и отработать заполнение таблиц.",
            "detailed_recommendation": "Повторить порядок строк 00, 01, 10, 11 и отдельно разобрать действия НЕ, И, ИЛИ.",
            "next_lesson_action": "Построить 2 таблицы истинности вместе с учеником и одну дать самостоятельно.",
        },
        {
            "subtopic": "Алгоритм - 6 команд",
            "skill_group": "Алгоритмы",
            "short_recommendation": "Повторить пошаговое выполнение алгоритма и отслеживание изменения состояний.",
            "detailed_recommendation": "Ученику нужно научиться выполнять команды последовательно и фиксировать промежуточный результат.",
            "next_lesson_action": "Разобрать один алгоритм пошагово в таблице состояний.",
        },
        {
            "subtopic": "Возвращение в ту же точку",
            "short_recommendation": "Отработать перемещение исполнителя по координатам и построение траектории.",
            "detailed_recommendation": "Повторить, как команды исполнителя изменяют положение точки на плоскости.",
            "next_lesson_action": "Построить 2–3 траектории исполнителя и проверить возвращение в исходную точку.",
        },
    ]
    for i, r in enumerate(rows):
        PedagogicalRecommendation.objects.get_or_create(
            subject="Информатика",
            exam_level="VPR",
            subtopic=r["subtopic"],
            defaults={
                "topic": r.get("topic", ""),
                "skill_group": r.get("skill_group", ""),
                "short_recommendation": r["short_recommendation"],
                "detailed_recommendation": r["detailed_recommendation"],
                "next_lesson_action": r["next_lesson_action"],
                "priority": 10 + i,
                "is_active": True,
            },
        )

    for rl, mn, mx, txt in [
        ("very_low", 0, 0, "{student_name} набрал {total_score} из {max_score} первичных баллов (около {percent}%). Пока нет верных ответов — важно начать с базовых тем."),
        ("low", 1, 39, "{student_name} набрал {total_score} из {max_score} первичных баллов, процент выполнения — {percent}%. Требуется систематическое повторение: {weak_topics}."),
        ("medium", 40, 69, "{student_name} набрал {total_score} из {max_score} первичных баллов ({percent}%). Результат средний; зоны роста: {weak_topics}."),
        ("high", 70, 100, "{student_name} набрал {total_score} из {max_score} первичных баллов ({percent}%). Сильный результат; закрепите темы коротким повторением."),
    ]:
        ReportConclusionTemplate.objects.get_or_create(
            subject="",
            exam_level="",
            result_level=rl,
            min_percent=mn,
            max_percent=mx,
            defaults={"text_template": txt, "priority": 50, "is_active": True},
        )

    for cond, texts in [
        ("default", ["Сверить ошибки с разбором по учебнику или конспекту.", "Отработать 2–3 задачи на слабые темы.", "Повторить вариант через несколько дней."]),
        ("many_skipped", ["Проверить, почему часть заданий без времени выполнения.", "Начать с тем, к которым не приступали.", "Дать мини-вариант на 3–4 задания."]),
        ("low_percent", ["Разобрать ошибки по каждой теме.", "Решить 2–3 задачи с пошаговым объяснением.", "Повторить мини-вариант."]),
        ("high_percent", ["Закрепить темы коротким повторением.", "Перейти к задачам повышенной сложности.", "Новый вариант для проверки устойчивости."]),
    ]:
        for j, t in enumerate(texts):
            ReportNextStepTemplate.objects.get_or_create(
                subject="",
                exam_level="",
                condition_type=cond,
                text=t,
                defaults={"priority": 100 + j, "is_active": True},
            )


def unseed_pedagogical_content(apps, schema_editor):
    PedagogicalRecommendation = apps.get_model("Generator", "PedagogicalRecommendation")
    ReportConclusionTemplate = apps.get_model("Generator", "ReportConclusionTemplate")
    ReportNextStepTemplate = apps.get_model("Generator", "ReportNextStepTemplate")
    PedagogicalRecommendation.objects.filter(subject="Информатика", exam_level="VPR").delete()
    ReportConclusionTemplate.objects.filter(subject="", exam_level="").delete()
    ReportNextStepTemplate.objects.filter(subject="", exam_level="").delete()


class Migration(migrations.Migration):

    dependencies = [
        ("Generator", "0050_enable_truth_table_vpr8_inf6_advanced"),
    ]

    operations = [
        migrations.CreateModel(
            name="PedagogicalRecommendation",
            fields=[
                ("id", models.BigAutoField(auto_created=True, primary_key=True, serialize=False, verbose_name="ID")),
                ("subject", models.CharField(max_length=100, verbose_name="Предмет")),
                (
                    "exam_level",
                    models.CharField(
                        choices=[("VPR", "ВПР"), ("OGE", "ОГЭ"), ("EGE", "ЕГЭ")],
                        max_length=10,
                        verbose_name="Уровень",
                    ),
                ),
                ("topic", models.CharField(blank=True, max_length=255, verbose_name="Тема")),
                ("subtopic", models.CharField(blank=True, max_length=255, verbose_name="Подтема")),
                ("skill_group", models.CharField(blank=True, max_length=255, verbose_name="Группа навыка")),
                ("short_recommendation", models.TextField(verbose_name="Краткая рекомендация")),
                ("detailed_recommendation", models.TextField(blank=True, verbose_name="Подробная рекомендация")),
                ("next_lesson_action", models.TextField(blank=True, verbose_name="Действие на следующее занятие")),
                ("student_hint", models.TextField(blank=True, verbose_name="Подсказка для ученика")),
                ("parent_hint", models.TextField(blank=True, verbose_name="Пояснение для родителя")),
                ("teacher_hint", models.TextField(blank=True, verbose_name="Комментарий для учителя")),
                ("priority", models.PositiveSmallIntegerField(default=100, verbose_name="Приоритет")),
                ("is_active", models.BooleanField(default=True, verbose_name="Активно")),
                ("created_at", models.DateTimeField(auto_now_add=True)),
                ("updated_at", models.DateTimeField(auto_now=True)),
            ],
            options={
                "verbose_name": "Педагогическая рекомендация",
                "verbose_name_plural": "Педагогические рекомендации",
            },
        ),
        migrations.CreateModel(
            name="ReportConclusionTemplate",
            fields=[
                ("id", models.BigAutoField(auto_created=True, primary_key=True, serialize=False, verbose_name="ID")),
                ("subject", models.CharField(blank=True, max_length=100, verbose_name="Предмет")),
                ("exam_level", models.CharField(blank=True, max_length=10, verbose_name="Уровень")),
                (
                    "result_level",
                    models.CharField(
                        choices=[
                            ("very_low", "Очень низкий"),
                            ("low", "Низкий"),
                            ("medium", "Средний"),
                            ("high", "Высокий"),
                        ],
                        max_length=20,
                        verbose_name="Уровень результата",
                    ),
                ),
                ("min_percent", models.PositiveSmallIntegerField(default=0, verbose_name="Минимальный процент")),
                ("max_percent", models.PositiveSmallIntegerField(default=100, verbose_name="Максимальный процент")),
                ("text_template", models.TextField(verbose_name="Шаблон вывода")),
                ("is_active", models.BooleanField(default=True, verbose_name="Активно")),
                ("priority", models.PositiveSmallIntegerField(default=100, verbose_name="Приоритет")),
                ("created_at", models.DateTimeField(auto_now_add=True)),
                ("updated_at", models.DateTimeField(auto_now=True)),
            ],
            options={
                "verbose_name": "Шаблон вывода отчёта",
                "verbose_name_plural": "Шаблоны выводов отчёта",
            },
        ),
        migrations.CreateModel(
            name="ReportNextStepTemplate",
            fields=[
                ("id", models.BigAutoField(auto_created=True, primary_key=True, serialize=False, verbose_name="ID")),
                ("subject", models.CharField(blank=True, max_length=100, verbose_name="Предмет")),
                ("exam_level", models.CharField(blank=True, max_length=10, verbose_name="Уровень")),
                (
                    "condition_type",
                    models.CharField(
                        choices=[
                            ("many_skipped", "Много пропущенных заданий"),
                            ("many_errors", "Много ошибок"),
                            ("low_percent", "Низкий процент"),
                            ("medium_percent", "Средний процент"),
                            ("high_percent", "Высокий процент"),
                            ("slow_first_task", "Долго решал первое задание"),
                            ("default", "По умолчанию"),
                        ],
                        max_length=50,
                        verbose_name="Условие",
                    ),
                ),
                ("text", models.TextField(verbose_name="Текст шага")),
                ("priority", models.PositiveSmallIntegerField(default=100, verbose_name="Приоритет")),
                ("is_active", models.BooleanField(default=True, verbose_name="Активно")),
                ("created_at", models.DateTimeField(auto_now_add=True)),
                ("updated_at", models.DateTimeField(auto_now=True)),
            ],
            options={
                "verbose_name": "Шаг «Что сделать дальше»",
                "verbose_name_plural": "Шаги «Что сделать дальше»",
            },
        ),
        migrations.AddIndex(
            model_name="pedagogicalrecommendation",
            index=models.Index(fields=["subject", "exam_level"], name="Generator_p_subject_2c69ec_idx"),
        ),
        migrations.AddIndex(
            model_name="pedagogicalrecommendation",
            index=models.Index(fields=["topic", "subtopic"], name="Generator_p_topic_ac5b48_idx"),
        ),
        migrations.AddIndex(
            model_name="pedagogicalrecommendation",
            index=models.Index(fields=["is_active"], name="Generator_p_is_acti_1e5f4c_idx"),
        ),
        migrations.AddIndex(
            model_name="reportconclusiontemplate",
            index=models.Index(fields=["result_level", "is_active"], name="Generator_r_result__6974bc_idx"),
        ),
        migrations.AddIndex(
            model_name="reportconclusiontemplate",
            index=models.Index(fields=["subject", "exam_level"], name="Generator_r_subject_4c8d2d_idx"),
        ),
        migrations.AddIndex(
            model_name="reportnextsteptemplate",
            index=models.Index(fields=["condition_type", "is_active"], name="Generator_r_conditi_0b9ed8_idx"),
        ),
        migrations.AddIndex(
            model_name="reportnextsteptemplate",
            index=models.Index(fields=["subject", "exam_level"], name="Generator_r_subject_ede847_idx"),
        ),
        migrations.RunPython(seed_pedagogical_content, unseed_pedagogical_content),
    ]
