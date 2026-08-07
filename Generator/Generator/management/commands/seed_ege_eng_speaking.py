"""Сид устной части ЕГЭ по английскому (демо-КИМ 2026): TaskList, Criteria, тестовые Task."""

from __future__ import annotations

from django.core.management.base import BaseCommand
from django.db import transaction

from Generator.models import Criteria, Level, Part, Subject, Task, TaskList, Variant, VariantContent

SUBJECT_SHORT = "eng"
SUBJECT_NAME = "Английский язык"
LEVEL = "ege"
PART_TITLE = "Говорение"
# Старое имя сида — переносим TaskList на «Говорение».
LEGACY_PART_TITLES = ("Часть 3", "Часть 4", "Устная часть")


def _upsert_level_row(axis_meta: dict, score: int, text: str, task_list: TaskList) -> Criteria:
    obj, created = Criteria.objects.get_or_create(
        task_number=task_list,
        axis_code=axis_meta["code"],
        criteria_score=score,
        defaults={
            "criteria_text": f"<p>{text}</p>",
            "axis_title": axis_meta["title"],
            "axis_order": axis_meta["order"],
            "axis_max": axis_meta["max"],
            "is_gate": axis_meta.get("is_gate", False),
        },
    )
    if not created:
        obj.criteria_text = f"<p>{text}</p>"
        obj.axis_title = axis_meta["title"]
        obj.axis_order = axis_meta["order"]
        obj.axis_max = axis_meta["max"]
        obj.is_gate = axis_meta.get("is_gate", False)
        obj.save()
    return obj


def _seed_task1(tl: TaskList) -> None:
    axis = {
        "code": "phonetics",
        "title": "Фонетическая сторона речи",
        "order": 1,
        "max": 1,
    }
    _upsert_level_row(
        axis,
        1,
        "Речь воспринимается легко: необоснованные паузы отсутствуют; "
        "фразовое ударение и интонационные контуры, произношение слов — без нарушений нормы; "
        "допускается не более 5 фонетических ошибок, в том числе 1–2 ошибки, искажающие смысл.",
        tl,
    )
    _upsert_level_row(
        axis,
        0,
        "Речь воспринимается с трудом из-за большого количества неестественных пауз, запинок, "
        "неверной расстановки ударений и ошибок в произношении слов, "
        "ИЛИ сделано более 5 фонетических ошибок, "
        "ИЛИ сделано 3 и более фонетические ошибки, искажающие смысл.",
        tl,
    )


def _seed_binary_axes(tl: TaskList, *, prefix: str, count: int, title_tpl: str, text_1: str, text_0: str) -> None:
    for i in range(1, count + 1):
        axis = {
            "code": f"{prefix}{i}",
            "title": title_tpl.format(i=i),
            "order": i,
            "max": 1,
        }
        _upsert_level_row(axis, 1, text_1, tl)
        _upsert_level_row(axis, 0, text_0, tl)


def _seed_task2(tl: TaskList) -> None:
    _seed_binary_axes(
        tl,
        prefix="q",
        count=4,
        title_tpl="Вопрос {i}",
        text_1=(
            "Вопрос по содержанию отвечает поставленной задаче, имеет правильную грамматическую "
            "форму прямого вопроса; возможные фонетические и лексические погрешности не затрудняют восприятия."
        ),
        text_0=(
            "Вопрос не задан, или заданный вопрос по содержанию не отвечает поставленной задаче "
            "И/ИЛИ не имеет правильной грамматической формы прямого вопроса, "
            "И/ИЛИ фонетические и лексические ошибки препятствуют коммуникации."
        ),
    )


def _seed_task3(tl: TaskList) -> None:
    _seed_binary_axes(
        tl,
        prefix="a",
        count=5,
        title_tpl="Ответ {i}",
        text_1=(
            "Дан полный и точный ответ на запрос информации: 2–3 коммуникативно обусловленные фразы, "
            "в которых отсутствуют элементарные лексико-грамматические и/или фонетические ошибки."
        ),
        text_0=(
            "Ответ на вопрос не дан, ИЛИ содержание ответа не соответствует запросу информации, "
            "ИЛИ ответ содержит менее 2 фраз, ИЛИ в ответе имеются элементарные "
            "лексико-грамматические И/ИЛИ фонетические ошибки (в том числе, когда ответ носит характер набора слов)."
        ),
    )


