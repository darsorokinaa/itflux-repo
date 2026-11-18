"""Квалификация и антиабьюз приглашения коллег."""

from datetime import timedelta
from decimal import Decimal
from unittest.mock import patch

from django.contrib.auth.models import User
from django.test import TestCase
from django.utils import timezone
from django.utils.crypto import get_random_string

from Cabinet.choices import HomeworkStatus
from Cabinet.colleague_invite import (
    ColleagueInviteService,
    hash_device,
    normalize_email,
)
from Cabinet.colleague_models import (
    ColleagueInviteAudit,
    ColleagueInviteLink,
    ColleagueInviteSettings,
    ColleagueReferral,
)
from Cabinet.models import (
    Homework,
    Profile,
    ScheduleEvent,
    Student,
    TariffPlan,
    TeacherSubscription,
)
from Cabinet.video_meeting_service import get_or_create_meeting_for_event, start_meeting


def _plan(slug, name, price, rank):
    plan, _ = TariffPlan.objects.update_or_create(
        slug=slug,
        defaults={
            "name": name,
            "price_month": Decimal(str(price)),
            "price_year": Decimal(str(price)) * 10,
            "content_access_rank": rank,
            "is_active": True,
            "is_public": True,
            "is_free": price == 0,
            "sort_order": rank,
        },
    )
    return plan


def _user(username, *, role=Profile.Role.TEACHER, email=""):
    user = User.objects.create(
        username=username,
        email=email or f"{username}@example.com",
    )
    user.set_unusable_password()
    user.save(update_fields=["password"])
    profile = Profile.objects.get(user=user)
    profile.role = role
    profile.account_active = True
    profile.account_blocked = False
    profile.save(update_fields=["role", "account_active", "account_blocked"])
    return user


def _start_sub(user, plan):
    sub, _ = TeacherSubscription.objects.update_or_create(
        teacher=user,
        defaults={
            "plan": plan,
            "status": TeacherSubscription.Status.ACTIVE,
            "source": TeacherSubscription.Source.SELF,
            "expires_at": None,
            "current_period_end": None,
        },
    )
    return sub


