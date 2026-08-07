"""Сид критериев устной части ЕГЭ по английскому (демо-КИМ 2026).

Только Criteria для уже существующих TaskList 1–4 (eng/ege).
Subject / TaskList / Task / Variant не создаёт.
"""

from __future__ import annotations

from django.core.management.base import BaseCommand, CommandError
from django.db import transaction

from Generator.models import Criteria, Level, Subject, TaskList

SUBJECT_SHORT = "eng"
LEVEL = "ege"


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


CRITERIA_SPECS = (
    {"number": 1, "seed_criteria": _seed_task1},
    {"number": 2, "seed_criteria": _seed_task2},
    {"number": 3, "seed_criteria": _seed_task3},
    {"number": 4, "seed_criteria": _seed_task4},
)


class Command(BaseCommand):
    help = "Сидит только критерии устной части ЕГЭ eng для существующих TaskList 1–4"

    @transaction.atomic
    def handle(self, *args, **options):
        try:
            subject = Subject.objects.get(subject_short=SUBJECT_SHORT)
        except Subject.DoesNotExist as exc:
            raise CommandError(
                f"Subject «{SUBJECT_SHORT}» не найден. Создайте предмет и TaskList 1–4 вручную."
            ) from exc

        try:
            level = Level.objects.get(level=LEVEL)
        except Level.DoesNotExist as exc:
            raise CommandError(f"Level «{LEVEL}» не найден.") from exc

        seeded = 0
        missing = []

        for spec in CRITERIA_SPECS:
            tl = (
                TaskList.objects.filter(
                    subject=subject,
                    level=level,
                    task_number=spec["number"],
                )
                .order_by("id")
                .first()
            )
            if not tl:
                missing.append(str(spec["number"]))
                continue

            # Старые single-критерии без оси — убираем, оставляем осевую рубрику.
            Criteria.objects.filter(task_number=tl, axis_code="").delete()
            spec["seed_criteria"](tl)
            seeded += 1
            count = Criteria.objects.filter(task_number=tl).count()
            self.stdout.write(f"TaskList #{spec['number']} id={tl.id}: criteria={count}")

        if missing:
            self.stdout.write(
                self.style.WARNING(
                    f"Пропущены номера без TaskList: {', '.join(missing)}"
                )
            )

        if seeded == 0:
            raise CommandError(
                "Не найден ни один TaskList eng/ege 1–4 — критерии не записаны."
            )

        total = Criteria.objects.filter(
            task_number__subject=subject,
            task_number__level=level,
            task_number__task_number__in=[s["number"] for s in CRITERIA_SPECS],
        ).count()
        self.stdout.write(
            self.style.SUCCESS(
                f"eng/ege speaking: критерии обновлены для {seeded} TaskList, всего Criteria={total}"
            )
        )
