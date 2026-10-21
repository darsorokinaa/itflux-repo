"""r93: одноразовые токены переноса сессии на cdn и флаг предпочтения cdn."""
from django.conf import settings
from django.db import models


class CdnHandoffToken(models.Model):
    token_hash = models.CharField(max_length=64, unique=True)  # sha256, сам токен не хранится
    user = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.CASCADE, related_name="+")
    ua_hash = models.CharField(max_length=32, blank=True, default="")
    next_path = models.CharField(max_length=1000, default="/cabinet/")
    reason = models.CharField(max_length=20, default="call_drops")
    created_at = models.DateTimeField(auto_now_add=True)
    expires_at = models.DateTimeField(db_index=True)
    used_at = models.DateTimeField(null=True, blank=True)


class CdnPreference(models.Model):
    user = models.OneToOneField(settings.AUTH_USER_MODEL, on_delete=models.CASCADE, related_name="+")
    reason = models.CharField(max_length=20, default="call_drops")
    until = models.DateTimeField()
    updated_at = models.DateTimeField(auto_now=True)
