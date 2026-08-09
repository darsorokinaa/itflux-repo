from datetime import timedelta

from django.contrib.auth.models import User
from django.core.management.base import BaseCommand
from django.utils import timezone

from Cabinet.choices import StudentStatus
from Cabinet.interactive_appearance import seed_interactive_appearance
from Cabinet.interactive_seed import seed_demo_interactives
from Cabinet.models import (
    Homework,
    HomeworkSubmission,
    HomeworkTask,
    Lesson,
    LessonPlan,
    LessonPlanItem,
    Profile,
    ReviewItem,
    ScheduleEvent,
    Student,
    StudentGroup,
)


class Command(BaseCommand):
    help = "Создаёт тестовые данные личного кабинета учителя"

    def add_arguments(self, parser):
        parser.add_argument(
            "--username",
            default="teacher_demo",
            help="Имя пользователя-учителя",
        )

    def handle(self, *args, **options):
        seed_interactive_appearance()
        username = options["username"]
        user, created = User.objects.get_or_create(
            username=username,
            defaults={
                "email": f"{username}@example.com",
                "first_name": "Дарья",
                "last_name": "Учитель",
            },
        )
        if created:
            user.set_password("demo12345")
            user.save()

        profile = user.profile
        profile.role = Profile.Role.TEACHER
        profile.display_name = "Дарья"
        profile.name = "Дарья"
        profile.surname = "Учитель"
        profile.save()

        students_data = [
            ("Алексей", "Морозов", "ege", 11, None),
            ("Мария", "Козлова", "oge", 9, None),
            ("Иван", "Петров", "oge", 9, "g1"),
            ("Ольга", "Сидорова", "oge", 9, "g1"),
            ("Дмитрий", "Волков", "ege", 10, "g1"),
            ("Елена", "Романова", "ege", 11, "g2"),
            ("Никита", "Лебедев", "python", 10, "g2"),
            ("София", "Тихонова", "oge", 8, "g2"),
        ]

        students = {}
        for first, last, direction, grade, _ in students_data:
            student, _ = Student.objects.get_or_create(
                teacher=user,
                first_name=first,
                last_name=last,
                defaults={
                    "direction": direction,
                    "grade": grade,
                    "status": "active",
                },
            )
            students[f"{first} {last}"] = student

        g1, _ = StudentGroup.objects.get_or_create(
            teacher=user,
            title="Группа ОГЭ-2026",
            defaults={
                "description": "Подготовка к ОГЭ по информатике",
                "direction": "oge",
                "exam_type": "oge",
                "status": "active",
            },
        )
        g2, _ = StudentGroup.objects.get_or_create(
            teacher=user,
            title="ЕГЭ Информатика",
            defaults={
                "description": "Подготовка к ЕГЭ",
                "direction": "ege",
                "exam_type": "ege",
                "status": "active",
            },
        )

        for first, last, direction, grade, group_key in students_data:
            student = students[f"{first} {last}"]
            if group_key == "g1":
                g1.students.add(student)
            elif group_key == "g2":
                g2.students.add(student)

        lesson, _ = Lesson.objects.get_or_create(
            teacher=user,
            title="Алгебра логики",
            defaults={
                "description": "Основы булевой алгебры",
                "direction": "oge",
                "exam_type": "oge",
                "topic": "Логика",
                "duration_minutes": 60,
                "status": "published",
                "lesson_type": "group",
            },
        )

        plan, _ = LessonPlan.objects.get_or_create(
            teacher=user,
            title="План ОГЭ — весна",
            defaults={
                "description": "8-недельный план подготовки",
                "goal": "Сдать ОГЭ на 4+",
                "direction": "oge",
                "exam_type": "oge",
                "format": "group",
                "group": g1,
                "status": "active",
                "lessons_count": 3,
                "frequency": "2 раза в неделю",
            },
        )

        plan_items = [
            (1, "Введение в логику", "Логика"),
            (2, "Таблицы истинности", "Логика"),
            (3, "Решение задач ОГЭ №14", "Задачи"),
        ]
        for order, title, topic in plan_items:
            LessonPlanItem.objects.get_or_create(
                plan=plan,
                order=order,
                defaults={"title": title, "topic": topic, "status": "planned" if order < 3 else "not_started"},
            )

        now = timezone.now()
        active_students = list(Student.objects.filter(teacher=user, status=StudentStatus.ACTIVE)[:3])
        s1 = active_students[0] if active_students else None

        from Cabinet.schedule_service import cancel_event, create_series, create_single_event, move_event

        if s1:
            ind = create_single_event(
                teacher=user,
                data={
                    "title": "Алгебра логики + IF",
                    "topic": "Условные операторы",
                    "starts_at": now.replace(hour=10, minute=0, second=0, microsecond=0) + timedelta(days=2),
                    "ends_at": now.replace(hour=10, minute=45, second=0, microsecond=0) + timedelta(days=2),
                    "event_type": "individual_lesson",
                    "format": "online",
                    "notify_participants": False,
                },
                student_ids=[s1.pk],
                notify=False,
            )

        series, series_events = create_series(
            teacher=user,
            series_data={
                "title": "ОГЭ — вторник и четверг",
                "topic": "Логика",
                "event_type": "group_lesson",
                "timezone": "Europe/Moscow",
                "start_date": (now + timedelta(days=1)).date(),
                "start_time": now.replace(hour=17, minute=0).time(),
                "end_time": now.replace(hour=17, minute=45).time(),
                "recurrence_type": "custom_weekdays",
                "recurrence_weekdays": [1, 3],
                "recurrence_count": 8,
                "format": "online",
                "notify_participants": False,
            },
            group_id=g1.pk if g1 else None,
            notify=False,
        )

        moved = None
        if series_events:
            moved = series_events[2] if len(series_events) > 2 else series_events[0]
            move_event(
                moved,
                starts_at=moved.starts_at + timedelta(hours=1),
                ends_at=moved.ends_at + timedelta(hours=1),
                changed_by=user,
                notify=False,
            )
            cancel_event(series_events[-1], changed_by=user, notify=False)

        from Cabinet.notifications import NotificationService

        if s1:
            NotificationService.notify_event_created(ind)
        if moved:
            NotificationService.notify_event_moved(
                moved,
                old_start_at=(moved.starts_at - timedelta(hours=1)).isoformat(),
                old_end_at=(moved.ends_at - timedelta(hours=1)).isoformat(),
            )
        if series_events:
            NotificationService.notify_event_cancelled(series_events[-1])

        for day_offset, hour, title in [(0, 15, "Группа ОГЭ-2026"), (0, 17, "Индивидуальное"), (1, 16, "ЕГЭ модуль 7")]:
            starts = now.replace(hour=hour, minute=0, second=0, microsecond=0) + timedelta(days=day_offset)
            ends = starts + timedelta(hours=1)
            ScheduleEvent.objects.get_or_create(
                owner=user,
                title=title,
                starts_at=starts,
                defaults={
                    "ends_at": ends,
                    "event_type": "group_lesson" if "Группа" in title else "individual_lesson",
                    "format": "online",
                    "status": "planned",
                    "group": g1 if "ОГЭ" in title else None,
                },
            )

        homework, _ = Homework.objects.get_or_create(
            teacher=user,
            title="ДЗ: Таблицы истинности",
            defaults={
                "description": "Решить 5 задач из рабочего листа",
                "group": g1,
                "lesson": lesson,
                "due_at": now + timedelta(days=3),
                "status": "assigned",
            },
        )
        HomeworkTask.objects.get_or_create(
            homework=homework,
            title="Задача 1",
            defaults={"task_type": "text", "order": 1, "description": "Построить таблицу истинности"},
        )

        submission_student = students["Мария Козлова"]
        submission, _ = HomeworkSubmission.objects.get_or_create(
            homework=homework,
            student=submission_student,
            defaults={
                "answer_text": "Решение задач приложено",
                "status": "submitted",
                "submitted_at": now,
            },
        )

        ReviewItem.objects.get_or_create(
            teacher=user,
            source_type="homework",
            source_id=submission.pk,
            defaults={
                "student": submission_student,
                "title": f"ДЗ: {homework.title} — {submission_student.full_name}",
                "status": "pending",
                "priority": "normal",
            },
        )

        ix_result = seed_demo_interactives(user, assign_to_student=True)

        self.stdout.write(self.style.SUCCESS(
            f"Тестовые данные созданы для учителя «{username}» "
            f"(пароль: demo12345 при первом создании). "
            f"Интерактивы: новых {ix_result['created']}, всего {ix_result['total']}."
        ))
