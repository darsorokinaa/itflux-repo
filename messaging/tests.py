from datetime import timedelta

from django.contrib.auth.models import User
from django.core.files.uploadedfile import SimpleUploadedFile
from django.test import TestCase, override_settings
from django.utils import timezone
from rest_framework.test import APIClient

from Cabinet.models import Profile, Student
from messaging.checks import messaging_deploy_checks
from messaging.consent_texts import MARKETING_CONSENT_V1, consent_text_sha256
from messaging.models import (
    ConsentPromptState,
    Conversation,
    ConversationParticipant,
    ConversationReadState,
    Message,
    MessageAttachment,
    MessagingAccessLog,
    MessagingAuditLog,
    SupportTicket,
    UserConsent,
    UserConsentLog,
)
from messaging.purpose import PURPOSE_PRODUCT_UPDATE, PURPOSE_SYSTEM, PurposeRejected, assert_purpose_allowed
from messaging.services import record_prompt_decision, set_message_purpose, unread_count_for_user
from messaging.consent_texts import get_consent_definition


PNG = (
    b"\x89PNG\r\n\x1a\n\x00\x00\x00\rIHDR\x00\x00\x00\x01"
    b"\x00\x00\x00\x01\x08\x02\x00\x00\x00\x90wS\xde\x00\x00\x00\x0cIDAT"
    b"\x08\xd7c\xf8\xcf\xc0\x00\x00\x00\x03\x00\x01\x00\x05\xfe\xd4\xef"
    b"\x00\x00\x00\x00IEND\xaeB`\x82"
)


def make_user(username, role):
    user = User.objects.create_user(username=username, password="pass12345", email=f"{username}@test.ru")
    profile = user.profile
    profile.role = role
    profile.account_active = True
    profile.account_blocked = False
    profile.save(update_fields=["role", "account_active", "account_blocked"])
    return user


class MessagingApiTests(TestCase):
    def setUp(self):
        self.teacher = make_user("msg_teacher", Profile.Role.TEACHER)
        self.other = make_user("msg_other", Profile.Role.TEACHER)
        self.student = make_user("msg_student", Profile.Role.STUDENT)
        self.client = APIClient()
        self.client.force_login(self.teacher)

    def _ticket(self, subject="Не работает микрофон", text="На уроке тишина"):
        upload = SimpleUploadedFile("shot.png", PNG, content_type="image/png")
        return self.client.post(
            "/api/cabinet/messages/support/tickets/",
            {"category": "technical", "subject": subject, "text": text, "files": upload},
            format="multipart",
        )

    def test_student_opens_own_service_dialogs_only(self):
        client = APIClient()
        client.force_login(self.student)
        response = client.get("/api/cabinet/messages/conversations/")
        self.assertEqual(response.status_code, 200, response.content)
        kinds = {row["kind"] for row in response.json()["conversations"]}
        self.assertEqual(kinds, {"support", "platform"})
        created = self._ticket()
        stranger = APIClient()
        stranger.force_login(self.student)
        hidden = stranger.get(
            f"/api/cabinet/messages/conversations/{created.json()['conversation']['id']}/messages/"
        )
        self.assertEqual(hidden.status_code, 404)

    def test_ticket_creates_one_support_conversation(self):
        first = self._ticket()
        self.assertEqual(first.status_code, 201, first.content)
        second = self.client.post(
            "/api/cabinet/messages/support/tickets/",
            {"category": "billing", "subject": "Вопрос по оплате", "text": "Чек не пришёл"},
            format="multipart",
        )
        self.assertEqual(second.status_code, 201)
        self.assertEqual(first.json()["conversation"]["id"], second.json()["conversation"]["id"])
        self.assertEqual(Conversation.objects.filter(subject_user=self.teacher, kind="support").count(), 1)
        self.assertEqual(SupportTicket.objects.filter(conversation__subject_user=self.teacher).count(), 2)

    def test_other_teacher_cannot_read_conversation_or_file(self):
        created = self._ticket()
        conversation_id = created.json()["conversation"]["id"]
        attachment_id = created.json()["message"]["attachments"][0]["id"]
        stranger = APIClient()
        stranger.force_login(self.other)
        listing = stranger.get(f"/api/cabinet/messages/conversations/{conversation_id}/messages/")
        self.assertEqual(listing.status_code, 404)
        download = stranger.get(f"/api/cabinet/messages/attachments/{attachment_id}/")
        self.assertEqual(download.status_code, 404)
        own = self.client.get(f"/api/cabinet/messages/attachments/{attachment_id}/")
        self.assertEqual(own.status_code, 200)
        self.assertIn(own["Content-Type"], ("image/png", "image/png; charset=utf-8"))
        self.assertEqual(MessagingAccessLog.objects.filter(attachment_id=attachment_id).count(), 1)
        self.assertFalse(UserConsent.objects.filter(user=self.teacher).exists())

    def test_blocks_executable_and_html_disguised_as_text(self):
        exe = self.client.post(
            "/api/cabinet/messages/support/tickets/",
            {
                "category": "other",
                "subject": "Файл",
                "text": "Смотрите",
                "files": SimpleUploadedFile("run.exe", b"MZ...", content_type="application/octet-stream"),
            },
            format="multipart",
        )
        self.assertEqual(exe.status_code, 400)
        html = self.client.post(
            "/api/cabinet/messages/support/tickets/",
            {
                "category": "other",
                "subject": "Текст",
                "text": "Смотрите",
                "files": SimpleUploadedFile("note.txt", b"<script>alert(1)</script>", content_type="text/plain"),
            },
            format="multipart",
        )
        self.assertEqual(html.status_code, 400)

    def test_unread_ignores_own_messages_and_internal_notes(self):
        created = self._ticket()
        conversation_id = created.json()["conversation"]["id"]
        self.assertEqual(self.client.get("/api/cabinet/messages/unread-count/").json()["unread_count"], 0)
        conversation = Conversation.objects.get(pk=conversation_id)
        staff = self.other
        ConversationParticipant.objects.create(
            conversation=conversation,
            user=staff,
            participant_role=ConversationParticipant.Role.STAFF,
        )
        incoming = Message.objects.create(
            conversation=conversation,
            sender=staff,
            sender_type=Message.SenderType.STAFF,
            purpose="support",
            text="Проверьте браузер",
        )
        Message.objects.create(
            conversation=conversation,
            sender=staff,
            sender_type=Message.SenderType.STAFF,
            message_type=Message.MessageType.INTERNAL_NOTE,
            text="Видно только в Safari",
        )
        self.assertEqual(unread_count_for_user(self.teacher), 1)
        listed = self.client.get(f"/api/cabinet/messages/conversations/{conversation_id}/messages/")
        texts = [row["text"] for row in listed.json()["messages"]]
        self.assertIn("Проверьте браузер", texts)
        self.assertNotIn("Видно только в Safari", texts)
        self.assertNotIn("sender_id", listed.json()["messages"][0])
        read = self.client.post(
            f"/api/cabinet/messages/conversations/{conversation_id}/read/",
            {"message_id": incoming.id},
            format="json",
        )
        self.assertEqual(read.status_code, 200)
        self.assertEqual(read.json()["unread_count"], 0)

    def test_reply_and_delivery_cursor(self):
        created = self._ticket()
        conversation_id = created.json()["conversation"]["id"]
        first_id = created.json()["message"]["id"]
        reply = self.client.post(
            f"/api/cabinet/messages/conversations/{conversation_id}/messages/",
            {"text": "Уточняю", "reply_to": first_id, "client_message_id": "c-1"},
            format="json",
        )
        self.assertEqual(reply.status_code, 201, reply.content)
        self.assertEqual(reply.json()["message"]["reply_to"]["id"], first_id)
        self.assertEqual(reply.json()["message"]["delivery_status"], "sent")
        again = self.client.post(
            f"/api/cabinet/messages/conversations/{conversation_id}/messages/",
            {"text": "Уточняю", "reply_to": first_id, "client_message_id": "c-1"},
            format="json",
        )
        self.assertEqual(again.json()["message"]["id"], reply.json()["message"]["id"])
        conversation = Conversation.objects.get(pk=conversation_id)
        ConversationParticipant.objects.create(
            conversation=conversation,
            user=self.other,
            participant_role=ConversationParticipant.Role.STAFF,
        )
        ConversationReadState.objects.create(
            conversation=conversation,
            user=self.other,
            last_delivered_message_id=reply.json()["message"]["id"],
            last_read_message_id=reply.json()["message"]["id"],
        )
        listed = self.client.get(f"/api/cabinet/messages/conversations/{conversation_id}/messages/")
        own = [row for row in listed.json()["messages"] if row["id"] == reply.json()["message"]["id"]][0]
        self.assertEqual(own["delivery_status"], "read")

    def test_attachment_is_unscanned(self):
        created = self._ticket()
        attachment = MessageAttachment.objects.get(pk=created.json()["message"]["attachments"][0]["id"])
        self.assertEqual(attachment.scan_status, MessageAttachment.ScanStatus.UNSCANNED)
        self.assertTrue(attachment.storage_key.startswith("cabinet/messages/"))


