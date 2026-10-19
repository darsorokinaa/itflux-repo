"""r83: формат картинок доски (HEIC/GIF/без расширения), defer scene_data, сжатие штрихов."""

import io
from unittest import mock, skipUnless

from django.contrib.auth.models import User
from django.core.files.uploadedfile import SimpleUploadedFile
from django.db import connection
from django.test import TestCase
from django.test.utils import CaptureQueriesContext
from PIL import Image
from rest_framework.test import APIClient

from Cabinet.boards_api import (
    _quantize_stroke_element,
    compact_scene_data,
    sniff_board_image_mime,
)
from Cabinet.models import InteractiveBoard, InteractiveBoardAsset, Profile

try:  # pragma: no cover
    import pillow_heif  # noqa: F401

    HAS_HEIF = True
except Exception:  # pragma: no cover
    HAS_HEIF = False


def _png_bytes(size=(4, 3), mode="RGBA"):
    buf = io.BytesIO()
    Image.new(mode, size, (255, 0, 0, 255) if mode == "RGBA" else (255, 0, 0)).save(buf, format="PNG")
    return buf.getvalue()


def _gif_bytes():
    buf = io.BytesIO()
    frames = [Image.new("P", (5, 4), i) for i in range(2)]
    frames[0].save(buf, format="GIF", save_all=True, append_images=frames[1:])
    return buf.getvalue()


def _jpeg_bytes():
    buf = io.BytesIO()
    Image.new("RGB", (6, 6), (0, 128, 0)).save(buf, format="JPEG")
    return buf.getvalue()


class BoardImageUploadR83Tests(TestCase):
    def setUp(self):
        self.client = APIClient()
        self.teacher = User.objects.create_user(username="r83_teacher", password="pass")
        self.teacher.profile.role = Profile.Role.TEACHER
        self.teacher.profile.save()
        self.client.force_authenticate(self.teacher)
        self.board = InteractiveBoard.objects.create(owner=self.teacher, title="r83")
        self.url = f"/api/cabinet/interactive-boards/{self.board.id}/upload-image/"

    def _post(self, name, content, content_type):
        return self.client.post(
            self.url,
            {"file": SimpleUploadedFile(name, content, content_type=content_type)},
            format="multipart",
        )

    def test_png_ok(self):
        res = self._post("a.png", _png_bytes(), "image/png")
        self.assertEqual(res.status_code, 201, res.content)
        self.assertEqual(res.json()["mimeType"], "image/png")

    def test_clipboard_blob_without_extension_is_sniffed(self):
        for name, ctype in (("image", "image/png"), ("blob", "application/octet-stream"), ("blob", "")):
            res = self._post(name, _png_bytes((7, 7)), ctype or "application/octet-stream")
            self.assertEqual(res.status_code, 201, (name, ctype, res.content))
            self.assertEqual(res.json()["mimeType"], "image/png")

    def test_jpeg_with_wrong_extension_and_type(self):
        res = self._post("photo.heic", _jpeg_bytes(), "image/heic")
        self.assertEqual(res.status_code, 201, res.content)
        self.assertEqual(res.json()["mimeType"], "image/jpeg")

    def test_gif_converted_to_png_first_frame(self):
        res = self._post("anim.gif", _gif_bytes(), "image/gif")
        self.assertEqual(res.status_code, 201, res.content)
        self.assertEqual(res.json()["mimeType"], "image/png")
        asset = InteractiveBoardAsset.objects.get(pk=res.json()["asset_id"])
        self.assertEqual(asset.mime_type, "image/png")
        asset.file.open("rb")
        try:
            self.assertTrue(asset.file.read(8).startswith(b"\x89PNG"))
        finally:
            asset.file.close()

    @skipUnless(HAS_HEIF, "pillow-heif не установлен")
    def test_heic_converted_to_jpeg(self):
        import pillow_heif

        pillow_heif.register_heif_opener()
        buf = io.BytesIO()
        Image.new("RGB", (8, 8), (10, 20, 30)).save(buf, format="HEIF")
        res = self._post("IMG_0001.HEIC", buf.getvalue(), "image/heic")
        self.assertEqual(res.status_code, 201, res.content)
        self.assertEqual(res.json()["mimeType"], "image/jpeg")

    def test_heic_without_decoder_gives_clear_message(self):
        fake_heic = b"\x00\x00\x00\x18ftypheic\x00\x00\x00\x00mif1heic" + b"\x00" * 32
        import builtins

        real_import = builtins.__import__

        def no_heif(name, *a, **kw):
            if name == "pillow_heif":
                raise ImportError("nope")
            return real_import(name, *a, **kw)

        with mock.patch("builtins.__import__", side_effect=no_heif):
            res = self._post("IMG.HEIC", fake_heic, "image/heic")
        self.assertEqual(res.status_code, 400)
        self.assertEqual(res.json()["code"], "HEIC_NOT_SUPPORTED")
        self.assertIn("HEIC", res.json()["detail"])

    def test_svg_still_rejected_with_detail(self):
        svg = b'<svg xmlns="http://www.w3.org/2000/svg"></svg>'
        res = self._post("x.svg", svg, "image/svg+xml")
        self.assertEqual(res.status_code, 400)
        self.assertEqual(res.json()["code"], "FILE_TYPE_NOT_ALLOWED")
        # svg под видом png без расширения — тоже отказ по содержимому
        res = self._post("image", svg, "image/png")
        self.assertEqual(res.status_code, 400)
        self.assertTrue(res.json()["detail"])

    def test_rejection_is_logged_with_name_and_type(self):
        with self.assertLogs("Cabinet.boards_api", level="WARNING") as logs:
            res = self._post("notes.txt", b"hello world, not an image", "text/plain")
        self.assertEqual(res.status_code, 400)
        line = "\n".join(logs.output)
        self.assertIn("board_image_rejected", line)
        self.assertIn("notes.txt", line)
        self.assertIn("text/plain", line)

    def test_upload_does_not_load_scene_data(self):
        self.board.scene_data = {"elements": [{"id": "x", "type": "freedraw", "points": [[0, 0]] * 50}], "appState": {}, "files": {}}
        self.board.save()
        with CaptureQueriesContext(connection) as ctx:
            res = self._post("a.png", _png_bytes((3, 3)), "image/png")
        self.assertEqual(res.status_code, 201, res.content)
        board_selects = [
            q["sql"] for q in ctx.captured_queries
            if "interactiveboard" in q["sql"].lower() and q["sql"].lstrip().upper().startswith("SELECT")
            and "interactiveboardasset" not in q["sql"].lower().split(" from ")[1][:40]
        ]
        self.assertTrue(board_selects)
        for sql in board_selects:
            self.assertNotIn('"scene_data"', sql.split(" FROM ")[0])

    def test_sniff(self):
        self.assertEqual(sniff_board_image_mime(_png_bytes()), "image/png")
        self.assertEqual(sniff_board_image_mime(_gif_bytes()), "image/gif")
        self.assertEqual(sniff_board_image_mime(b"\x00\x00\x00\x18ftypheic" + b"\x00" * 8), "image/heic")
        self.assertIsNone(sniff_board_image_mime(b"<svg></svg>........"))


