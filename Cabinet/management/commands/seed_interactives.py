from django.contrib.auth.models import User
from django.core.management.base import BaseCommand, CommandError

from Cabinet.interactive_appearance import seed_interactive_appearance
from Cabinet.interactive_seed import seed_demo_interactives
from Cabinet.models import Interactive, Profile


class Command(BaseCommand):
    help = "Создаёт демо-интерактивы в БД для учителя (отображаются в кабинете)"

    def add_arguments(self, parser):
        parser.add_argument(
            "--username",
            default="",
            help="Логин учителя, для которого создать интерактивы",
        )
        parser.add_argument(
            "--all",
            action="store_true",
            help="Создать демо-интерактивы всем учителям без своих интерактивов",
        )
        parser.add_argument(
            "--no-assign",
            action="store_true",
            help="Не выдавать демо-интерактив ученику",
        )

    def handle(self, *args, **options):
        seed_interactive_appearance()
        assign = not options["no_assign"]

        if options["all"]:
            teachers = User.objects.filter(profile__role=Profile.Role.TEACHER).order_by("id")
            seeded = 0
            for user in teachers:
                if Interactive.objects.filter(teacher=user).exists():
                    continue
                result = seed_demo_interactives(user, assign_to_student=assign)
                seeded += 1
                self.stdout.write(
                    f"  {user.username}: новых {result['created']}, всего {result['total']}"
                )
            self.stdout.write(self.style.SUCCESS(
                f"Готово: демо-интерактивы добавлены {seeded} учителям"
            ))
            return

        username = (options["username"] or "darsorokinaa").strip()
        user = User.objects.filter(username=username).first()
        if not user:
            raise CommandError(
                f"Пользователь «{username}» не найден. "
                f"Укажите --username или сначала: python manage.py seed_cabinet --username {username}"
            )

        profile = getattr(user, "profile", None)
        if profile and profile.role != Profile.Role.TEACHER:
            profile.role = Profile.Role.TEACHER
            profile.save(update_fields=["role"])

        result = seed_demo_interactives(user, assign_to_student=assign)
        self.stdout.write(
            self.style.SUCCESS(
                f"Интерактивы готовы для «{username}»: "
                f"новых {result['created']}, всего {result['total']}"
                + (
                    f", assignment=#{result['assignment_id']}"
                    if result.get("assignment_id")
                    else ""
                )
            )
        )