class MessagingPolicyTests(TestCase):
    def setUp(self):
        self.teacher = make_user("policy_teacher", Profile.Role.TEACHER)

    def test_empty_prompt_choice_is_not_consent(self):
        state = record_prompt_decision(
            user=self.teacher,
            email_opt_in=False,
            inapp_opt_in=False,
            source="first_message_prompt",
            ip_address="127.0.0.1",
            user_agent="test",
        )
        self.assertIsNotNone(state.decided_at)
        self.assertFalse(UserConsent.objects.filter(user=self.teacher, granted=True).exists())
        self.assertFalse(UserConsentLog.objects.filter(user=self.teacher, action="granted").exists())
        self.assertEqual(state.prompt_key, "marketing_preferences_v1")
        self.assertEqual(state.consent_text_version, MARKETING_CONSENT_V1)
        self.assertEqual(state.text_sha256, consent_text_sha256())
        definition = get_consent_definition()
        self.assertIn("специальные предложения", definition["inapp_text"])

    def test_opt_in_writes_grant_and_keeps_ip_on_the_log_only(self):
        record_prompt_decision(
            user=self.teacher,
            email_opt_in=False,
            inapp_opt_in=True,
            source="notification_settings",
            ip_address="10.0.0.8",
            user_agent="browser",
        )
        consent = UserConsent.objects.get(user=self.teacher, channel="inapp_marketing")
        self.assertTrue(consent.granted)
        self.assertFalse(hasattr(consent, "ip_address") and getattr(consent, "ip_address", None))
        log = UserConsentLog.objects.get(user=self.teacher)
        self.assertEqual(log.action, "granted")
        self.assertEqual(log.ip_address, "10.0.0.8")
        self.assertNotEqual(consent.text_sha256, "")

    def test_commercial_signal_cannot_be_saved_as_operational(self):
        neutral = get_consent_definition()["neutral_intro"]
        assert_purpose_allowed(PURPOSE_PRODUCT_UPDATE, neutral)
        with self.assertRaises(PurposeRejected):
            assert_purpose_allowed(PURPOSE_SYSTEM, "Только сегодня тариф со скидкой 30%")
        conversation = Conversation.objects.create(subject_user=self.teacher, kind=Conversation.Kind.PLATFORM)
        message = Message.objects.create(
            conversation=conversation,
            sender=self.teacher,
            sender_type=Message.SenderType.STAFF,
            purpose=PURPOSE_PRODUCT_UPDATE,
            text="Только сегодня тариф со скидкой 30%",
        )
        with self.assertRaises(PurposeRejected):
            set_message_purpose(actor=self.teacher, message=message, purpose=PURPOSE_SYSTEM)
        message.refresh_from_db()
        self.assertEqual(message.purpose, PURPOSE_PRODUCT_UPDATE)
        set_message_purpose(actor=self.teacher, message=message, purpose="marketing")
        self.assertTrue(
            MessagingAuditLog.objects.filter(action="message_purpose_changed", object_id=str(message.id)).exists()
        )

    @override_settings(
        CHANNEL_LAYERS={"default": {"BACKEND": "channels.layers.InMemoryChannelLayer"}},
        CACHES={"default": {"BACKEND": "django.core.cache.backends.locmem.LocMemCache"}},
    )
    def test_deploy_check_reports_missing_retention(self):
        errors = messaging_deploy_checks(None)
        ids = {item.id for item in errors}
        self.assertIn("messaging.E001", ids)
        self.assertIn("messaging.E002", ids)
        self.assertIn("messaging.E003", ids)

    @override_settings(DEBUG=False, MESSAGING_FORCE_PRODUCTION_GATE=True)
    def test_production_api_stays_closed_without_retention(self):
        client = APIClient()
        client.force_login(self.teacher)
        response = client.get("/api/cabinet/messages/unread-count/")
        self.assertEqual(response.status_code, 503)
        self.assertEqual(response.json()["code"], "messaging_not_ready")