def _seed_task4(tl: TaskList) -> None:
    content = {
        "code": "content",
        "title": "Решение коммуникативной задачи",
        "order": 1,
        "max": 4,
    }
    organization = {
        "code": "organization",
        "title": "Организация высказывания",
        "order": 2,
        "max": 3,
    }
    language = {
        "code": "language",
        "title": "Языковое оформление высказывания",
        "order": 3,
        "max": 3,
    }

    content_levels = {
        4: (
            "Коммуникативная задача выполнена полностью — содержание полно, точно и развёрнуто "
            "отражает все аспекты, указанные в задании (12–15 фраз)."
        ),
        3: (
            "Коммуникативная задача выполнена в основном: 1 аспект не раскрыт (остальные раскрыты полно) "
            "ИЛИ 1–2 аспекта раскрыты неполно/неточно (12–15 фраз)."
        ),
        2: (
            "Коммуникативная задача выполнена не полностью: 1 аспект не раскрыт и 1 раскрыт неполно/неточно "
            "ИЛИ 3 аспекта раскрыты неполно/неточно (10–11 фраз)."
        ),
        1: (
            "Коммуникативная задача выполнена частично: 1 аспект содержания не раскрыт и 2 раскрыты "
            "неполно/неточно, ИЛИ 2 аспекта не раскрыты (остальные раскрыты полно), "
            "ИЛИ все аспекты раскрыты неполно/неточно (8–9 фраз)."
        ),
        0: (
            "Коммуникативная задача выполнена менее чем на 50 %: 3 или более аспекта содержания не раскрыты, "
            "ИЛИ 2 аспекта не раскрыты и 1 и более раскрыты неполно/неточно, "
            "ИЛИ 1 аспект не раскрыт и остальные раскрыты неполно/неточно, "
            "ИЛИ объём высказывания — 7 и менее фраз. "
            "При 0 по этому критерию всё задание оценивается в 0 баллов."
        ),
    }
    for score, text in content_levels.items():
        _upsert_level_row(content, score, text, tl)

    org_levels = {
        3: (
            "Высказывание логично; имеет завершённый характер (есть вступительная с обращением к другу "
            "И заключительная фразы); средства логической связи используются правильно. "
            "Допускается 1 ошибка в логичности / средствах логической связи."
        ),
        2: (
            "Высказывание в основном логично и имеет достаточно завершённый характер "
            "(есть вступительная фраза с обращением к другу И заключительная фраза), "
            "имеются 2–3 ошибки в логичности / средствах логической связи."
        ),
        1: (
            "Высказывание не имеет завершённого характера: отсутствует вступительная ИЛИ заключительная фраза, "
            "И/ИЛИ имеются 4–5 ошибок в логичности / средствах логической связи."
        ),
        0: (
            "Высказывание не имеет завершённого характера: отсутствуют вступительная И заключительная фразы "
            "И/ИЛИ имеются 6 и более ошибок в логичности / средствах логической связи."
        ),
    }
    for score, text in org_levels.items():
        _upsert_level_row(organization, score, text, tl)

    lang_levels = {
        3: (
            "Используемый словарный запас, грамматические структуры, фонетическое оформление высказывания "
            "соответствуют поставленной задаче (допускается не более 3 негрубых лексико-грамматических ошибок "
            "И/ИЛИ не более 3 негрубых фонетических ошибок)."
        ),
        2: (
            "Используемый словарный запас, грамматические структуры, фонетическое оформление высказывания "
            "в основном соответствуют поставленной задаче (допускается не более 4–5 лексико-грамматических "
            "(из них не более 2 грубых) И/ИЛИ не более 4–5 фонетических ошибок (из них не более 2 грубых))."
        ),
        1: (
            "Языковое оформление частично соответствует поставленной задаче (допускается не более 6–7 "
            "лексико-грамматических (из них не более 3 грубых) И/ИЛИ не более 6–7 фонетических ошибок "
            "(из них не более 3 грубых))."
        ),
        0: (
            "Понимание высказывания затруднено из-за многочисленных ошибок "
            "(8 и более лексико-грамматических ошибок ИЛИ 4 и более грубых лексико-грамматических ошибок "
            "И/ИЛИ 8 и более фонетических ошибок ИЛИ 4 и более грубых фонетических ошибок) "
            "ИЛИ ответ носит характер набора слов."
        ),
    }
    for score, text in lang_levels.items():
        _upsert_level_row(language, score, text, tl)


TASK_SPECS = (
    {
        "number": 1,
        "title": "Чтение текста вслух",
        "max_score": 1,
        "seed_criteria": _seed_task1,
        "template": (
            "<p><strong>Task 1.</strong> Imagine that you are preparing a project with your friend. "
            "You have found some interesting material for the presentation and you want to read this "
            "text to your friend. You have 1.5 minutes to read the text silently, then be ready to "
            "read it out aloud. You will not have more than 1.5 minutes to read it.</p>"
            "<p>Snowflakes are ice crystals which fall through the Earth’s atmosphere as snow. "
            "People like to think that every snowflake has a unique shape. However, it’s not true. "
            "While snowflakes may look different, they can still be classified into eight groups "
            "and about eighty different variants…</p>"
        ),
    },
    {
        "number": 2,
        "title": "Условный диалог-расспрос",
        "max_score": 4,
        "seed_criteria": _seed_task2,
        "template": (
            "<p><strong>Task 2.</strong> Study the advertisement. You are going to ask four direct questions "
            "based on the key words. You have 1.5 minutes to think over your questions.</p>"
            "<p><em>Demo placeholder:</em> ask about price, location, opening hours and age restrictions.</p>"
        ),
    },
    {
        "number": 3,
        "title": "Интервью",
        "max_score": 5,
        "seed_criteria": _seed_task3,
        "template": (
            "<p><strong>Task 3.</strong> You are going to take part in an interview. "
            "Give full and accurate answers to five questions (2–3 communicative phrases each).</p>"
            "<p><em>Demo placeholder:</em> topic — free-time activities and hobbies.</p>"
        ),
    },
    {
        "number": 4,
        "title": "Проектная работа (выбор иллюстраций)",
        "max_score": 10,
        "seed_criteria": _seed_task4,
        "template": (
            "<p><strong>Task 4.</strong> Imagine that you and your friend are doing a school project "
            "“Ideal weekend”. You have found some photos to illustrate it but for technical reasons "
            "you cannot send them now. Leave a voice message to your friend explaining your choice "
            "of the photos and sharing some ideas about the project.</p>"
            "<p>In 2.5 minutes be ready to:</p>"
            "<ul>"
            "<li>explain the choice of the illustrations for the project by briefly describing them "
            "and noting the differences;</li>"
            "<li>mention the advantages (1–2) of the two ways to spend the weekend;</li>"
            "<li>mention the disadvantages (1–2) of the two ways to spend the weekend;</li>"
            "<li>express your opinion on the subject of the project — say which way of spending "
            "the weekend presented in the pictures you prefer and why.</li>"
            "</ul>"
            "<p>You will speak for not more than 3 minutes (12–15 sentences). You have to talk continuously.</p>"
        ),
    },
)


