import hashlib
import json
import logging
from datetime import timedelta

from django.conf import settings
from django.db import transaction
from django.utils import timezone

from . import texts, vkapi
from .models import VkFunnelContact, VkFunnelLog

logger = logging.getLogger("vkfunnel")


def enabled():
    return str(getattr(settings, "VK_FUNNEL_ENABLED", "0")).strip().lower() in ("1", "true", "yes", "on")


def rid(user_id, kind):
    """Детерминированный random_id: VK не доставит дубль одного и того же шага."""
    return int(hashlib.sha256(f"{user_id}:{kind}".encode()).hexdigest()[:8], 16) & 0x7FFFFFFF


def _btn(label, payload, color="primary"):
    return {"action": {"type": "text", "label": label, "payload": json.dumps(payload)}, "color": color}


def topics_keyboard():
    t = texts.TOPICS
    return {"one_time": False, "inline": False, "buttons": [
        [_btn(t["oge_math"], {"t": "oge_math"}), _btn(t["oge_inf"], {"t": "oge_inf"})],
        [_btn(t["ege_math"], {"t": "ege_math"}), _btn(t["ege_inf"], {"t": "ege_inf"})],
        [_btn(t["diag"], {"t": "diag"}, "secondary")],
    ]}


def subscribe_keyboard(topic):
    return {"inline": True, "buttons": [
        [{"action": {"type": "open_link", "link": texts.GROUP_URL, "label": "Открыть сообщество"}}],
        [_btn("Я подписался", {"sub": topic}, "positive")],
    ]}


def log(contact, kind, ok=True, detail="", user_id=None):
    VkFunnelLog.objects.create(contact=contact, vk_user_id=user_id or (contact.vk_user_id if contact else None),
                               kind=kind, ok=ok, detail=str(detail)[:500])
    logger.info("vkfunnel %s user=%s ok=%s %s", kind, user_id or (contact and contact.vk_user_id), ok, str(detail)[:200])


def _send(contact, kind, text, keyboard=None, step_key=None):
    try:
        vkapi.send(contact.vk_user_id, text, rid(contact.vk_user_id, step_key or f"{kind}:{timezone.now().timestamp():.0f}"), keyboard)
    except Exception as exc:  # noqa: BLE001
        log(contact, kind, False, exc)
        if isinstance(exc, vkapi.VkApiError) and exc.code in (901, 7):  # нельзя писать пользователю
            VkFunnelContact.objects.filter(pk=contact.pk).update(messages_denied=True)
        return False
    VkFunnelContact.objects.filter(pk=contact.pk).update(last_outbound_at=timezone.now())
    log(contact, kind, True)
    return True


def parse_topic(text, payload):
    if isinstance(payload, dict):
        if payload.get("t") in texts.TOPICS:
            return payload["t"], False
        if payload.get("sub") in texts.TOPICS:
            return payload["sub"], True
    low = (text or "").lower().replace("ё", "е")
    for key, label in texts.TOPICS.items():
        if low.strip() == label.lower().replace("ё", "е"):
            return key, False
    if "подписал" in low:
        return None, True
    return None, False