class MessagingDirectAccessTests(TestCase):
    def setUp(self):
        self.teacher = make_user("direct_teacher", Profile.Role.TEACHER)
        self.teacher.profile.name = "Дарья"
        self.teacher.profile.surname = "Витальевна"
        self.teacher.profile.save(update_fields=["name", "surname"])
        self.colleague = make_user("direct_colleague", Profile.Role.TEACHER)
        self.colleague.profile.name = "Анна"
        self.colleague.profile.surname = "Морозова"
        self.colleague.profile.save(update_fields=["name", "surname"])
        self.student = make_user("direct_student", Profile.Role.STUDENT)
        self.other_student = make_user("direct_other_student", Profile.Role.STUDENT)
        Student.objects.create(
            teacher=self.teacher,
            user=self.student,
            first_name="София",
            last_name="К",
            grade=11,
        )
        Student.objects.create(
            teacher=self.colleague,
            user=self.other_student,
            first_name="Иван",
            last_name="П",
            grade=9,
        )
        self.client = APIClient()
        self.client.force_login(self.teacher)

    def test_teacher_is_found_by_email_or_login_not_name(self):
        Student.objects.create(
            teacher=self.teacher,
            first_name="Пётр",
            last_name="Без аккаунта",
            email="roster-only@example.test",
        )
        idle = self.client.get("/api/cabinet/messages/contacts/").json()["contacts"]
        self.assertTrue(any(row["user_id"] == self.student.id for row in idle))
        self.assertTrue(any(row["can_message"] is False and row["name"].startswith("Пётр") for row in idle))
        self.assertFalse(any(row["role"] == "teacher" for row in idle))
        by_name = self.client.get("/api/cabinet/messages/contacts/?q=Морозова").json()["contacts"]
        self.assertEqual([row["user_id"] for row in by_name if row["role"] == "teacher"], [self.colleague.id])
        by_login = self.client.get("/api/cabinet/messages/contacts/?q=direct_colleague").json()["contacts"]
        self.assertEqual([row["user_id"] for row in by_login if row["role"] == "teacher"], [self.colleague.id])
        by_email = self.client.get("/api/cabinet/messages/contacts/?q=direct_colleague@test.ru").json()["contacts"]
        self.assertTrue(any(row["user_id"] == self.colleague.id for row in by_email))
        students = self.client.get("/api/cabinet/messages/contacts/?q=София").json()["contacts"]
        self.assertTrue(any(row["user_id"] == self.student.id for row in students))
        pupil = APIClient()
        pupil.force_login(self.student)
        found_by_name = pupil.get("/api/cabinet/messages/contacts/?q=Витальевна").json()["contacts"]
        self.assertEqual([row["user_id"] for row in found_by_name], [self.teacher.id])
        hidden = pupil.get("/api/cabinet/messages/contacts/?q=Морозова").json()["contacts"]
        self.assertFalse(any(row["user_id"] == self.colleague.id for row in hidden))
        found = pupil.get("/api/cabinet/messages/contacts/?q=direct_teacher@test.ru").json()["contacts"]
        self.assertEqual([row["user_id"] for row in found], [self.teacher.id])

    def test_contacts_follow_real_roster(self):
        student = APIClient()
        student.force_login(self.student)
        contacts = student.get("/api/cabinet/messages/contacts/").json()["contacts"]
        ids = {row["user_id"] for row in contacts}
        self.assertEqual(ids, {self.teacher.id})
        found = student.get("/api/cabinet/messages/contacts/?q=direct_teacher@test.ru").json()["contacts"]
        self.assertEqual({row["user_id"] for row in found}, {self.teacher.id})
        self.assertNotIn(self.colleague.id, {row["user_id"] for row in found})
        self.assertNotIn(self.other_student.id, ids)
        denied_teacher = student.post(
            "/api/cabinet/messages/conversations/direct/",
            {"user_id": self.colleague.id},
            format="json",
        )
        denied_peer = student.post(
            "/api/cabinet/messages/conversations/direct/",
            {"user_id": self.other_student.id},
            format="json",
        )
        self.assertEqual(denied_teacher.status_code, 404)
        self.assertEqual(denied_peer.status_code, 404)

    def test_direct_chat_is_unique_and_foreign_student_is_hidden(self):
        foreign = self.client.post(
            "/api/cabinet/messages/conversations/direct/",
            {"user_id": self.other_student.id},
            format="json",
        )
        self.assertEqual(foreign.status_code, 404)
        first = self.client.post(
            "/api/cabinet/messages/conversations/direct/",
            {"user_id": self.colleague.id},
            format="json",
        )
        self.assertEqual(first.status_code, 200, first.content)
        second = self.client.post(
            "/api/cabinet/messages/conversations/direct/",
            {"user_id": self.colleague.id},
            format="json",
        )
        self.assertEqual(first.json()["conversation"]["id"], second.json()["conversation"]["id"])
        own_student = self.client.post(
            "/api/cabinet/messages/conversations/direct/",
            {"user_id": self.student.id},
            format="json",
        )
        self.assertEqual(own_student.status_code, 200, own_student.content)
        conversation_id = own_student.json()["conversation"]["id"]
        student = APIClient()
        student.force_login(self.student)
        opened = student.post(
            "/api/cabinet/messages/conversations/direct/",
            {"user_id": self.teacher.id},
            format="json",
        )
        self.assertEqual(opened.json()["conversation"]["id"], conversation_id)
        sent = student.post(
            f"/api/cabinet/messages/conversations/{conversation_id}/messages/",
            {"text": "Здравствуйте", "client_message_id": "s-1"},
            format="json",
        )
        self.assertEqual(sent.status_code, 201, sent.content)
        stranger = APIClient()
        stranger.force_login(self.colleague)
        self.assertEqual(
            stranger.get(f"/api/cabinet/messages/conversations/{conversation_id}/messages/").status_code,
            404,
        )
        self.assertEqual(
            stranger.post(
                f"/api/cabinet/messages/conversations/{conversation_id}/messages/",
                {"text": "чужой"},
                format="json",
            ).status_code,
            404,
        )

    def test_edit_is_limited_to_fifteen_minutes_and_delete_hides_text(self):
        opened = self.client.post(
            "/api/cabinet/messages/conversations/direct/",
            {"user_id": self.colleague.id},
            format="json",
        )
        conversation_id = opened.json()["conversation"]["id"]
        created = self.client.post(
            f"/api/cabinet/messages/conversations/{conversation_id}/messages/",
            {"text": "Черновик", "client_message_id": "e-1"},
            format="json",
        )
        message_id = created.json()["message"]["id"]
        edited = self.client.patch(
            f"/api/cabinet/messages/conversations/{conversation_id}/messages/{message_id}/",
            {"text": "Исправлено"},
            format="json",
        )
        self.assertEqual(edited.status_code, 200, edited.content)
        self.assertEqual(edited.json()["message"]["text"], "Исправлено")
        self.assertIsNotNone(edited.json()["message"]["edited_at"])
        Message.objects.filter(pk=message_id).update(created_at=timezone.now() - timedelta(minutes=16))
        late = self.client.patch(
            f"/api/cabinet/messages/conversations/{conversation_id}/messages/{message_id}/",
            {"text": "Слишком поздно"},
            format="json",
        )
        self.assertEqual(late.status_code, 400)
        removed = self.client.delete(
            f"/api/cabinet/messages/conversations/{conversation_id}/messages/{message_id}/",
        )
        self.assertEqual(removed.status_code, 200)
        self.assertEqual(removed.json()["message"]["text"], "")
        self.assertTrue(removed.json()["message"]["deleted"])

    def test_developer_reply_requires_an_open_message(self):
        conversation = Conversation.objects.create(subject_user=self.teacher, kind=Conversation.Kind.PLATFORM)
        ConversationParticipant.objects.create(
            conversation=conversation,
            user=self.teacher,
            participant_role=ConversationParticipant.Role.OWNER,
        )
        closed = Message.objects.create(
            conversation=conversation,
            sender=self.colleague,
            sender_type=Message.SenderType.STAFF,
            text="Обновление",
            reply_disabled=True,
        )
        denied = self.client.post(
            f"/api/cabinet/messages/conversations/{conversation.id}/messages/",
            {"text": "А можно подробнее?", "reply_to": closed.id},
            format="json",
        )
        self.assertEqual(denied.status_code, 400)
        opened = Message.objects.create(
            conversation=conversation,
            sender=self.colleague,
            sender_type=Message.SenderType.STAFF,
            text="Можно ответить",
            reply_disabled=False,
        )
        allowed = self.client.post(
            f"/api/cabinet/messages/conversations/{conversation.id}/messages/",
            {"text": "Спасибо", "reply_to": opened.id},
            format="json",
        )
        self.assertEqual(allowed.status_code, 201, allowed.content)


