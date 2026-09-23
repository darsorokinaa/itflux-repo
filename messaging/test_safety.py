import io

import qrcode
from django.core.files.uploadedfile import SimpleUploadedFile
from django.test import TestCase, override_settings
from rest_framework.test import APIClient

from Cabinet.models import Profile, Student
from messaging.models import Message, MessagingAuditLog
from messaging.safety import MessageBlocked, host_allowed, inspect_file, inspect_qr_payload, inspect_text
from messaging.tests import PNG, make_user


def _qr_png(payload: str) -> bytes:
    image = qrcode.make(payload)
    buffer = io.BytesIO()
    image.save(buffer, format="PNG")
    return buffer.getvalue()


class MessageSafetyRuleTests(TestCase):
    def test_blocks_external_links_and_obfuscation(self):
        samples = [
            "https://example.com",
            "example.com",
            "example . com",
            "example[.]com",
            "example(.)com",
            "example точка com",
            "hxxps://example.com",
            "t.me/example",
            "t . me / example",
            "vk.com/id1",
            "www.youtube.com/watch",
            "[текст](https://example.com)",
            '<a href="https://example.com">сайт</a>',
            "javascript:alert(1)",
            "data:text/html,hi",
            "mailto:a@b.com",
            "itflux.ru.evil-site.com",
        ]
        for sample in samples:
            decision = inspect_text(sample)
            self.assertEqual(decision.action, "block", sample)
            self.assertEqual(decision.reason, "EXTERNAL_URL", sample)

    def test_allows_platform_host_by_hostname_not_substring(self):
        self.assertTrue(host_allowed("itflux.ru"))
        self.assertTrue(host_allowed("www.itflux.ru"))
        self.assertTrue(host_allowed("lesson.itflux.ru"))
        self.assertFalse(host_allowed("itflux.ru.evil-site.com"))
        self.assertFalse(host_allowed("evilitflux.ru"))
        self.assertFalse(host_allowed("not-itflux.ru"))
        allowed = inspect_text("Материал: https://itflux.ru/lessons/grafiki")
        self.assertEqual(allowed.action, "allow")

    def test_blocks_contacts_cards_and_payments(self):
        blocked = {
            "name@gmail.com": "EMAIL",
            "name @ gmail . com": "EMAIL",
            "name собака gmail точка com": "EMAIL",
            "+7 999 123-45-67": "PHONE_NUMBER",
            "8 (999) 123 45 67": "PHONE_NUMBER",
            "89991234567": "PHONE_NUMBER",
            "4111111111111111": "BANK_CARD",
            "4111 1111 1111 1111": "BANK_CARD",
            "4111-1111-1111-1111": "BANK_CARD",
            "переведи на карту": "PAYMENT_REQUEST",
            "перевод по номеру телефона": "PAYMENT_REQUEST",
            "скину реквизиты": "PAYMENT_REQUEST",
            "напиши мне в телеграм": "EXTERNAL_CONTACT",
            "мой тг @example": "EXTERNAL_CONTACT",
        }
        for sample, reason in blocked.items():
            decision = inspect_text(sample)
            self.assertEqual(decision.action, "block", sample)
            self.assertEqual(decision.reason, reason, sample)

    def test_allows_classroom_language(self):
        samples = [
            "Переведите число 101101 в десятичную систему",
            "Найдите номер правильного ответа",
            "Рассмотрите карту России",
            "Постройте карту Карно",
            "Номер задания 15",
            "Банковская система является частью экономики",
            "В задаче используется номер 123",
            "В задаче дан номер 12345",
            "Откройте внутренний материал платформы",
            "Как перевести число из двоичной системы",
        ]
        for sample in samples:
            self.assertEqual(inspect_text(sample).action, "allow", sample)

    def test_platform_mention_is_not_an_external_handle(self):
        decision = inspect_text("Спасибо, @anna_teacher", mention_labels=["anna_teacher", "Анна"])
        self.assertEqual(decision.action, "allow")
        external = inspect_text("@example", mention_labels=["anna_teacher"])
        self.assertEqual(external.reason, "EXTERNAL_CONTACT")

    def test_qr_payload_and_dangerous_file(self):
        self.assertEqual(inspect_qr_payload("https://example.com/pay").reason, "EXTERNAL_URL")
        self.assertEqual(inspect_qr_payload("https://itflux.ru/cabinet/messages").action, "allow")
        self.assertEqual(inspect_qr_payload("t.me/example").reason, "EXTERNAL_URL")
        self.assertEqual(inspect_qr_payload("ST00012|Name=Ivan|PersonalAcc=40817").reason, "PAYMENT_REQUEST")
        pdf = b"%PDF-1.4\n/JavaScript (alert)\n%%EOF"
        self.assertEqual(inspect_file("lesson.pdf", pdf).reason, "DANGEROUS_ATTACHMENT")
        self.assertEqual(inspect_file("telegram_@example.pdf", b"%PDF-1.4\n%%EOF").reason, "EXTERNAL_CONTACT")
        self.assertEqual(inspect_file("pay.png", _qr_png("https://example.com/pay")).reason, "EXTERNAL_URL")
        self.assertEqual(inspect_file("pay.png", _qr_png("ST00012|Name=Ivan")).reason, "PAYMENT_REQUEST")
        self.assertEqual(inspect_file("lesson.png", _qr_png("https://itflux.ru/cabinet/messages")).action, "allow")

    def test_blocked_error_does_not_describe_the_detector(self):
        error = MessageBlocked("PHONE_NUMBER")
        self.assertNotIn("regex", error.message.casefold())
        self.assertIn("телефон", error.message.casefold())


