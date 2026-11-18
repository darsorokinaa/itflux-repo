"""Заявка академии: проверка полей, сохранение без сырого IP, письмо после сохранения."""

import json
import tempfile
from pathlib import Path
from unittest.mock import patch

from django.conf import settings
from django.core import mail
from django.test import Client, SimpleTestCase, TestCase, override_settings

from Cabinet.academy_api import (
    ACADEMY_CONSENT_VERSION,
    ACADEMY_NOTIFY_EMAIL,
    ACADEMY_RATE_LIMIT,
    ACADEMY_SUCCESS_MESSAGE,
    hash_client_ip,
    validate_academy_lead,
)
from Cabinet.academy_models import AcademyLead

INDEX = (
    '<!doctype html><html><head><meta name="description" content="x" />'
    '<meta property="og:title" content="x" /><meta property="og:description" content="x" />'
    '<meta property="og:url" content="x" /><title>x</title></head>'
    '<body><div id="root"></div></body></html>'
)
_TMP = Path(tempfile.mkdtemp())
(_TMP / "index.html").write_text(INDEX, encoding="utf-8")

LOC_CACHE = {
    "default": {
        "BACKEND": "django.core.cache.backends.locmem.LocMemCache",
        "LOCATION": "academy-lead-tests",
    }
}

VALID = {
    "student_name": "Аня",
    "parent_name": "Марина",
    "grade": 10,
    "subject": "ege_inf",
    "contact": "@itfluxacademy",
    "comment": "Хотим закрыть вторую часть.",
    "consent": True,
    "consent_text_version": ACADEMY_CONSENT_VERSION,
    "utm_source": "vk",
    "utm_medium": "post",
    "utm_campaign": "november",
    "utm_content": "text",
    "utm_term": "oge",
    "referrer": "https://vk.com/itfluxacademy",
}


class AcademyLeadValidationTests(SimpleTestCase):
    def test_grade_must_match_subject(self):
        _, ninth = validate_academy_lead({**VALID, "grade": 9, "subject": "ege_inf"})
        self.assertIn("10–11", ninth["subject"])
        _, tenth = validate_academy_lead({**VALID, "grade": 10, "subject": "oge_inf"})
        self.assertIn("9 класса", tenth["subject"])
        cleaned, errors = validate_academy_lead({**VALID, "grade": "9", "subject": "oge_inf"})
        self.assertEqual(errors, {})
        self.assertEqual(cleaned["grade"], 9)
        cleaned, eleventh = validate_academy_lead({**VALID, "grade": 11, "subject": "ege_inf"})
        self.assertEqual(eleventh, {})
        self.assertEqual(cleaned["subject"], "ege_inf")
        _, math = validate_academy_lead({**VALID, "grade": 11, "subject": "ege_math"})
        self.assertEqual(math.get("subject"), "Выберите предмет.")

    def test_contact_is_telegram_or_phone(self):
        for contact in ("@itflux", "https://t.me/itfluxacademy", "+7 (909) 169-09-31", "89091690931", "9091690931"):
            _, errors = validate_academy_lead({**VALID, "contact": contact})
            self.assertNotIn("contact", errors, contact)
        for contact in ("", "почта@example.com", "@ab", "123", "не телефон"):
            _, errors = validate_academy_lead({**VALID, "contact": contact})
            self.assertIn("contact", errors, contact)

    def test_required_fields_and_optional_parent(self):
        _, errors = validate_academy_lead({
            "student_name": "  ",
            "grade": "",
            "subject": "",
            "contact": "",
            "consent": False,
        })
        self.assertIn("student_name", errors)
        self.assertIn("grade", errors)
        self.assertIn("subject", errors)
        self.assertIn("contact", errors)
        self.assertIn("consent", errors)
        cleaned, ok = validate_academy_lead({**VALID, "parent_name": "", "comment": ""})
        self.assertEqual(ok, {})
        self.assertEqual(cleaned["parent_name"], "")


