"""Демо-интерактивы для кабинета учителя (хранятся в БД)."""

from django.utils import timezone

from Cabinet.choices import InteractiveStatus, InteractiveType
from Cabinet.models import (
    FlashcardItem,
    Interactive,
    InteractiveAssignment,
    InteractiveBackground,
    InteractiveCardStyle,
    InteractiveSoundPack,
    OrderingItem,
    QuizQuestion,
    Student,
    WheelSegment,
)

WHEEL_COLORS = [
    "#2563EB",
    "#7C3AED",
    "#DB2777",
    "#EA580C",
    "#16A34A",
    "#0891B2",
]


def _pick_appearance():
    background = (
        InteractiveBackground.objects.filter(is_active=True, is_default=True).first()
        or InteractiveBackground.objects.filter(is_active=True).order_by("sort_order", "id").first()
    )
    card_style = (
        InteractiveCardStyle.objects.filter(is_active=True, is_default=True).first()
        or InteractiveCardStyle.objects.filter(is_active=True).order_by("sort_order", "id").first()
    )
    sound_pack = (
        InteractiveSoundPack.objects.filter(is_active=True, is_default=True).first()
        or InteractiveSoundPack.objects.filter(is_active=True).order_by("sort_order", "id").first()
    )
    return background, card_style, sound_pack


def _get_or_create_interactive(teacher, *, title, interactive_type, **defaults):
    interactive, created = Interactive.objects.get_or_create(
        teacher=teacher,
        title=title,
        interactive_type=interactive_type,
        defaults=defaults,
    )
    if not created:
        changed = []
        for key, value in defaults.items():
            if getattr(interactive, key) != value:
                setattr(interactive, key, value)
                changed.append(key)
        if changed:
            interactive.save(update_fields=[*changed, "updated_at"])
    return interactive, created