class StrokeQuantizeTests(TestCase):
    def _stroke(self, **kw):
        el = {
            "id": "s1",
            "type": "freedraw",
            "version": 14,
            "versionNonce": 1,
            "isDeleted": False,
            "points": [[0, 0], [-9.59991455078125, 3.2000350952148438], [1.0, 2.5]],
            "pressures": [0.0400390625, 0.4443359375, 0.5],
        }
        el.update(kw)
        return el

    def test_rounds_points_and_pressures_keeps_version(self):
        q = _quantize_stroke_element(self._stroke())
        self.assertEqual(q["points"], [[0, 0], [-9.6, 3.2], [1, 2.5]])
        self.assertEqual(q["pressures"], [0.04, 0.444, 0.5])
        self.assertEqual(q["version"], 14)
        self.assertEqual(q["versionNonce"], 1)

    def test_idempotent(self):
        q = _quantize_stroke_element(self._stroke())
        self.assertIsNone(_quantize_stroke_element(q))
        scene = {"elements": [q], "appState": {}, "files": {}}
        _, changed = compact_scene_data(scene)
        self.assertFalse(changed)

    def test_non_stroke_untouched(self):
        self.assertIsNone(_quantize_stroke_element({"type": "rectangle", "x": 1.123456}))
        self.assertIsNone(_quantize_stroke_element(self._stroke(isDeleted=True, points=[[0, 0]])))

    def test_compact_shrinks_scene(self):
        import json

        pts = [[i * 1.0000123456789, i * -2.333333333333] for i in range(200)]
        scene = {"elements": [self._stroke(points=pts, pressures=[0.123456789] * 200)], "appState": {}, "files": {}}
        out, changed = compact_scene_data(scene)
        self.assertTrue(changed)
        self.assertLess(len(json.dumps(out)), len(json.dumps(scene)) * 0.6)

    def test_patch_saves_quantized(self):
        user = User.objects.create_user(username="r83_q", password="pass")
        user.profile.role = Profile.Role.TEACHER
        user.profile.save()
        board = InteractiveBoard.objects.create(owner=user, title="q")
        client = APIClient()
        client.force_authenticate(user)
        res = client.patch(
            f"/api/cabinet/interactive-boards/{board.id}/",
            {"version": board.version, "scene_data": {"elements": [self._stroke()], "appState": {}, "files": {}}},
            format="json",
        )
        self.assertEqual(res.status_code, 200, res.content)
        board.refresh_from_db()
        self.assertEqual(board.scene_data["elements"][0]["points"][1], [-9.6, 3.2])
