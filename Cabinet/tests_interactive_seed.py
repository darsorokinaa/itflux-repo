from django.contrib.auth.models import User
from django.test import TestCase

from Cabinet.interactive_seed import seed_demo_interactives
from Cabinet.models import Interactive, Profile, Student


class InteractiveSeedTests(TestCase):
    def setUp(self):
        self.teacher = User.objects.create_user(username="seed_ix_teacher", password="pass")
        self.teacher.profile.role = Profile.Role.TEACHER
        self.teacher.profile.save(update_fields=["role"])
        Student.objects.create(
            teacher=self.teacher,
            first_name="Аня",
            last_name="Тест",
            direction="oge",
            grade=9,
            status="active",
        )

    def test_seed_creates_interactives_in_db(self):
        result = seed_demo_interactives(self.teacher)
        self.assertGreaterEqual(result["created"], 4)
        self.assertEqual(result["total"], Interactive.objects.filter(teacher=self.teacher).count())
        types = set(
            Interactive.objects.filter(teacher=self.teacher).values_list("interactive_type", flat=True)
        )
        self.assertIn("flashcards", types)
        self.assertIn("wheel", types)
        self.assertIn("ordering", types)
        self.assertIn("quiz", types)
        cards = Interactive.objects.get(teacher=self.teacher, interactive_type="flashcards")
        self.assertGreaterEqual(cards.flashcards.count(), 3)
        # idempotent
        again = seed_demo_interactives(self.teacher)
        self.assertEqual(again["created"], 0)
        self.assertEqual(again["total"], result["total"])
