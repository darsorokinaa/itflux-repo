"""Минимальный клиент VK API (токен сообщества). Токен никогда не логируется."""
import json
import logging
import threading
import time
import urllib.parse
import urllib.request

from django.conf import settings

logger = logging.getLogger("vkfunnel")
API = "https://api.vk.com/method/"
_lock = threading.Lock()
_last = [0.0]
MIN_INTERVAL = 0.06  # ≤ ~16 запросов/с, лимит VK для сообщества — 20/с


class VkApiError(Exception):
    def __init__(self, code, msg):
        super().__init__(f"VK {code}: {msg}")
        self.code = code


def token():
    return (getattr(settings, "VK_GROUP_TOKEN", "") or "").strip()


def group_id():
    return int(getattr(settings, "VK_FUNNEL_GROUP_ID", 233679646) or 233679646)


def call(method, **params):
    with _lock:
        wait = MIN_INTERVAL - (time.monotonic() - _last[0])
        if wait > 0:
            time.sleep(wait)
        _last[0] = time.monotonic()
    params = {k: v for k, v in params.items() if v is not None}
    params.update(access_token=token(), v=getattr(settings, "VK_API_VERSION", "5.131") or "5.131")
    data = urllib.parse.urlencode(params).encode()
    with urllib.request.urlopen(urllib.request.Request(API + method, data=data), timeout=10) as r:
        body = json.loads(r.read().decode())
    if "error" in body:
        err = body["error"]
        raise VkApiError(err.get("error_code"), err.get("error_msg", ""))
    return body.get("response")


def is_member(user_id):
    return bool(int(call("groups.isMember", group_id=group_id(), user_id=user_id) or 0))


def messages_allowed(user_id):
    r = call("messages.isMessagesFromGroupAllowed", group_id=group_id(), user_id=user_id) or {}
    return bool(int(r.get("is_allowed", 0)))


def send(user_id, text, random_id, keyboard=None):
    return call("messages.send", user_id=user_id, random_id=random_id, message=text,
                keyboard=json.dumps(keyboard, ensure_ascii=False) if keyboard else None,
                dont_parse_links=1)