class CommunityAccessTests(TestCase):
    def setUp(self):
        self.admin = make_user("community_admin", Profile.Role.TEACHER)
        self.admin.is_superuser = True
        self.admin.save(update_fields=["is_superuser"])
        self.teacher = make_user("community_teacher", Profile.Role.TEACHER)
        self.teacher.profile.name = "Анна"
        self.teacher.profile.surname = "Морозова"
        self.teacher.profile.save(update_fields=["name", "surname"])
        self.outsider = make_user("community_outsider", Profile.Role.TEACHER)
        self.student = make_user("community_student", Profile.Role.STUDENT)
        self.client = APIClient()

    def _as_admin(self):
        self.client.force_login(self.admin)
        return override_settings(MESSAGING_PLATFORM_ADMIN_ID=self.admin.id)

    def test_students_cannot_see_or_join_communities(self):
        with self._as_admin():
            created = self.client.post(
                "/api/cabinet/messages/communities/",
                {"name": "Информатика", "subject": "Информатика", "description": "Закрытый чат"},
                format="json",
            )
        self.assertEqual(created.status_code, 201, created.content)
        conversation_id = created.json()["conversation_id"]
        with override_settings(MESSAGING_PLATFORM_ADMIN_ID=self.admin.id):
            invite = self.client.post(
                f"/api/cabinet/messages/conversations/{conversation_id}/invites/",
                {"user_id": self.teacher.id},
                format="json",
            )
        self.assertEqual(invite.status_code, 201, invite.content)
        token = invite.json()["token"]
        student = APIClient()
        student.force_login(self.student)
        self.assertEqual(student.get("/api/cabinet/messages/communities/").status_code, 404)
        self.assertEqual(
            student.get(f"/api/cabinet/messages/conversations/{conversation_id}/messages/").status_code,
            404,
        )
        self.assertEqual(student.get(f"/api/cabinet/messages/community-invites/{token}/").status_code, 404)
        self.assertEqual(
            student.post("/api/cabinet/messages/community-invites/accept/", {"token": token}, format="json").status_code,
            404,
        )
        listing = student.get("/api/cabinet/messages/conversations/")
        self.assertFalse(any(row["kind"] == "community" for row in listing.json()["conversations"]))
        self.assertEqual(listing.json()["invitations"], [])

    def test_join_requires_a_real_invite_and_does_not_duplicate(self):
        with self._as_admin():
            created = self.client.post(
                "/api/cabinet/messages/communities/",
                {"name": "Математика", "subject": "Математика", "description": "Для преподавателей математики"},
                format="json",
            )
            conversation_id = created.json()["conversation_id"]
            invite = self.client.post(
                f"/api/cabinet/messages/conversations/{conversation_id}/invites/",
                {"user_id": self.teacher.id},
                format="json",
            )
        outsider = APIClient()
        outsider.force_login(self.outsider)
        self.assertEqual(
            outsider.get(f"/api/cabinet/messages/conversations/{conversation_id}/messages/").status_code,
            404,
        )
        self.assertEqual(
            outsider.post(
                "/api/cabinet/messages/community-invites/accept/",
                {"community_id": created.json()["id"], "token": "forged"},
                format="json",
            ).status_code,
            404,
        )
        teacher = APIClient()
        teacher.force_login(self.teacher)
        accepted = teacher.post(
            "/api/cabinet/messages/community-invites/accept/",
            {"invite_id": invite.json()["id"]},
            format="json",
        )
        self.assertEqual(accepted.status_code, 200, accepted.content)
        self.assertEqual(accepted.json()["conversation_id"], conversation_id)
        sent = teacher.post(
            f"/api/cabinet/messages/conversations/{conversation_id}/messages/",
            {"text": "Кто смотрел демоверсию?", "mention_user_ids": [self.outsider.id]},
            format="json",
        )
        self.assertEqual(sent.status_code, 201, sent.content)
        self.assertEqual(sent.json()["message"]["text"], "Кто смотрел демоверсию?")
        again = teacher.post(
            "/api/cabinet/messages/community-invites/accept/",
            {"invite_id": invite.json()["id"]},
            format="json",
        )
        self.assertEqual(again.status_code, 404)