@override_settings(MESSAGING_LINK_ALLOWLIST=["itflux.ru"], MESSAGING_SPAM_FANOUT=2)
class MessageSafetyApiTests(TestCase):
    def setUp(self):
        self.teacher = make_user("safe_teacher", Profile.Role.TEACHER)
        self.colleague = make_user("safe_colleague", Profile.Role.TEACHER)
        self.other = make_user("safe_other", Profile.Role.TEACHER)
        self.student = make_user("safe_student", Profile.Role.STUDENT)
        Student.objects.create(teacher=self.teacher, user=self.student, first_name="София", last_name="К", grade=10)
        self.client = APIClient()
        self.client.force_login(self.teacher)

    def _open(self, user_id):
        response = self.client.post("/api/cabinet/messages/conversations/direct/", {"user_id": user_id}, format="json")
        self.assertEqual(response.status_code, 200, response.content)
        return response.json()["conversation"]["id"]

    def test_blocked_message_is_not_stored(self):
        conversation_id = self._open(self.student.id)
        before = Message.objects.filter(conversation_id=conversation_id).count()
        response = self.client.post(
            f"/api/cabinet/messages/conversations/{conversation_id}/messages/",
            {"text": "Позвони +7 999 123-45-67", "sender_id": self.student.id},
            format="json",
        )
        self.assertEqual(response.status_code, 400)
        self.assertEqual(response.json()["code"], "MESSAGE_BLOCKED")
        self.assertEqual(response.json()["reason"], "PHONE_NUMBER")
        self.assertNotIn("+7", response.json()["detail"])
        self.assertEqual(Message.objects.filter(conversation_id=conversation_id).count(), before)
        self.assertTrue(MessagingAuditLog.objects.filter(action="message_blocked", meta__reason="PHONE_NUMBER").exists())
        self.assertFalse(
            MessagingAuditLog.objects.filter(meta__sha256__isnull=False, action="message_blocked")
            .exclude(meta__sha256="")
            .filter(meta__icontains="+7")
            .exists()
        )

    def test_edit_cannot_smuggle_an_external_link(self):
        conversation_id = self._open(self.colleague.id)
        created = self.client.post(
            f"/api/cabinet/messages/conversations/{conversation_id}/messages/",
            {"text": "Материал на уроке"},
            format="json",
        )
        message_id = created.json()["message"]["id"]
        edited = self.client.patch(
            f"/api/cabinet/messages/conversations/{conversation_id}/messages/{message_id}/",
            {"text": "Смотри https://example.com"},
            format="json",
        )
        self.assertEqual(edited.status_code, 400)
        self.assertEqual(edited.json()["reason"], "EXTERNAL_URL")
        self.assertEqual(Message.objects.get(pk=message_id).text, "Материал на уроке")

    def test_same_text_to_many_chats_is_limited(self):
        text = "Одинаковое объявление для нескольких диалогов"
        first = self._open(self.colleague.id)
        second = self._open(self.other.id)
        ok = self.client.post(
            f"/api/cabinet/messages/conversations/{first}/messages/",
            {"text": text},
            format="json",
        )
        self.assertEqual(ok.status_code, 201, ok.content)
        limited = self.client.post(
            f"/api/cabinet/messages/conversations/{second}/messages/",
            {"text": text},
            format="json",
        )
        self.assertEqual(limited.status_code, 400)
        self.assertEqual(limited.json()["reason"], "SPAM")

    def test_attachment_name_cannot_carry_a_handle(self):
        conversation_id = self._open(self.colleague.id)
        upload = SimpleUploadedFile("telegram_@example.png", PNG, content_type="image/png")
        response = self.client.post(
            f"/api/cabinet/messages/conversations/{conversation_id}/messages/",
            {"text": "Файл к уроку", "files": upload},
            format="multipart",
        )
        self.assertEqual(response.status_code, 400)
        self.assertEqual(response.json()["code"], "MESSAGE_BLOCKED")
        self.assertEqual(Message.objects.filter(conversation_id=conversation_id, text="Файл к уроку").count(), 0)
