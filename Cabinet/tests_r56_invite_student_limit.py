"""r56: лимит учеников тарифа проверяется при принятии общей ссылки-приглашения."""
import uuid

from django.contrib.auth.models import User
from django.core.cache import cache
from django.test import TestCase

from Cabinet.choices import StudentStatus
from Cabinet.invitations import (
    STUDENT_LIMIT_INVITE_MESSAGE,
    InvitationError,
    accept_student_invitation,
    create_student_invitation,
)
from Cabinet.models import Profile, Student, TariffPlan, TeacherSubscription


def _user(role):
    suffix = uuid.uuid4().hex[:8]
    user = User.objects.create_user(username=f"r56_{role}_{suffix}", password="pass", email=f"{suffix}@test.ru")
    user.profile.role = role
    user.profile.save(update_fields=["role"])
    return user


class GeneralInviteStudentLimitTests(TestCase):
    def setUp(self):
        cache.clear()
        self.teacher = _user(Profile.Role.TEACHER)
        self.plan, _ = TariffPlan.objects.update_or_create(
            slug="r56limit",
            defaults={"name": "Тест r56", "max_students": 2, "price_month": 0, "is_free": True, "is_public": False},
        )
        TeacherSubscription.objects.filter(teacher=self.teacher).delete()
        from Cabinet.subscription_service import SubscriptionLimitService

        sub = SubscriptionLimitService.get_or_create_subscription(self.teacher)
        sub.plan = self.plan
        sub.save()
        self.assertEqual(SubscriptionLimitService.get_current_plan(self.teacher).max_students, 2)

    def _accept_general(self):
        invitation = create_student_invitation(self.teacher)
        student_user = _user(Profile.Role.STUDENT)
        return accept_student_invitation(invitation.token, student_user)

    def test_general_links_stop_at_plan_limit(self):
        # Ссылки созданы, пока места были; принимаются уже сверх лимита.
        inv = [create_student_invitation(self.teacher) for _ in range(3)]
        accept_student_invitation(inv[0].token, _user(Profile.Role.STUDENT))
        accept_student_invitation(inv[1].token, _user(Profile.Role.STUDENT))
        with self.assertRaises(InvitationError) as ctx:
            accept_student_invitation(inv[2].token, _user(Profile.Role.STUDENT))
        self.assertEqual(ctx.exception.code, "student_limit")
        self.assertEqual(str(ctx.exception), STUDENT_LIMIT_INVITE_MESSAGE)
        active = Student.objects.filter(teacher=self.teacher).exclude(status=StudentStatus.ARCHIVED).count()
        self.assertEqual(active, 2)

    def test_archived_slot_frees_place(self):
        self._accept_general()
        student, _ = self._accept_general()
        student.status = StudentStatus.ARCHIVED
        student.save(update_fields=["status"])
        self._accept_general()
        active = Student.objects.filter(teacher=self.teacher).exclude(status=StudentStatus.ARCHIVED).count()
        self.assertEqual(active, 2)
