"""r129: «Мои варианты»."""
from django.contrib.auth.models import User
from django.test import TestCase, override_settings
from rest_framework.test import APIClient

from Cabinet.models import Profile, VariantLiveSession
from Cabinet.my_variants import live_session_title, variant_display_title
from Generator.models import Level, Subject, Variant


@override_settings(LESSON_SECRET="test-r129")
class MyVariantsTests(TestCase):
    def setUp(self):
        self.c = APIClient()
        self.t = User.objects.create_user(username="r129_t", password="x")
        Profile.objects.update_or_create(user=self.t, defaults=dict(role=Profile.Role.TEACHER))
        self.other = User.objects.create_user(username="r129_o", password="x")
        Profile.objects.update_or_create(user=self.other, defaults=dict(role=Profile.Role.TEACHER))
        lv = Level.objects.create(level="oge", level_rus="ОГЭ")
        sj = Subject.objects.create(subject_short="inf", subject_name="Информатика")
        self.v1 = Variant.objects.create(var_subject=sj, level=lv, created_by="r129_t")
        self.v2 = Variant.objects.create(var_subject=sj, level=lv, owner_teacher=self.t)
        self.vx = Variant.objects.create(var_subject=sj, level=lv, created_by="r129_o")

    def test_list_only_own(self):
        self.c.force_authenticate(self.t)
        r = self.c.get("/api/cabinet/my-variants/")
        self.assertEqual(r.status_code, 200)
        ids = {v["id"] for v in r.data["variants"]}
        self.assertEqual(ids, {self.v1.pk, self.v2.pk})
        row = next(v for v in r.data["variants"] if v["id"] == self.v1.pk)
        self.assertEqual(row["url"], f"/oge/inf/variant/{self.v1.pk}")
        self.assertEqual(row["number"], self.v1.pk)

    def test_rename_keeps_number_and_journal_title(self):
        self.c.force_authenticate(self.t)
        r = self.c.patch(f"/api/cabinet/my-variants/{self.v1.pk}/", {"title": "  Пробник  март "}, format="json")
        self.assertEqual(r.status_code, 200)
        self.assertEqual(r.data["variant"]["title"], "Пробник март")
        self.assertIn(f"№ {self.v1.pk}", r.data["variant"]["displayTitle"])
        s = VariantLiveSession.objects.create(teacher=self.t, variant_id=self.v1.pk, variant_url="/x", title=f"Вариант №{self.v1.pk}")
        self.assertEqual(live_session_title(s), variant_display_title(self.v1.pk, "Пробник март"))
        r = self.c.get("/api/cabinet/variant-live/")
        self.assertEqual(r.data["sessions"][0]["title"], f"Пробник март (№ {self.v1.pk})")

    def test_cannot_rename_foreign(self):
        self.c.force_authenticate(self.t)
        r = self.c.patch(f"/api/cabinet/my-variants/{self.vx.pk}/", {"title": "x"}, format="json")
        self.assertEqual(r.status_code, 404)

    def test_student_forbidden(self):
        su = User.objects.create_user(username="r129_s", password="x")
        Profile.objects.update_or_create(user=su, defaults=dict(role=Profile.Role.STUDENT))
        self.c.force_authenticate(su)
        self.assertEqual(self.c.get("/api/cabinet/my-variants/").status_code, 403)
