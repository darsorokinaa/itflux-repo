"""Темы TaskList для ЕГЭ по химии (КИМ, 34 задания)."""

from __future__ import annotations

SUBJECT_SHORT = "chem"
SUBJECT_NAME = "Химия"
LEVEL = "ege"

PART1_TITLE = "Часть 1"
PART2_TITLE = "Часть 2"

# Баллы по спецификации ФИПИ (максимум 56: часть 1 — 36, часть 2 — 20).
_TWO_POINT_PART1 = frozenset({6, 7, 8, 14, 15, 22, 23, 24})

EGE_CHEM_TASKS: tuple[tuple[int, str], ...] = (
    (1, "Строение электронных оболочек атомов. Закономерности изменения свойств элементов."),
    (2, "Закономерности изменения химических свойств элементов по периодам и группам."),
    (3, "Электроотрицательность, степень окисления и валентность химических элементов."),
    (4, "Виды химической связи. Типы кристаллических решёток."),
    (5, "Классификация и номенклатура неорганических веществ."),
    (6, "Химические свойства простых веществ и неорганических соединений."),
    (7, "Соответствие между веществами и реагентами, с которыми они могут взаимодействовать."),
    (8, "Соответствие между исходными веществами и продуктами реакции (неорганическая химия)."),
    (9, "Взаимосвязь неорганических веществ: выбор веществ для цепочки превращений."),
    (10, "Классификация и номенклатура органических веществ."),
    (11, "Изомерия и гомология органических соединений."),
    (12, "Химические свойства углеводородов и кислородсодержащих органических соединений."),
    (13, "Химические свойства азотсодержащих и биологически важных органических соединений."),
    (14, "Превращения углеводородов и их производных: соответствие реагентов и продуктов."),
    (15, "Химические свойства и способы получения кислородсодержащих органических соединений."),
    (16, "Взаимосвязь органических веществ: выбор пары веществ для заданной схемы превращений."),
    (17, "Классификация химических реакций в неорганической и органической химии."),
    (18, "Факторы, влияющие на скорость химической реакции."),
    (19, "Окислительно-восстановительные реакции: определение окислителя и восстановителя."),
    (20, "Электролиз расплавов и растворов солей."),
    (21, "Гидролиз солей. Среда водных растворов: pH."),
    (22, "Химическое равновесие. Принцип Ле Шателье: смещение равновесия под действием внешних факторов."),
    (23, "Обратимые реакции: расчёт равновесных и исходных концентраций."),
    (24, "Качественные реакции на неорганические и органические вещества."),
    (25, "Правила безопасной работы в лаборатории. Применение веществ. Промышленные процессы."),
    (26, "Расчёты массовой доли вещества в растворе."),
    (27, "Расчёты по термохимическим уравнениям (тепловой эффект реакции)."),
    (28, "Расчёт объёма/массы продукта с учётом выхода и примесей."),
    (29, "Окислительно-восстановительная реакция: расстановка коэффициентов методом электронного баланса, определение окислителя и восстановителя."),
    (30, "Реакция ионного обмена: выбор веществ, составление молекулярного, полного и сокращённого ионного уравнений."),
    (31, "Цепочка превращений неорганических веществ: написание уравнений реакций с пояснением условий."),
    (32, "Цепочка превращений органических веществ: уравнения реакций со структурными формулами."),
    (33, "Вывод молекулярной и структурной формулы органического вещества по данным эксперимента; составление уравнения реакции."),
    (34, "Комбинированная расчётная задача (смесь, выход, примеси, кристаллогидраты и т. п.)."),
)


def max_score_for_ege_chem(task_number: int) -> int:
    if task_number in _TWO_POINT_PART1 or task_number in (29, 30):
        return 2
    if task_number == 31:
        return 4
    if task_number == 32:
        return 5
    if task_number == 33:
        return 3
    if task_number == 34:
        return 4
    return 1


def seed_ege_chem_tasklists(Subject, Level, Part, TaskList, *, dry_run=False) -> dict:
    """Создаёт или обновляет 34 TaskList chem/ege. Идемпотентно."""
    subject = Subject.objects.filter(subject_short=SUBJECT_SHORT).first()
    if subject is None:
        if not dry_run:
            subject = Subject.objects.create(
                subject_short=SUBJECT_SHORT,
                subject_name=SUBJECT_NAME,
            )
    elif not (subject.subject_name or "").strip() and not dry_run:
        subject.subject_name = SUBJECT_NAME
        subject.save(update_fields=["subject_name"])

    level = Level.objects.filter(level=LEVEL).first()
    if level is None and not dry_run:
        level = Level.objects.create(level=LEVEL, level_rus="ЕГЭ")

    part1 = Part.objects.filter(part_title=PART1_TITLE).first()
    part2 = Part.objects.filter(part_title=PART2_TITLE).first()
    if not dry_run:
        if part1 is None:
            part1, _ = Part.objects.get_or_create(part_title=PART1_TITLE)
        if part2 is None:
            part2, _ = Part.objects.get_or_create(part_title=PART2_TITLE)

    created = 0
    updated = 0
    skipped = 0
    for number, title in EGE_CHEM_TASKS:
        part = part1 if number <= 28 else part2
        max_score = max_score_for_ege_chem(number)
        tl = None
        if subject is not None and level is not None:
            tl = (
                TaskList.objects.filter(subject=subject, level=level, task_number=number)
                .order_by("id")
                .first()
            )
        if tl is None:
            if not dry_run:
                TaskList.objects.create(
                    subject=subject,
                    level=level,
                    part=part,
                    task_number=number,
                    task_title=title,
                    max_score=max_score,
                )
            created += 1
            continue
        fields = []
        if tl.task_title != title:
            tl.task_title = title
            fields.append("task_title")
        if part is not None and tl.part_id != part.id:
            tl.part = part
            fields.append("part")
        if tl.max_score != max_score:
            tl.max_score = max_score
            fields.append("max_score")
        if fields:
            if not dry_run:
                tl.save(update_fields=fields)
            updated += 1
        else:
            skipped += 1

    return {
        "created": created,
        "updated": updated,
        "skipped": skipped,
        "total": len(EGE_CHEM_TASKS),
        "dry_run": dry_run,
        "subject_id": getattr(subject, "id", None),
        "level_id": getattr(level, "id", None),
    }
