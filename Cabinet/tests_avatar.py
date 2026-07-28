import io

from django.contrib.auth.models import User
from django.core.files.uploadedfile import SimpleUploadedFile
from django.test import Client, TestCase
from PIL import Image

from Cabinet.avatar_api import build_avatar_url
from Cabinet.avatar_crypto import decrypt_avatar_bytes
from Cabinet.models import Profile


def _png_bytes(color=(40, 120, 200), size=(64, 64)) -> bytes:
    buf = io.BytesIO()
    Image.new("RGB", size, color).save(buf, format="PNG")
    return buf.getvalue()


class ProfileAvatarApiTests(TestCase):
    def setUp(self):
        self.user = User.objects.create_user(
            username="avatar_teacher",
            password="pass12345",
            email="avatar@test.ru",
        )
        Profile.objects.filter(user=self.user).update(role=Profile.Role.TEACHER)
        self.client = Client()
        self.client.login(username="avatar_teacher", password="pass12345")

    def test_upload_stores_encrypted_blob_in_db(self):
        upload = SimpleUploadedFile("face.png", _png_bytes(), content_type="image/png")
        response = self.client.post("/api/cabinet/profile/avatar/", {"avatar": upload})
        self.assertEqual(response.status_code, 200, response.content)
        data = response.json()
        self.assertTrue(data.get("ok"))
        self.assertTrue(data.get("avatar"))

        profile = Profile.objects.get(user=self.user)
        self.assertTrue(profile.avatar_encrypted)
        raw = decrypt_avatar_bytes(bytes(profile.avatar_encrypted))
        self.assertGreater(len(raw), 20)
        self.assertEqual(profile.avatar_content_type, "image/jpeg")
        self.assertFalse(bool(profile.avatar))

    def test_get_own_avatar_and_signed_url(self):
        profile = self.user.profile
        profile.set_encrypted_avatar(_png_bytes(), "image/png")
        profile.save()

        own = self.client.get("/api/cabinet/profile/avatar/")
        self.assertEqual(own.status_code, 200)
        self.assertEqual(own["Content-Type"], "image/jpeg")

        url = build_avatar_url(self.user)
        self.assertIn("/api/cabinet/profile/avatar/", url)
        signed = self.client.get(url)
        self.assertEqual(signed.status_code, 200)

        anon = Client()
        denied = anon.get(f"/api/cabinet/profile/avatar/{self.user.pk}/")
        self.assertEqual(denied.status_code, 403)
        allowed = anon.get(url)
        self.assertEqual(allowed.status_code, 200)

    def test_delete_avatar(self):
        profile = self.user.profile
        profile.set_encrypted_avatar(_png_bytes(), "image/png")
        profile.save()

        response = self.client.delete("/api/cabinet/profile/avatar/")
        self.assertEqual(response.status_code, 200)
        profile.refresh_from_db()
        self.assertFalse(profile.has_avatar())

    def test_me_includes_avatar_url(self):
        profile = self.user.profile
        profile.set_encrypted_avatar(_png_bytes(), "image/png")
        profile.save()
        response = self.client.get("/api/cabinet/me/")
        self.assertEqual(response.status_code, 200)
        payload = response.json()
        self.assertTrue(payload["authenticated"])
        self.assertTrue(payload["user"]["avatar"])