def handle_message(obj):
    msg = obj.get("message") or obj
    user_id = int(msg.get("from_id") or 0)
    if user_id <= 0 or msg.get("out"):
        return  # сообщества/исходящие игнорируем
    payload = msg.get("payload")
    if isinstance(payload, str):
        try:
            payload = json.loads(payload)
        except ValueError:
            payload = None
    now = timezone.now()
    with transaction.atomic():
        contact, created = VkFunnelContact.objects.select_for_update().get_or_create(
            vk_user_id=user_id, defaults={"first_message_at": now, "last_inbound_at": now})
        contact.last_inbound_at = now
        contact.messages_denied = False  # написал сам — значит, писать можно
        contact.save(update_fields=["last_inbound_at", "messages_denied"])
    topic, sub_click = parse_topic(msg.get("text"), payload)
    if sub_click and not topic:
        topic = contact.topic or None
    if not topic:
        # Антиспам: меню не чаще раза в 10 минут на свободный текст.
        if not created and contact.last_outbound_at and now - contact.last_outbound_at < timedelta(minutes=10):
            log(contact, "menu_skip_ratelimit")
            return
        _send(contact, "menu", texts.welcome(), topics_keyboard())
        return
    VkFunnelContact.objects.filter(pk=contact.pk).update(topic=topic)
    contact.topic = topic
    try:
        member = vkapi.is_member(user_id)
    except Exception as exc:  # noqa: BLE001
        log(contact, "is_member_error", False, exc)
        return
    if not member:
        VkFunnelContact.objects.filter(pk=contact.pk).update(left_group=False)
        _send(contact, "ask_subscribe",
              texts.still_not_subscribed() if sub_click else texts.please_subscribe(texts.TOPICS[topic]),
              subscribe_keyboard(topic))
        return
    if topic in (contact.gift_topics or []):
        log(contact, "gift_duplicate_resend")
    if _send(contact, "gift", texts.gift(topic), step_key=f"gift:{topic}:{now.date()}"):
        with transaction.atomic():
            c = VkFunnelContact.objects.select_for_update().get(pk=contact.pk)
            c.gift_topics = sorted(set((c.gift_topics or []) + [topic]))
            c.left_group = False
            if not c.gift_sent_at:
                c.gift_sent_at = now
            c.save(update_fields=["gift_topics", "gift_sent_at", "left_group"])


def handle_event(event):
    etype = event.get("type")
    obj = event.get("object") or {}
    if etype == "message_new":
        handle_message(obj)
    elif etype == "message_deny":
        VkFunnelContact.objects.filter(vk_user_id=obj.get("user_id")).update(messages_denied=True)
        log(None, "message_deny", user_id=obj.get("user_id"))
    elif etype == "message_allow":
        VkFunnelContact.objects.filter(vk_user_id=obj.get("user_id")).update(messages_denied=False)
    elif etype == "group_leave":
        VkFunnelContact.objects.filter(vk_user_id=obj.get("user_id")).update(left_group=True)
        log(None, "group_leave", user_id=obj.get("user_id"))
    elif etype == "group_join":
        VkFunnelContact.objects.filter(vk_user_id=obj.get("user_id")).update(left_group=False)


FOLLOWUPS = (
    # kind, поле, после скольких часов от подарка, не позже (ч), текст
    ("followup1", "followup1_sent_at", 24, 72, texts.followup1),
    ("followup2", "followup2_sent_at", 72, 120, texts.followup2),
)


def run_followups(now=None, limit=200, dry_run=False):
    now = now or timezone.now()
    stats = {"sent": 0, "skipped": 0, "errors": 0}
    for kind, field, after_h, before_h, text_fn in FOLLOWUPS:
        qs = VkFunnelContact.objects.filter(
            gift_sent_at__lte=now - timedelta(hours=after_h),
            gift_sent_at__gte=now - timedelta(hours=before_h),
            messages_denied=False, left_group=False, **{f"{field}__isnull": True})
        if kind == "followup2":
            qs = qs.filter(followup1_sent_at__lte=now - timedelta(hours=36))
        for c in qs.order_by("gift_sent_at")[:limit]:
            with transaction.atomic():
                locked = VkFunnelContact.objects.select_for_update(skip_locked=True).filter(
                    pk=c.pk, **{f"{field}__isnull": True}).first()
                if not locked:
                    continue
                try:
                    allowed = vkapi.messages_allowed(c.vk_user_id)
                    member = vkapi.is_member(c.vk_user_id)
                except Exception as exc:  # noqa: BLE001
                    log(c, f"{kind}_check_error", False, exc)
                    stats["errors"] += 1
                    continue
                if not allowed or not member:
                    VkFunnelContact.objects.filter(pk=c.pk).update(
                        messages_denied=not allowed, left_group=not member, **{field: now})
                    log(c, f"{kind}_skip", True, f"allowed={allowed} member={member}")
                    stats["skipped"] += 1
                    continue
                if dry_run:
                    log(c, f"{kind}_dry_run")
                    stats["skipped"] += 1
                    continue
                # Сначала ставим отметку (at-most-once), потом отправляем.
                VkFunnelContact.objects.filter(pk=c.pk).update(**{field: now})
            if _send(c, kind, text_fn(), step_key=kind):
                stats["sent"] += 1
            else:
                stats["errors"] += 1
    return stats