class ColleagueInviteTests(TestCase):
    def setUp(self):
        self.start = _plan("start", "Старт", 0, 0)
        self.tutor = _plan("teacher", "Репетитор", 990, 1)
        self.premium = _plan("premium", "Премиум", 3990, 3)
        self.settings_row = ColleagueInviteSettings.get_solo()
        self.settings_row.bonus_days = 7
        self.settings_row.monthly_cap = 10
        self.settings_row.fingerprint_window_hours = 72
        self.settings_row.enabled = True
        self.settings_row.save()
        self.inviter = _user("inviter")
        _start_sub(self.inviter, self.start)
        self.link = ColleagueInviteService.ensure_link(self.inviter)

    def _invitee(self, name="invitee"):
        user = _user(name)
        _start_sub(user, self.start)
        return user

    def _bind(self, invitee, **kwargs):
        return ColleagueInviteService.bind(invitee, self.link.code, **kwargs)

    def test_defaults_are_admin_settings_not_literals(self):
        days = ColleagueInviteSettings._meta.get_field("bonus_days")
        cap = ColleagueInviteSettings._meta.get_field("monthly_cap")
        self.assertEqual(days.default, 7)
        self.assertEqual(cap.default, 10)

    def test_homework_opens_tutor_and_second_event_does_not_stack(self):
        invitee = self._invitee()
        self._bind(invitee)
        Homework.objects.create(
            teacher=invitee, title="Черновик", status=HomeworkStatus.DRAFT
        )
        self.inviter.subscription.refresh_from_db()
        self.assertEqual(self.inviter.subscription.plan_id, self.start.pk)
        referral = ColleagueReferral.objects.get(invited=invitee)
        self.assertEqual(referral.status, ColleagueReferral.Status.PENDING)

        Homework.objects.create(
            teacher=invitee, title="Дроби", status=HomeworkStatus.ASSIGNED
        )
        referral.refresh_from_db()
        sub = TeacherSubscription.objects.get(teacher=self.inviter)
        self.assertEqual(referral.status, ColleagueReferral.Status.GRANTED)
        self.assertEqual(
            referral.qualification, ColleagueReferral.Qualification.HOMEWORK
        )
        self.assertEqual(referral.bonus_days, 7)
        self.assertEqual(referral.effect, ColleagueReferral.Effect.ACTIVATED)
        self.assertEqual(sub.plan_id, self.tutor.pk)
        self.assertEqual(sub.source, TeacherSubscription.Source.REFERRAL)
        self.assertGreater(sub.expires_at, timezone.now() + timedelta(days=6))
        self.assertTrue(
            ColleagueInviteAudit.objects.filter(
                referral=referral,
                action=ColleagueInviteAudit.Action.GRANTED,
            ).exists()
        )

        expires = sub.expires_at
        Homework.objects.create(
            teacher=invitee, title="Ещё одно", status=HomeworkStatus.ASSIGNED
        )
        ColleagueInviteService.note_activity(invitee, "lesson")
        sub.refresh_from_db()
        self.assertEqual(sub.expires_at, expires)
        self.assertEqual(
            ColleagueInviteAudit.objects.filter(
                referral=referral,
                action=ColleagueInviteAudit.Action.GRANTED,
            ).count(),
            1,
        )

    def test_bonus_days_follow_the_admin_setting(self):
        self.settings_row.bonus_days = 3
        self.settings_row.save(update_fields=["bonus_days"])
        invitee = self._invitee("days3")
        self._bind(invitee)
        Homework.objects.create(
            teacher=invitee, title="ДЗ", status=HomeworkStatus.ASSIGNED
        )
        referral = ColleagueReferral.objects.get(invited=invitee)
        self.assertEqual(referral.bonus_days, 3)
        sub = TeacherSubscription.objects.get(teacher=self.inviter)
        self.assertLess(sub.expires_at, timezone.now() + timedelta(days=4))

    def test_completed_lesson_qualifies(self):
        invitee = self._invitee("lesson")
        self._bind(invitee)
        start = timezone.now() - timedelta(hours=1)
        ScheduleEvent.objects.create(
            owner=invitee,
            title="Урок",
            starts_at=start,
            ends_at=start + timedelta(hours=1),
            status=ScheduleEvent.Status.COMPLETED,
        )
        referral = ColleagueReferral.objects.get(invited=invitee)
        self.assertEqual(referral.status, ColleagueReferral.Status.GRANTED)
        self.assertEqual(referral.qualification, ColleagueReferral.Qualification.LESSON)

    def test_started_video_lesson_qualifies(self):
        invitee = self._invitee("live")
        self._bind(invitee)
        start = timezone.now() - timedelta(minutes=5)
        event = ScheduleEvent.objects.create(
            owner=invitee,
            title="Видео",
            starts_at=start,
            ends_at=start + timedelta(hours=1),
            status=ScheduleEvent.Status.PLANNED,
        )
        meeting, _created = get_or_create_meeting_for_event(
            event=event, created_by=invitee
        )
        start_meeting(meeting=meeting, user=invitee)
        referral = ColleagueReferral.objects.get(invited=invitee)
        self.assertEqual(referral.qualification, ColleagueReferral.Qualification.LESSON)
        self.assertIn(
            referral.status,
            [ColleagueReferral.Status.GRANTED, ColleagueReferral.Status.DEFERRED],
        )

    def test_active_tutor_is_extended(self):
        expires = timezone.now() + timedelta(days=12)
        sub = self.inviter.subscription
        sub.plan = self.tutor
        sub.source = TeacherSubscription.Source.PAYMENT
        sub.expires_at = expires
        sub.current_period_end = expires
        sub.save()
        invitee = self._invitee("extend")
        self._bind(invitee)
        ColleagueInviteService.note_activity(invitee, "homework")
        sub.refresh_from_db()
        self.assertEqual(sub.plan_id, self.tutor.pk)
        self.assertAlmostEqual(
            (sub.expires_at - expires).total_seconds(),
            timedelta(days=7).total_seconds(),
            delta=5,
        )
        referral = ColleagueReferral.objects.get(invited=invitee)
        self.assertEqual(referral.effect, ColleagueReferral.Effect.EXTENDED)

    def test_other_paid_plan_is_kept_until_it_ends(self):
        expires = timezone.now() + timedelta(days=20)
        sub = self.inviter.subscription
        sub.plan = self.premium
        sub.source = TeacherSubscription.Source.PAYMENT
        sub.status = TeacherSubscription.Status.ACTIVE
        sub.expires_at = expires
        sub.current_period_end = expires
        sub.auto_renew = False
        sub.tbank_rebill_id = ""
        sub.save()
        invitee = self._invitee("prem")
        self._bind(invitee)
        ColleagueInviteService.note_activity(invitee, "homework")
        referral = ColleagueReferral.objects.get(invited=invitee)
        sub.refresh_from_db()
        self.assertEqual(referral.status, ColleagueReferral.Status.DEFERRED)
        self.assertEqual(sub.plan_id, self.premium.pk)
        self.assertEqual(sub.expires_at, expires)

        sub.expires_at = timezone.now() - timedelta(hours=2)
        sub.save(update_fields=["expires_at"])
        from Cabinet.subscription_lifecycle import process_expired_subscriptions

        process_expired_subscriptions()
        sub.refresh_from_db()
        referral.refresh_from_db()
        self.assertEqual(sub.plan_id, self.tutor.pk)
        self.assertEqual(sub.source, TeacherSubscription.Source.REFERRAL)
        self.assertGreater(sub.expires_at, timezone.now() + timedelta(days=6))
        self.assertEqual(referral.status, ColleagueReferral.Status.GRANTED)
        self.assertTrue(
            ColleagueInviteAudit.objects.filter(
                referral=referral,
                action=ColleagueInviteAudit.Action.DEFERRED_APPLIED,
            ).exists()
        )

    def test_open_ended_tutor_is_not_cut_short(self):
        sub = self.inviter.subscription
        sub.plan = self.tutor
        sub.source = TeacherSubscription.Source.ADMIN
        sub.expires_at = None
        sub.status = TeacherSubscription.Status.ACTIVE
        sub.save()
        invitee = self._invitee("open")
        self._bind(invitee)
        ColleagueInviteService.note_activity(invitee, "lesson")
        sub.refresh_from_db()
        referral = ColleagueReferral.objects.get(invited=invitee)
        self.assertIsNone(sub.expires_at)
        self.assertEqual(sub.plan_id, self.tutor.pk)
        self.assertEqual(referral.effect, ColleagueReferral.Effect.ALREADY_COVERED)

    def test_revoke_restores_previous_subscription(self):
        invitee = self._invitee("revoke")
        self._bind(invitee)
        ColleagueInviteService.note_activity(invitee, "homework")
        referral = ColleagueReferral.objects.get(invited=invitee)
        ColleagueInviteService.revoke(
            referral, actor=self.inviter, note="проверка отзыва"
        )
        sub = TeacherSubscription.objects.get(teacher=self.inviter)
        referral.refresh_from_db()
        self.assertEqual(referral.status, ColleagueReferral.Status.REVOKED)
        self.assertEqual(sub.plan_id, self.start.pk)
        self.assertIsNone(sub.expires_at)
        self.assertEqual(sub.source, TeacherSubscription.Source.SELF)
        self.assertTrue(
            ColleagueInviteAudit.objects.filter(
                referral=referral,
                action=ColleagueInviteAudit.Action.REVOKED,
            ).exists()
        )

    def test_self_invites_are_rejected(self):
        self.inviter.email = "a.b+tag@gmail.com"
        self.inviter.save(update_fields=["email"])
        Profile.objects.filter(user=self.inviter).update(role=Profile.Role.TEACHER)
        self.link.last_ip = "203.0.113.10"
        self.link.last_fingerprint = hash_device("device-inviter-1")
        self.link.last_seen_at = timezone.now()
        self.link.save()

        same = self._bind(self.inviter)
        self.assertEqual(same["reason"], "self_user")
        self.assertFalse(
            ColleagueReferral.objects.filter(invited=self.inviter).exists()
        )

        dotted = self._invitee("dotted")
        dotted.email = "ab@gmail.com"
        dotted.save(update_fields=["email"])
        Profile.objects.filter(user=dotted).update(role=Profile.Role.TEACHER)
        self.assertEqual(self._bind(dotted)["reason"], "self_email")

        phone_inviter = self._invitee("phone-host")
        phone_link = ColleagueInviteService.ensure_link(phone_inviter)
        Student.objects.create(
            teacher=phone_inviter,
            user=phone_inviter,
            first_name="Хост",
            phone="8 (999) 111-22-33",
        )
        phone_guest = self._invitee("phone-guest")
        Student.objects.create(
            teacher=phone_inviter,
            user=phone_guest,
            first_name="Гость",
            phone="+79991112233",
        )
        phone_result = ColleagueInviteService.bind(phone_guest, phone_link.code)
        self.assertEqual(phone_result["reason"], "self_phone")

        self.assertEqual(
            self._bind(self._invitee("ip-guest"), ip="203.0.113.10")["reason"],
            "self_ip",
        )
        device_result = self._bind(
            self._invitee("device-guest"),
            ip="198.51.100.8",
            fingerprint=hash_device("device-inviter-1"),
        )
        self.assertEqual(device_result["reason"], "self_device")
        self.assertEqual(
            ColleagueReferral.objects.filter(inviter=self.inviter).count(), 0
        )

    def test_same_ip_outside_the_window_is_allowed(self):
        self.link.last_ip = "203.0.113.10"
        self.link.last_fingerprint = hash_device("device-inviter-1")
        self.link.last_seen_at = timezone.now() - timedelta(hours=80)
        self.link.save()
        invitee = self._invitee("later")
        result = self._bind(
            invitee,
            ip="203.0.113.10",
            fingerprint=hash_device("device-inviter-1"),
        )
        self.assertEqual(result["reason"], "bound")
        self.assertTrue(
            ColleagueReferral.objects.filter(
                invited=invitee, inviter=self.inviter
            ).exists()
        )

    def test_students_cannot_refer_or_be_referred(self):
        student = _user("pupil", role=Profile.Role.STUDENT)
        result = self._bind(student)
        self.assertEqual(result["reason"], "not_teacher_invitee")
        self.assertFalse(ColleagueReferral.objects.filter(invited=student).exists())

        student_link = ColleagueInviteLink.objects.create(
            owner=student, code="studentcode"
        )
        invitee = self._invitee("from-student")
        refused = ColleagueInviteService.bind(invitee, student_link.code)
        self.assertEqual(refused["reason"], "not_teacher_inviter")
        self.assertFalse(ColleagueReferral.objects.filter(invited=invitee).exists())

    def test_referrer_is_not_replaced(self):
        other = _user("other-host")
        other_link = ColleagueInviteService.ensure_link(other)
        invitee = self._invitee("sticky")
        first = self._bind(invitee)
        second = ColleagueInviteService.bind(invitee, other_link.code)
        self.assertEqual(first["reason"], "bound")
        self.assertEqual(second["reason"], "already_bound")
        self.assertEqual(
            ColleagueReferral.objects.get(invited=invitee).inviter_id, self.inviter.pk
        )

    def test_monthly_cap(self):
        self.settings_row.monthly_cap = 2
        self.settings_row.save(update_fields=["monthly_cap"])
        for index in range(2):
            guest = self._invitee(f"cap{index}")
            self.assertEqual(self._bind(guest)["reason"], "bound")
        blocked = self._bind(self._invitee("cap-over"))
        self.assertEqual(blocked["reason"], "monthly_cap")
        self.assertEqual(
            ColleagueReferral.objects.filter(inviter=self.inviter).count(), 2
        )
        self.assertTrue(
            ColleagueInviteAudit.objects.filter(
                reason="monthly_cap", inviter=self.inviter
            ).exists()
        )

    def test_summary_counts_invited_and_qualified(self):
        pending = self._invitee("pending")
        done = self._invitee("done")
        self._bind(pending)
        self._bind(done)
        ColleagueInviteService.note_activity(done, "homework")
        payload = ColleagueInviteService.summary(self.inviter)
        self.assertTrue(payload["enabled"])
        self.assertEqual(payload["invited"], 2)
        self.assertEqual(payload["qualified"], 1)
        self.assertEqual(payload["bonus_days"], 7)
        self.assertIn(self.link.code, payload["path"])
        self.assertIn("role=teacher", payload["path"])

    def test_register_keeps_utm_and_stores_referrer(self):
        secret = get_random_string(24)
        device = "regdevice01"
        with patch("Cabinet.views.rate_limit_check", return_value=True):
            response = self.client.post(
                "/api/cabinet/register/",
                data={
                    "email": "new.colleague@example.com",
                    "password": secret,
                    "password_confirm": secret,
                    "name": "Нина",
                    "surname": "Орлова",
                    "role": "teacher",
                    "colleague_code": self.link.code,
                    "device_id": device,
                    "utm_source": "vk",
                    "utm_medium": "cpc",
                    "utm_campaign": "spring",
                    "source_ref": "post1",
                },
                content_type="application/json",
            )
        self.assertEqual(response.status_code, 201, response.content)
        user = User.objects.get(email="new.colleague@example.com")
        touch = user.profile.acquisition_touch
        self.assertEqual(touch["utm_source"], "vk")
        self.assertEqual(touch["utm_campaign"], "spring")
        self.assertEqual(touch["ref"], "post1")
        self.assertNotIn("colleague", touch)
        referral = ColleagueReferral.objects.get(invited=user)
        self.assertEqual(referral.inviter_id, self.inviter.pk)
        self.assertEqual(referral.device_fingerprint, hash_device(device))
        self.assertEqual(referral.status, ColleagueReferral.Status.PENDING)

    def test_normalized_email_strips_gmail_dots_and_plus(self):
        self.assertEqual(normalize_email("A.B+tag@gmail.com"), "ab@gmail.com")
        self.assertEqual(normalize_email("Teacher+x@school.ru"), "teacher@school.ru")