@override_settings(
    FRONTEND_DIR=_TMP,
    DEBUG=False,
    CACHES=LOC_CACHE,
    EMAIL_BACKEND="django.core.mail.backends.locmem.EmailBackend",
)
class AcademyLeadApiTests(TestCase):
    def setUp(self):
        from django.core.cache import cache

        cache.clear()

    def post(self, payload=None, **extra):
        body = VALID if payload is None else payload
        return self.client.post(
            "/api/academy-leads/",
            data=json.dumps(body),
            content_type="application/json",
            **extra,
        )

    def test_stores_lead_without_raw_ip_and_sends_mail(self):
        ip = "203.0.113.8"
        with self.captureOnCommitCallbacks(execute=True):
            response = self.post(REMOTE_ADDR=ip)
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.json()["message"], ACADEMY_SUCCESS_MESSAGE)
        lead = AcademyLead.objects.get()
        self.assertEqual(lead.student_name, "Аня")
        self.assertEqual(lead.grade, 10)
        self.assertEqual(lead.subject, "ege_inf")
        self.assertEqual(lead.status, AcademyLead.Status.NEW)
        self.assertEqual(lead.consent_text_version, ACADEMY_CONSENT_VERSION)
        self.assertEqual(ACADEMY_CONSENT_VERSION, "academy_lead_consent_v2")
        from Cabinet.academy_consent import academy_consent_checkbox_text
        self.assertIn("законный представитель", academy_consent_checkbox_text(lead.consent_text_version))
        self.assertIsNotNone(lead.consent_at)
        self.assertTrue(lead.consent)
        self.assertEqual(lead.utm_source, "vk")
        self.assertEqual(lead.utm_term, "oge")
        self.assertEqual(lead.ip_hash, hash_client_ip(ip))
        self.assertNotIn(ip, lead.ip_hash)
        self.assertNotIn(ip, response.content.decode())
        self.assertEqual(len(mail.outbox), 1)
        message = mail.outbox[0]
        self.assertEqual(message.to, [ACADEMY_NOTIFY_EMAIL])
        self.assertEqual(message.from_email, settings.DEFAULT_FROM_EMAIL)
        self.assertIn("Аня", message.body)
        self.assertNotIn(ip, message.body)

    def test_rejects_mismatch_and_does_not_store(self):
        response = self.post({**VALID, "grade": 9, "subject": "ege_inf"})
        self.assertEqual(response.status_code, 400)
        self.assertIn("subject", response.json()["errors"])
        self.assertEqual(AcademyLead.objects.count(), 0)
        self.assertEqual(len(mail.outbox), 0)

    def test_honeypot_is_not_stored(self):
        with self.captureOnCommitCallbacks(execute=True):
            response = self.post({**VALID, "company_website": "https://spam.example"})
        self.assertEqual(response.status_code, 200)
        self.assertEqual(AcademyLead.objects.count(), 0)
        self.assertEqual(len(mail.outbox), 0)

    def test_rate_limit(self):
        for _ in range(ACADEMY_RATE_LIMIT):
            self.post({"consent": False})
        blocked = self.post()
        self.assertEqual(blocked.status_code, 429)
        self.assertEqual(AcademyLead.objects.count(), 0)

    def test_email_failure_keeps_the_lead(self):
        with patch("django.core.mail.send_mail", side_effect=OSError("smtp down")):
            with self.captureOnCommitCallbacks(execute=True):
                response = self.post()
        self.assertEqual(response.status_code, 200)
        self.assertEqual(AcademyLead.objects.count(), 1)
        self.assertEqual(len(mail.outbox), 0)

    def test_csrf_is_enforced(self):
        client = Client(enforce_csrf_checks=True)
        response = client.post(
            "/api/academy-leads/",
            data=json.dumps(VALID),
            content_type="application/json",
        )
        self.assertEqual(response.status_code, 403)
        self.assertEqual(AcademyLead.objects.count(), 0)

    def test_page_is_indexable_and_in_sitemap(self):
        page = self.client.get("/academy")
        self.assertEqual(page.status_code, 200)
        html = page.content.decode()
        self.assertIn("<title>Онлайн-академия цифровых технологий — Цифровой поток</title>", html)
        self.assertIn('property="og:title" content="Онлайн-академия цифровых технологий — Цифровой поток"', html)
        self.assertIn('property="og:description" content="Готовим к ОГЭ и ЕГЭ по информатике', html)
        self.assertIn('rel="canonical" href="https://itflux-academy.ru/academy"', html)
        self.assertIn("Цифровой поток — онлайн-академия цифровых технологий", html)
        self.assertNotIn('name="robots" content="noindex', html)
        self.assertEqual(self.client.get("/academy/").status_code, 200)
        meta = self.client.get("/api/seo/meta/?path=/academy")
        self.assertTrue(meta.json()["public"])
        self.assertEqual(meta.json()["canonical"], "https://itflux-academy.ru/academy")
        sitemap = self.client.get("/sitemap.xml")
        self.assertIn("<loc>https://itflux-academy.ru/academy</loc>", sitemap.content.decode())

    def test_academy_legal_drafts_are_noindex_and_not_in_sitemap(self):
        sitemap = self.client.get("/sitemap.xml").content.decode()
        self.assertIn("<loc>https://itflux-academy.ru/academy</loc>", sitemap)
        for path in ("/academy/offer", "/academy/consent"):
            page = self.client.get(path)
            self.assertEqual(page.status_code, 200, path)
            html = page.content.decode()
            self.assertIn('name="robots" content="noindex', html)
            self.assertIn(f'rel="canonical" href="https://itflux-academy.ru{path}"', html)
            self.assertNotIn(f"<loc>https://itflux-academy.ru{path}</loc>", sitemap)
            self.assertEqual(self.client.get(path + "/").status_code, 200, path + "/")
            meta = self.client.get(f"/api/seo/meta/?path={path}")
            self.assertTrue(meta.json()["noindex"])
            self.assertEqual(meta.json()["canonical"], f"https://itflux-academy.ru{path}")

    def test_consent_version_text_is_stored_in_code(self):
        from Cabinet.academy_consent import (
            ACADEMY_CONSENT_CHECKBOX_TEXTS,
            academy_consent_checkbox_text,
            academy_consent_page_text,
        )
        self.assertEqual(ACADEMY_CONSENT_VERSION, "academy_lead_consent_v2")
        self.assertIn("законный представитель", academy_consent_checkbox_text())
        self.assertIn("бесплатную диагностику", academy_consent_page_text())
        self.assertIn("Нажимая кнопку", ACADEMY_CONSENT_CHECKBOX_TEXTS["academy_lead_consent_v1"])