def seed_demo_interactives(teacher, *, assign_to_student=True):
    """
    Создаёт набор готовых интерактивов учителя в БД,
    чтобы они сразу отображались в кабинете.
    """
    from Cabinet.interactive_appearance import seed_interactive_appearance

    seed_interactive_appearance()
    background, card_style, sound_pack = _pick_appearance()
    now = timezone.now()
    created_count = 0

    appearance = {
        "background": background,
        "card_style": card_style,
        "sound_pack": sound_pack,
        "sound_enabled": True,
    }

    # 1) Карточки
    cards_ix, created = _get_or_create_interactive(
        teacher,
        title="Логические операции — карточки",
        interactive_type=InteractiveType.FLASHCARDS,
        description="Термины и определения по булевой алгебре",
        direction="oge",
        exam_type="oge",
        topic="Алгебра логики",
        instruction="Нажмите на карточку, чтобы перевернуть. Пройдите все термины.",
        status=InteractiveStatus.PUBLISHED,
        published_at=now,
        difficulty="easy",
        **appearance,
    )
    if created:
        created_count += 1
    if not cards_ix.flashcards.exists():
        for order, front, back in [
            (0, "AND (∧)", "Конъюнкция — истина, только если оба операнда истинны"),
            (1, "OR (∨)", "Дизъюнкция — истина, если хотя бы один операнд истинен"),
            (2, "NOT (¬)", "Отрицание — меняет истину на ложь и наоборот"),
            (3, "XOR", "Исключающее ИЛИ — истина, когда операнды различны"),
        ]:
            FlashcardItem.objects.create(
                interactive=cards_ix,
                front_text=front,
                back_text=back,
                order=order,
            )

    # 2) Колесо
    wheel_ix, created = _get_or_create_interactive(
        teacher,
        title="Колесо вопросов по логике",
        interactive_type=InteractiveType.WHEEL,
        description="Случайный вопрос для разминки на уроке",
        direction="oge",
        exam_type="oge",
        topic="Алгебра логики",
        instruction="Нажмите «Крутить» и ответьте на выпавший вопрос.",
        status=InteractiveStatus.PUBLISHED,
        published_at=now,
        difficulty="medium",
        wheel_settings={
            "shuffle_segments": False,
            "allow_repeat": True,
            "remove_after_spin": False,
            "show_result_modal": True,
            "sound_enabled": True,
            "spin_duration": 4,
        },
        **appearance,
    )
    if created:
        created_count += 1
    if not wheel_ix.wheel_segments.exists():
        segments = [
            "Что такое конъюнкция?",
            "Чему равно 1 ∧ 0?",
            "Чему равно 1 ∨ 0?",
            "Упростите ¬(¬A)",
            "Пример XOR в жизни",
            "Задача ОГЭ №2 — разбор",
        ]
        for order, title in enumerate(segments):
            WheelSegment.objects.create(
                interactive=wheel_ix,
                external_id=f"demo-wheel-{order + 1}",
                title=title,
                description="",
                color=WHEEL_COLORS[order % len(WHEEL_COLORS)],
                points=1,
                order=order,
            )

    # 3) Порядок
    order_ix, created = _get_or_create_interactive(
        teacher,
        title="Порядок решения логической задачи",
        interactive_type=InteractiveType.ORDERING,
        description="Расставьте шаги алгоритма в правильной последовательности",
        direction="oge",
        exam_type="oge",
        topic="Алгебра логики",
        instruction="Перетащите шаги так, чтобы получилась верная последовательность.",
        status=InteractiveStatus.PUBLISHED,
        published_at=now,
        difficulty="medium",
        **appearance,
    )
    if created:
        created_count += 1
    if not order_ix.ordering_items.exists():
        for correct_order, text in [
            (1, "Прочитать условие и выделить высказывания"),
            (2, "Ввести обозначения переменных"),
            (3, "Записать логическое выражение"),
            (4, "Построить таблицу истинности"),
            (5, "Найти ответ и проверить"),
        ]:
            OrderingItem.objects.create(
                interactive=order_ix,
                text=text,
                correct_order=correct_order,
            )

    # 4) Викторина
    quiz_ix, created = _get_or_create_interactive(
        teacher,
        title="Мини-викторина: логика",
        interactive_type=InteractiveType.QUIZ,
        description="Проверка базовых знаний по алгебре логики",
        direction="oge",
        exam_type="oge",
        topic="Алгебра логики",
        instruction="Выберите правильный ответ. В конце можно посмотреть разбор.",
        status=InteractiveStatus.DRAFT,
        difficulty="easy",
        **appearance,
    )
    if created:
        created_count += 1
    if not quiz_ix.quiz_questions.exists():
        QuizQuestion.objects.create(
            interactive=quiz_ix,
            question_text="Чему равно значение выражения 1 ∧ 0?",
            answers=[
                {"id": "a1", "text": "0", "is_correct": True},
                {"id": "a2", "text": "1", "is_correct": False},
                {"id": "a3", "text": "Не определено", "is_correct": False},
            ],
            answer_type=QuizQuestion.ANSWER_TYPE_SINGLE,
            explanation="Конъюнкция истинна только при двух единицах.",
            points=1,
            order=0,
        )
        QuizQuestion.objects.create(
            interactive=quiz_ix,
            question_text="Какая операция соответствует союзу «или» (включительное)?",
            answers=[
                {"id": "b1", "text": "AND", "is_correct": False},
                {"id": "b2", "text": "OR", "is_correct": True},
                {"id": "b3", "text": "NOT", "is_correct": False},
            ],
            answer_type=QuizQuestion.ANSWER_TYPE_SINGLE,
            explanation="Дизъюнкция (OR) — это «или» в широком смысле.",
            points=1,
            order=1,
        )

    # 5) Черновик колеса (ещё один статус в списке)
    draft_wheel, created = _get_or_create_interactive(
        teacher,
        title="Разминка на урок (черновик)",
        interactive_type=InteractiveType.WHEEL,
        description="Заготовка для следующего занятия",
        direction="oge",
        exam_type="oge",
        topic="Повторение",
        instruction="Крутите колесо и отвечайте устно.",
        status=InteractiveStatus.DRAFT,
        difficulty="easy",
        wheel_settings={
            "allow_repeat": True,
            "remove_after_spin": False,
            "show_result_modal": True,
            "spin_duration": 3,
        },
        **appearance,
    )
    if created:
        created_count += 1
    if not draft_wheel.wheel_segments.exists():
        for order, title in enumerate(["Вопрос 1", "Вопрос 2", "Вопрос 3", "Вопрос 4"]):
            WheelSegment.objects.create(
                interactive=draft_wheel,
                external_id=f"demo-draft-{order + 1}",
                title=title,
                color=WHEEL_COLORS[order % len(WHEEL_COLORS)],
                points=1,
                order=order,
            )

    assignment = None
    if assign_to_student:
        student = (
            Student.objects.filter(teacher=teacher, status="active")
            .order_by("id")
            .first()
        )
        if student:
            assignment, _ = InteractiveAssignment.objects.get_or_create(
                teacher=teacher,
                interactive=cards_ix,
                student=student,
                defaults={
                    "attempts_allowed": 3,
                    "show_result_immediately": True,
                    "comment": "Демо-выдача: карточки по логике",
                },
            )

    return {
        "created": created_count,
        "total": Interactive.objects.filter(teacher=teacher).count(),
        "assignment_id": assignment.pk if assignment else None,
    }