class MessagingSecurityRegressionTests(TestCase):
    def setUp(self):
        self.admin = make_user("sec_admin", Profile.Role.TEACHER)
        self.admin.is_superuser = True
        self.admin.is_staff = True
        self.admin.save(update_fields=["is_superuser", "is_staff"])
        self.teacher = make_user("sec_teacher", Profile.Role.TEACHER)
        self.colleague = make_user("sec_colleague", Profile.Role.TEACHER)
        self.outsider = make_user("sec_outsider", Profile.Role.TEACHER)
        self.student = make_user("sec_student", Profile.Role.STUDENT)
        self.other_student = make_user("sec_other_student", Profile.Role.STUDENT)
        Student.objects.create(teacher=self.teacher, user=self.student, first_name="София", last_name="К", grade=10)
        Student.objects.create(teacher=self.colleague, user=self.other_student, first_name="Иван", last_name="П", grade=9)
        self.teacher_client = APIClient()
        self.teacher_client.force_login(self.teacher)

    def _community(self, name="Физика"):
        client = APIClient()
        client.force_login(self.admin)
        with override_settings(MESSAGING_PLATFORM_ADMIN_ID=self.admin.id):
            created = client.post(
                "/api/cabinet/messages/communities/",
                {"name": name, "subject": name, "description": "Закрытый чат"},
                format="json",
            )
        self.assertEqual(created.status_code, 201, created.content)
        return created.json()["conversation_id"]

    def _invite(self, conversation_id, user_id):
        client = APIClient()
        client.force_login(self.admin)
        with override_settings(MESSAGING_PLATFORM_ADMIN_ID=self.admin.id):
            invite = client.post(
                f"/api/cabinet/messages/conversations/{conversation_id}/invites/",
                {"user_id": user_id},
                format="json",
            )
        self.assertEqual(invite.status_code, 201, invite.content)
        return invite.json()

    def test_student_cannot_message_student(self):
        student = APIClient()
        student.force_login(self.student)
        response = student.post(
            "/api/cabinet/messages/conversations/direct/",
            {"user_id": self.other_student.id, "role": "teacher"},
            format="json",
        )
        self.assertEqual(response.status_code, 404)

    def test_student_cannot_message_unrelated_teacher(self):
        student = APIClient()
        student.force_login(self.student)
        response = student.post(
            "/api/cabinet/messages/conversations/direct/",
            {"user_id": self.colleague.id},
            format="json",
        )
        self.assertEqual(response.status_code, 404)
        contacts = student.get("/api/cabinet/messages/contacts/?q=sec_colleague").json()["contacts"]
        self.assertFalse(any(row["user_id"] == self.colleague.id for row in contacts))

    def test_student_can_message_own_teacher(self):
        student = APIClient()
        student.force_login(self.student)
        opened = student.post("/api/cabinet/messages/conversations/direct/", {"user_id": self.teacher.id}, format="json")
        self.assertEqual(opened.status_code, 200, opened.content)
        sent = student.post(
            f"/api/cabinet/messages/conversations/{opened.json()['conversation']['id']}/messages/",
            {"text": "Добрый день", "sender_id": self.teacher.id},
            format="json",
        )
        self.assertEqual(sent.status_code, 201, sent.content)
        self.assertTrue(sent.json()["message"]["is_own"])
        self.assertNotEqual(sent.json()["message"]["author_user_id"], self.teacher.id)

    def test_teacher_can_message_teacher(self):
        opened = self.teacher_client.post(
            "/api/cabinet/messages/conversations/direct/",
            {"user_id": self.colleague.id},
            format="json",
        )
        self.assertEqual(opened.status_code, 200, opened.content)

    def test_teacher_can_message_own_student(self):
        opened = self.teacher_client.post(
            "/api/cabinet/messages/conversations/direct/",
            {"user_id": self.student.id},
            format="json",
        )
        self.assertEqual(opened.status_code, 200, opened.content)

    def test_teacher_cannot_message_foreign_student(self):
        response = self.teacher_client.post(
            "/api/cabinet/messages/conversations/direct/",
            {"user_id": self.other_student.id, "student_id": self.other_student.id},
            format="json",
        )
        self.assertEqual(response.status_code, 404)

    def test_user_cannot_read_or_change_foreign_message(self):
        opened = self.teacher_client.post(
            "/api/cabinet/messages/conversations/direct/",
            {"user_id": self.student.id},
            format="json",
        )
        conversation_id = opened.json()["conversation"]["id"]
        sent = self.teacher_client.post(
            f"/api/cabinet/messages/conversations/{conversation_id}/messages/",
            {"text": "Секретно"},
            format="json",
        )
        message_id = sent.json()["message"]["id"]
        stranger = APIClient()
        stranger.force_login(self.colleague)
        self.assertEqual(stranger.get(f"/api/cabinet/messages/conversations/{conversation_id}/messages/").status_code, 404)
        self.assertEqual(
            stranger.patch(
                f"/api/cabinet/messages/conversations/{conversation_id}/messages/{message_id}/",
                {"text": "подмена"},
                format="json",
            ).status_code,
            404,
        )
        self.assertEqual(
            stranger.delete(f"/api/cabinet/messages/conversations/{conversation_id}/messages/{message_id}/").status_code,
            404,
        )
        self.colleague.is_staff = True
        self.colleague.save(update_fields=["is_staff"])
        flagged = stranger.post(
            f"/api/cabinet/messages/conversations/{conversation_id}/messages/{message_id}/important/",
            {"is_important": True},
            format="json",
        )
        self.assertEqual(flagged.status_code, 404)
        self.assertNotIn("Секретно", flagged.content.decode())

    def test_duplicate_direct_conversation_not_created(self):
        first = self.teacher_client.post("/api/cabinet/messages/conversations/direct/", {"user_id": self.colleague.id}, format="json")
        second = self.teacher_client.post("/api/cabinet/messages/conversations/direct/", {"user_id": self.colleague.id}, format="json")
        self.assertEqual(first.json()["conversation"]["id"], second.json()["conversation"]["id"])
        self.assertEqual(Conversation.objects.filter(kind="direct", pair_key=f"{min(self.teacher.id, self.colleague.id)}:{max(self.teacher.id, self.colleague.id)}").count(), 1)

    def test_archived_and_paused_keep_history_but_block_new_messages(self):
        opened = self.teacher_client.post("/api/cabinet/messages/conversations/direct/", {"user_id": self.student.id}, format="json")
        conversation_id = opened.json()["conversation"]["id"]
        sent = self.teacher_client.post(
            f"/api/cabinet/messages/conversations/{conversation_id}/messages/",
            {"text": "До архива"},
            format="json",
        )
        self.assertEqual(sent.status_code, 201, sent.content)
        for status in ("paused", "archived"):
            Student.objects.filter(teacher=self.teacher, user=self.student).update(status=status)
            history = self.teacher_client.get(f"/api/cabinet/messages/conversations/{conversation_id}/messages/")
            self.assertEqual(history.status_code, 200, history.content)
            self.assertIn("До архива", history.content.decode())
            listed = self.teacher_client.get("/api/cabinet/messages/conversations/")
            self.assertTrue(any(row["id"] == conversation_id and row["can_compose"] is False for row in listed.json()["conversations"]))
            blocked = self.teacher_client.post(
                f"/api/cabinet/messages/conversations/{conversation_id}/messages/",
                {"text": "ещё"},
                format="json",
            )
            self.assertEqual(blocked.status_code, 400, blocked.content)
        Student.objects.filter(teacher=self.teacher, user=self.student).update(status="active")
        restored = self.teacher_client.post(
            f"/api/cabinet/messages/conversations/{conversation_id}/messages/",
            {"text": "Снова можно писать"},
            format="json",
        )
        self.assertEqual(restored.status_code, 201, restored.content)

    def test_student_cannot_access_community(self):
        conversation_id = self._community()
        student = APIClient()
        student.force_login(self.student)
        self.assertEqual(student.get("/api/cabinet/messages/communities/").status_code, 404)
        self.assertEqual(student.get(f"/api/cabinet/messages/conversations/{conversation_id}/messages/").status_code, 404)
        self.assertEqual(student.get(f"/api/cabinet/messages/conversations/{conversation_id}/community/").status_code, 404)
        self.assertEqual(student.get("/api/cabinet/messages/search/?q=Физика").json()["results"], [])

    def test_non_member_cannot_read_or_send_community_message(self):
        conversation_id = self._community()
        outsider = APIClient()
        outsider.force_login(self.outsider)
        self.assertEqual(outsider.get(f"/api/cabinet/messages/conversations/{conversation_id}/messages/").status_code, 404)
        self.assertEqual(
            outsider.post(
                f"/api/cabinet/messages/conversations/{conversation_id}/messages/",
                {"text": "чужой"},
                format="json",
            ).status_code,
            404,
        )
        self.assertEqual(outsider.get(f"/api/cabinet/messages/conversations/{conversation_id}/community/").status_code, 404)

    def test_invalid_expired_and_exhausted_invites(self):
        conversation_id = self._community("Химия")
        teacher = APIClient()
        teacher.force_login(self.teacher)
        self.assertEqual(teacher.post("/api/cabinet/messages/community-invites/accept/", {"token": "nope"}, format="json").status_code, 404)
        admin = APIClient()
        admin.force_login(self.admin)
        with override_settings(MESSAGING_PLATFORM_ADMIN_ID=self.admin.id):
            link = admin.post(
                f"/api/cabinet/messages/conversations/{conversation_id}/invites/",
                {"max_uses": 1, "expires_at": "2000-01-01T00:00:00Z"},
                format="json",
            )
        self.assertEqual(link.status_code, 201, link.content)
        self.assertEqual(
            teacher.post("/api/cabinet/messages/community-invites/accept/", {"token": link.json()["token"]}, format="json").status_code,
            404,
        )
        with override_settings(MESSAGING_PLATFORM_ADMIN_ID=self.admin.id):
            limited = admin.post(
                f"/api/cabinet/messages/conversations/{conversation_id}/invites/",
                {"max_uses": 1},
                format="json",
            )
        self.assertEqual(
            teacher.post("/api/cabinet/messages/community-invites/accept/", {"token": limited.json()["token"]}, format="json").status_code,
            200,
        )
        colleague = APIClient()
        colleague.force_login(self.colleague)
        self.assertEqual(
            colleague.post("/api/cabinet/messages/community-invites/accept/", {"token": limited.json()["token"]}, format="json").status_code,
            404,
        )

    def test_removed_and_banned_member_lose_access(self):
        from messaging.models import CommunityMember
        conversation_id = self._community("Биология")
        invite = self._invite(conversation_id, self.teacher.id)
        teacher = APIClient()
        teacher.force_login(self.teacher)
        self.assertEqual(teacher.post("/api/cabinet/messages/community-invites/accept/", {"invite_id": invite["id"]}, format="json").status_code, 200)
        self.assertEqual(CommunityMember.objects.filter(user=self.teacher, left_at__isnull=True, is_banned=False).count(), 1)
        promoted = teacher.post(
            f"/api/cabinet/messages/conversations/{conversation_id}/members/{self.teacher.id}/",
            {"action": "role", "role": "admin"},
            format="json",
        )
        self.assertEqual(promoted.status_code, 403)
        admin = APIClient()
        admin.force_login(self.admin)
        with override_settings(MESSAGING_PLATFORM_ADMIN_ID=self.admin.id):
            removed = admin.post(
                f"/api/cabinet/messages/conversations/{conversation_id}/members/{self.teacher.id}/",
                {"action": "remove"},
                format="json",
            )
        self.assertEqual(removed.status_code, 200, removed.content)
        self.assertEqual(teacher.get(f"/api/cabinet/messages/conversations/{conversation_id}/messages/").status_code, 404)
        invite_again = self._invite(conversation_id, self.teacher.id)
        self.assertEqual(teacher.post("/api/cabinet/messages/community-invites/accept/", {"invite_id": invite_again["id"]}, format="json").status_code, 200)
        with override_settings(MESSAGING_PLATFORM_ADMIN_ID=self.admin.id):
            banned = admin.post(
                f"/api/cabinet/messages/conversations/{conversation_id}/members/{self.teacher.id}/",
                {"action": "ban"},
                format="json",
            )
        self.assertEqual(banned.status_code, 200, banned.content)
        self.assertEqual(
            teacher.post(
                f"/api/cabinet/messages/conversations/{conversation_id}/messages/",
                {"text": "после бана"},
                format="json",
            ).status_code,
            404,
        )
        third = self._invite(conversation_id, self.teacher.id)
        self.assertEqual(teacher.post("/api/cabinet/messages/community-invites/accept/", {"invite_id": third["id"]}, format="json").status_code, 404)

    def test_reply_and_read_cannot_cross_conversations(self):
        own = self.teacher_client.post("/api/cabinet/messages/conversations/direct/", {"user_id": self.colleague.id}, format="json")
        student_chat = self.teacher_client.post("/api/cabinet/messages/conversations/direct/", {"user_id": self.student.id}, format="json")
        own_id = own.json()["conversation"]["id"]
        student_id = student_chat.json()["conversation"]["id"]
        foreign = self.teacher_client.post(
            f"/api/cabinet/messages/conversations/{student_id}/messages/",
            {"text": "ученику"},
            format="json",
        )
        reply = self.teacher_client.post(
            f"/api/cabinet/messages/conversations/{own_id}/messages/",
            {"text": "ответ не туда", "reply_to": foreign.json()["message"]["id"]},
            format="json",
        )
        self.assertEqual(reply.status_code, 400)
        receipt = self.teacher_client.post(
            f"/api/cabinet/messages/conversations/{own_id}/read/",
            {"message_id": foreign.json()["message"]["id"]},
            format="json",
        )
        self.assertEqual(receipt.status_code, 404)

    def test_deleted_reply_does_not_keep_the_text(self):
        opened = self.teacher_client.post("/api/cabinet/messages/conversations/direct/", {"user_id": self.colleague.id}, format="json")
        conversation_id = opened.json()["conversation"]["id"]
        original = self.teacher_client.post(
            f"/api/cabinet/messages/conversations/{conversation_id}/messages/",
            {"text": "секретная формулировка"},
            format="json",
        )
        colleague = APIClient()
        colleague.force_login(self.colleague)
        colleague.post(
            f"/api/cabinet/messages/conversations/{conversation_id}/messages/",
            {"text": "поняла", "reply_to": original.json()["message"]["id"]},
            format="json",
        )
        self.teacher_client.delete(
            f"/api/cabinet/messages/conversations/{conversation_id}/messages/{original.json()['message']['id']}/",
        )
        history = colleague.get(f"/api/cabinet/messages/conversations/{conversation_id}/messages/")
        self.assertEqual(history.status_code, 200, history.content)
        self.assertNotIn("секретная формулировка", history.content.decode())
        quotes = [row.get("reply_to") for row in history.json()["messages"] if row.get("reply_to")]
        self.assertTrue(quotes)
        self.assertEqual(quotes[0]["excerpt"], "Сообщение удалено")

    def test_attachment_requires_membership(self):
        opened = self.teacher_client.post("/api/cabinet/messages/conversations/direct/", {"user_id": self.student.id}, format="json")
        conversation_id = opened.json()["conversation"]["id"]
        upload = SimpleUploadedFile("note.png", PNG, content_type="image/png")
        sent = self.teacher_client.post(
            f"/api/cabinet/messages/conversations/{conversation_id}/messages/",
            {"text": "файл", "files": upload},
            format="multipart",
        )
        self.assertEqual(sent.status_code, 201, sent.content)
        attachment_id = sent.json()["message"]["attachments"][0]["id"]
        stranger = APIClient()
        stranger.force_login(self.colleague)
        response = stranger.get(f"/api/cabinet/messages/attachments/{attachment_id}/")
        self.assertEqual(response.status_code, 404)
        self.assertEqual(response["Cache-Control"], "private, no-store")

    def test_archived_community_hides_history_from_member(self):
        from messaging.models import Community
        conversation_id = self._community("История")
        invite = self._invite(conversation_id, self.teacher.id)
        teacher = APIClient()
        teacher.force_login(self.teacher)
        teacher.post("/api/cabinet/messages/community-invites/accept/", {"invite_id": invite["id"]}, format="json")
        Community.objects.filter(conversation_id=conversation_id).update(is_archived=True)
        self.assertEqual(teacher.get(f"/api/cabinet/messages/conversations/{conversation_id}/messages/").status_code, 404)
        admin = APIClient()
        admin.force_login(self.admin)
        with override_settings(MESSAGING_PLATFORM_ADMIN_ID=self.admin.id):
            self.assertEqual(admin.get(f"/api/cabinet/messages/conversations/{conversation_id}/messages/").status_code, 200)

    def test_search_stays_inside_membership(self):
        conversation_id = self._community("Литература")
        admin = APIClient()
        admin.force_login(self.admin)
        with override_settings(MESSAGING_PLATFORM_ADMIN_ID=self.admin.id):
            admin.post(
                f"/api/cabinet/messages/conversations/{conversation_id}/messages/",
                {"text": "уникальнаяформулировкадемоверсии"},
                format="json",
            )
        outsider = APIClient()
        outsider.force_login(self.outsider)
        results = outsider.get("/api/cabinet/messages/search/?q=уникальнаяформулировкадемоверсии").json()["results"]
        self.assertEqual(results, [])


class MessagingSocketTests(TestCase):
    def test_anonymous_socket_is_rejected(self):
        from channels.testing import WebsocketCommunicator

        from messaging.consumers import MessagingConsumer

        async def scenario():
            communicator = WebsocketCommunicator(MessagingConsumer.as_asgi(), "/ws/messaging/")
            connected, _ = await communicator.connect()
            self.assertFalse(connected)
            await communicator.disconnect()

        import asyncio
        asyncio.run(scenario())

    def test_socket_ignores_foreign_conversation(self):
        from messaging.consumers import connection_still_valid
        from messaging.services import other_participant_ids

        user = make_user("socket_teacher", Profile.Role.TEACHER)
        self.assertIsNone(other_participant_ids(user, "00000000-0000-0000-0000-000000000000"))
        self.assertTrue(connection_still_valid(user, {}))
        user.profile.account_blocked = True
        user.profile.save(update_fields=["account_blocked"])
        self.assertFalse(connection_still_valid(user, {}))
        user.profile.account_blocked = False
        user.profile.save(update_fields=["account_blocked"])
        missing = type("Session", (), {"session_key": "logged-out"})()
        self.assertFalse(connection_still_valid(user, {"session": missing}))
