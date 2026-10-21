import json
from datetime import timedelta
from unittest import mock

from django.test import TestCase, override_settings
from django.utils import timezone

from . import funnel
from .models import VkFunnelContact, VkFunnelLog

GID = 233679646
URL = "/api/vk/callback/"


def ev(type_, obj=None, eid="e1", secret="s3cret"):
    return json.dumps({"type": type_, "group_id": GID, "event_id": eid, "secret": secret, "object": obj or {}})


def msg(uid=42, text="привет", payload=None, eid="e1"):
    m = {"from_id": uid, "text": text}
    if payload:
        m["payload"] = json.dumps(payload)
    return ev("message_new", {"message": m}, eid=eid)


@override_settings(VK_CALLBACK_CONFIRMATION="abc123", VK_CALLBACK_SECRET="s3cret", VK_FUNNEL_GROUP_ID=GID, VK_FUNNEL_ENABLED="1")
@mock.patch("vkfunnel.vkapi.call")
class CallbackTests(TestCase):
    def post(self, body):
        return self.client.post(URL, body, content_type="application/json")

    def test_confirmation(self, call):
        r = self.client.post(URL, json.dumps({"type": "confirmation", "group_id": GID}), content_type="application/json")
        self.assertEqual(r.content, b"abc123")
        call.assert_not_called()

    def test_wrong_group_and_secret(self, call):
        self.assertEqual(self.client.post(URL, json.dumps({"type": "confirmation", "group_id": 1}), content_type="application/json").status_code, 403)
        self.assertEqual(self.post(ev("message_new", secret="bad")).status_code, 403)
        call.assert_not_called()

    @override_settings(VK_FUNNEL_ENABLED="0")
    def test_disabled_sends_nothing(self, call):
        r = self.post(msg())
        self.assertEqual(r.content, b"ok")
        call.assert_not_called()
        self.assertFalse(VkFunnelContact.objects.exists())

    def test_menu(self, call):
        self.post(msg(text="ЕГЭ"))
        m, kw = call.call_args
        self.assertEqual(m[0], "messages.send")
        self.assertIn("ОГЭ математика", kw["keyboard"])
        self.assertIn("Диагностики 5–11", kw["keyboard"])

    def test_idempotent_event(self, call):
        self.post(msg(eid="x"))
        self.post(msg(eid="x"))
        self.assertEqual(call.call_count, 1)

    def test_not_member_then_subscribed(self, call):
        call.side_effect = lambda m, **k: 0 if m == "groups.isMember" else 1
        self.post(msg(text="ОГЭ информатика", payload={"t": "oge_inf"}, eid="1"))
        sends = [c for c in call.call_args_list if c.args[0] == "messages.send"]
        self.assertIn("Я подписался", sends[-1].kwargs["keyboard"])
        self.assertIsNone(VkFunnelContact.objects.get().gift_sent_at)
        call.side_effect = lambda m, **k: 1
        self.post(msg(text="Я подписался", payload={"sub": "oge_inf"}, eid="2"))
        sends = [c for c in call.call_args_list if c.args[0] == "messages.send"]
        self.assertIn("zadaniya/oge/inf", sends[-1].kwargs["message"])
        c = VkFunnelContact.objects.get()
        self.assertIsNotNone(c.gift_sent_at)
        self.assertEqual(c.gift_topics, ["oge_inf"])

    def test_diag_gift(self, call):
        call.side_effect = lambda m, **k: 1
        self.post(msg(text="Диагностики 5–11", eid="d"))
        text = call.call_args.kwargs["message"]
        for g in range(5, 12):
            self.assertIn(f"matematike-{g}-klass", text)
        self.assertNotIn("#", text)
        self.assertIn("Дарья, «Цифровой поток»", text)

    def test_deny_and_leave(self, call):
        call.side_effect = lambda m, **k: 1
        self.post(msg(eid="a"))
        self.post(ev("message_deny", {"user_id": 42}, eid="b"))
        self.post(ev("group_leave", {"user_id": 42}, eid="c"))
        c = VkFunnelContact.objects.get()
        self.assertTrue(c.messages_denied and c.left_group)


@override_settings(VK_FUNNEL_ENABLED="1")
@mock.patch("vkfunnel.vkapi.call")
class FollowupTests(TestCase):
    def mk(self, uid=7, gift_hours=25, **kw):
        now = timezone.now()
        return VkFunnelContact.objects.create(vk_user_id=uid, topic="ege_math", first_message_at=now, last_inbound_at=now,
                                              gift_sent_at=now - timedelta(hours=gift_hours), **kw)

    def sends(self, call):
        return [c for c in call.call_args_list if c.args[0] == "messages.send"]

    def test_followup1_once(self, call):
        call.side_effect = lambda m, **k: {"is_allowed": 1} if m.endswith("Allowed") else 1
        self.mk()
        funnel.run_followups()
        funnel.run_followups()
        s = self.sends(call)
        self.assertEqual(len(s), 1)
        self.assertIn("получилось ли", s[0].kwargs["message"].lower())
        self.assertIn("«Старт»", s[0].kwargs["message"])

    def test_followup2(self, call):
        call.side_effect = lambda m, **k: {"is_allowed": 1} if m.endswith("Allowed") else 1
        self.mk(gift_hours=80, followup1_sent_at=timezone.now() - timedelta(hours=50))
        funnel.run_followups()
        t = self.sends(call)[0].kwargs["message"]
        self.assertIn("14 дней", t)
        self.assertIn("vk.ru/@itfluxacademy-tarify-cifrovogo-potoka-kakoi-vybrat", t)

    def test_not_too_early(self, call):
        self.mk(gift_hours=5)
        funnel.run_followups()
        call.assert_not_called()

    def test_blocked_or_unsubscribed_skipped(self, call):
        call.side_effect = lambda m, **k: {"is_allowed": 0} if m.endswith("Allowed") else 1
        self.mk(uid=1)
        funnel.run_followups()
        self.assertEqual(self.sends(call), [])
        call.side_effect = lambda m, **k: {"is_allowed": 1} if m.endswith("Allowed") else 0
        self.mk(uid=2)
        funnel.run_followups()
        self.assertEqual(self.sends(call), [])
        self.assertTrue(VkFunnelContact.objects.get(vk_user_id=2).left_group)
        self.assertTrue(VkFunnelLog.objects.filter(kind="followup1_skip").exists())

    def test_flagged_contacts_never_checked(self, call):
        self.mk(messages_denied=True)
        funnel.run_followups()
        call.assert_not_called()

    @override_settings(VK_FUNNEL_ENABLED="0")
    def test_command_noop_when_disabled(self, call):
        from django.core.management import call_command
        self.mk()
        call_command("vk_funnel_followups")
        call.assert_not_called()