class Command(BaseCommand):
    help = "Сидит устную часть ЕГЭ eng: TaskList 1–4, критерии осей, тесто-задания"

    def add_arguments(self, parser):
        parser.add_argument(
            "--with-demo-variant",
            action="store_true",
            help="Создать Variant с 4 демо-заданиями для локальной проверки UI",
        )

    @transaction.atomic
    def handle(self, *args, **options):
        subject, _ = Subject.objects.get_or_create(
            subject_short=SUBJECT_SHORT,
            defaults={"subject_name": SUBJECT_NAME},
        )
        if subject.subject_name != SUBJECT_NAME:
            subject.subject_name = SUBJECT_NAME
            subject.save(update_fields=["subject_name"])

        level, _ = Level.objects.get_or_create(level=LEVEL, defaults={"level_rus": "ЕГЭ"})
        part, _ = Part.objects.get_or_create(part_title=PART_TITLE)

        # Перенос с ошибочных «Часть 3/4» → «Говорение» (критерии как у части 2).
        moved = (
            TaskList.objects.filter(
                subject=subject,
                level=level,
                part__part_title__in=LEGACY_PART_TITLES,
            )
            .exclude(part=part)
            .update(part=part)
        )
        if moved:
            self.stdout.write(self.style.WARNING(f"Moved {moved} TaskList(s) → «{PART_TITLE}»"))

        created_tls = 0
        created_tasks = 0
        demo_tasks = []

        for spec in TASK_SPECS:
            tl, tl_created = TaskList.objects.get_or_create(
                subject=subject,
                level=level,
                task_number=spec["number"],
                defaults={
                    "part": part,
                    "task_title": spec["title"],
                    "max_score": spec["max_score"],
                },
            )
            if tl_created:
                created_tls += 1
            else:
                tl.part = part
                tl.task_title = spec["title"]
                tl.max_score = spec["max_score"]
                tl.save()

            # Удаляем старые single-критерии без оси для этих TaskList (чистый сид осей).
            Criteria.objects.filter(task_number=tl, axis_code="").delete()
            spec["seed_criteria"](tl)

            task = (
                Task.objects.filter(task=tl, created_by="SEED_ENG_SPEAKING", is_active=True)
                .order_by("id")
                .first()
            )
            if not task:
                task = Task.objects.create(
                    task=tl,
                    quick_level=level,
                    task_template=spec["template"],
                    answer="",
                    max_score=spec["max_score"],
                    created_by="SEED_ENG_SPEAKING",
                    is_active=True,
                    author="ФИПИ · демо 2026",
                )
                created_tasks += 1
            else:
                task.task_template = spec["template"]
                task.max_score = spec["max_score"]
                task.quick_level = level
                task.save()
            demo_tasks.append(task)

        criteria_count = Criteria.objects.filter(task_number__subject=subject, task_number__level=level).count()
        self.stdout.write(
            self.style.SUCCESS(
                f"eng/ege speaking: TaskList +{created_tls}, Tasks +{created_tasks}, "
                f"Criteria total={criteria_count}"
            )
        )

        if options.get("with_demo_variant"):
            variant = (
                Variant.objects.filter(
                    var_subject=subject,
                    level=level,
                    created_by="SEED_ENG_SPEAKING",
                )
                .order_by("-id")
                .first()
            )
            if not variant:
                variant = Variant.objects.create(
                    var_subject=subject,
                    level=level,
                    created_by="SEED_ENG_SPEAKING",
                    content={str(t.task_id): 1 for t in demo_tasks},
                )
            VariantContent.objects.filter(variant=variant).delete()
            for order, task in enumerate(demo_tasks, start=1):
                VariantContent.objects.create(variant=variant, task=task, order=order)
            self.stdout.write(
                self.style.SUCCESS(
                    f"Demo variant id={variant.id} → /{LEVEL}/{SUBJECT_SHORT}/variant/{variant.id}/"
                )
            )
