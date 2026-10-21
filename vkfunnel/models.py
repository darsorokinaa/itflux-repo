from django.db import models


class VkFunnelContact(models.Model):
    """Пользователь VK, который САМ написал сообществу (иначе записи нет)."""
    vk_user_id = models.BigIntegerField(unique=True)
    topic = models.CharField(max_length=32, blank=True, default="")
    first_message_at = models.DateTimeField()
    last_inbound_at = models.DateTimeField()
    gift_sent_at = models.DateTimeField(null=True, blank=True)
    gift_topics = models.JSONField(default=list, blank=True)
    followup1_sent_at = models.DateTimeField(null=True, blank=True)
    followup2_sent_at = models.DateTimeField(null=True, blank=True)
    messages_denied = models.BooleanField(default=False)
    left_group = models.BooleanField(default=False)
    last_outbound_at = models.DateTimeField(null=True, blank=True)

    class Meta:
        indexes = [models.Index(fields=["gift_sent_at"])]

    def __str__(self):
        return f"vk{self.vk_user_id} {self.topic}"


class VkCallbackEvent(models.Model):
    """Идемпотентность входящих событий Callback API (event_id)."""
    event_id = models.CharField(max_length=128, unique=True)
    event_type = models.CharField(max_length=64)
    received_at = models.DateTimeField(auto_now_add=True)


class VkFunnelLog(models.Model):
    contact = models.ForeignKey(VkFunnelContact, null=True, blank=True, on_delete=models.SET_NULL)
    vk_user_id = models.BigIntegerField(null=True, blank=True)
    kind = models.CharField(max_length=48)
    ok = models.BooleanField(default=True)
    detail = models.TextField(blank=True, default="")
    created_at = models.DateTimeField(auto_now_add=True, db_index=True)
