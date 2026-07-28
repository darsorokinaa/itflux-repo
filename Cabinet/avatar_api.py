"""API загрузки и отдачи аватаров профиля (учитель / ученик)."""

from __future__ import annotations

from django.contrib.auth.models import User
from django.core import signing
from django.http import HttpResponse, JsonResponse
from django.urls import reverse
from django.utils.http import http_date
from django.views.decorators.http import require_http_methods
from rest_framework import status
from rest_framework.parsers import FormParser, MultiPartParser
from rest_framework.response import Response
from rest_framework.views import APIView

from .avatar_crypto import MAX_AVATAR_BYTES
from .models import Profile

AVATAR_SIGN_SALT = "cabinet.avatar"
AVATAR_TOKEN_MAX_AGE = 60 * 60 * 24 * 14  # 14 дней


def avatar_api_path() -> str:
    return reverse("cabinet_profile_avatar")


def build_avatar_url(user: User, request=None, *, absolute: bool = False) -> str:
    profile = getattr(user, "profile", None)
    if profile is None or not profile.has_avatar():
        return ""
    path = reverse("cabinet_profile_avatar_user", kwargs={"user_id": user.pk})
    signer = signing.TimestampSigner(salt=AVATAR_SIGN_SALT)
    token = signer.sign(str(user.pk))
    version = ""
    if profile.avatar_updated_at:
        version = f"&v={int(profile.avatar_updated_at.timestamp())}"
    elif profile.updated_at:
        version = f"&v={int(profile.updated_at.timestamp())}"
    url = f"{path}?t={token}{version}"
    if absolute and request is not None:
        return request.build_absolute_uri(url)
    return url


def _verify_avatar_token(user_id: int, token: str) -> bool:
    if not token:
        return False
    signer = signing.TimestampSigner(salt=AVATAR_SIGN_SALT)
    try:
        value = signer.unsign(token, max_age=AVATAR_TOKEN_MAX_AGE)
    except signing.BadSignature:
        return False
    return str(user_id) == str(value)


def _avatar_http_response(profile: Profile) -> HttpResponse:
    payload = profile.get_decrypted_avatar()
    if not payload:
        return HttpResponse(status=404)
    raw, content_type = payload
    response = HttpResponse(raw, content_type=content_type)
    response["Cache-Control"] = "private, max-age=3600"
    if profile.avatar_updated_at:
        response["Last-Modified"] = http_date(profile.avatar_updated_at.timestamp())
    return response


class ProfileAvatarView(APIView):
    """GET/POST/DELETE собственного аватара."""

    parser_classes = [MultiPartParser, FormParser]

    def get(self, request):
        if not request.user.is_authenticated:
            return Response({"detail": "Требуется вход"}, status=status.HTTP_401_UNAUTHORIZED)
        profile = request.user.profile
        if not profile.has_avatar():
            return Response(status=status.HTTP_404_NOT_FOUND)
        return _avatar_http_response(profile)

    def post(self, request):
        if not request.user.is_authenticated:
            return Response({"detail": "Требуется вход"}, status=status.HTTP_401_UNAUTHORIZED)
        uploaded = request.FILES.get("avatar") or request.FILES.get("file")
        if not uploaded:
            return Response({"error": "Выберите файл изображения"}, status=status.HTTP_400_BAD_REQUEST)
        if uploaded.size and uploaded.size > MAX_AVATAR_BYTES:
            return Response({"error": "Файл слишком большой (максимум 2 МБ)"}, status=status.HTTP_400_BAD_REQUEST)
        raw = uploaded.read()
        profile = request.user.profile
        try:
            profile.set_encrypted_avatar(raw, uploaded.content_type or "")
        except ValueError as exc:
            return Response({"error": str(exc)}, status=status.HTTP_400_BAD_REQUEST)
        profile.save(
            update_fields=[
                "avatar",
                "avatar_encrypted",
                "avatar_content_type",
                "avatar_updated_at",
                "updated_at",
            ]
        )
        return Response({
            "ok": True,
            "avatar": build_avatar_url(request.user, request),
        })

    def delete(self, request):
        if not request.user.is_authenticated:
            return Response({"detail": "Требуется вход"}, status=status.HTTP_401_UNAUTHORIZED)
        profile = request.user.profile
        profile.clear_avatar()
        profile.save(
            update_fields=[
                "avatar",
                "avatar_encrypted",
                "avatar_content_type",
                "avatar_updated_at",
                "updated_at",
            ]
        )
        return Response({"ok": True, "avatar": None})


@require_http_methods(["GET"])
def api_profile_avatar_user(request, user_id: int):
    """Отдача аватара пользователя по подписанному токену или владельцу сессии."""
    profile = Profile.objects.filter(user_id=user_id).first()
    if profile is None or not profile.has_avatar():
        return HttpResponse(status=404)

    token = (request.GET.get("t") or "").strip()
    is_owner = (
        getattr(request, "user", None) is not None
        and request.user.is_authenticated
        and request.user.pk == user_id
    )
    if not is_owner and not _verify_avatar_token(user_id, token):
        return JsonResponse({"detail": "Нет доступа"}, status=403)

    return _avatar_http_response(profile)
