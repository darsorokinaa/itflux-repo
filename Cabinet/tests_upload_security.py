from types import SimpleNamespace

from django.core.files.uploadedfile import SimpleUploadedFile
from django.test import TestCase

from Cabinet.upload_validation import UploadValidationError, validate_uploaded_file


class UploadSecurityTests(TestCase):
    def test_blocks_html_svg_js_sh(self):
        for name in ("x.html", "evil.svg", "a.js", "run.sh"):
            with self.subTest(name=name):
                f = SimpleUploadedFile(name, b"<svg onload=alert(1)>", content_type="text/plain")
                with self.assertRaises(UploadValidationError):
                    validate_uploaded_file(f)

    def test_allows_pdf(self):
        f = SimpleUploadedFile("hw.pdf", b"%PDF-1.4", content_type="application/pdf")
        validate_uploaded_file(f)

    def test_allows_video_spreadsheet_and_document_types(self):
        cases = (
            ("clip.mkv", "video/x-matroska"),
            ("clip.avi", "video/x-msvideo"),
            ("clip.wmv", "video/x-ms-wmv"),
            ("clip.m4v", "video/x-m4v"),
            ("table.ods", "application/vnd.oasis.opendocument.spreadsheet"),
            ("table.xlsm", "application/vnd.ms-excel.sheet.macroEnabled.12"),
            ("table.tsv", "text/tab-separated-values"),
            ("essay.odt", "application/vnd.oasis.opendocument.text"),
            ("slides.odp", "application/vnd.oasis.opendocument.presentation"),
            ("book.djvu", "image/vnd.djvu"),
        )
        for name, mime in cases:
            with self.subTest(name=name):
                validate_uploaded_file(SimpleUploadedFile(name, b"data", content_type=mime))

    def test_allows_video_with_unlisted_video_mime(self):
        validate_uploaded_file(SimpleUploadedFile("lesson.mkv", b"data", content_type="video/unknown"))

    def test_allows_file_up_to_100mb(self):
        uploaded = SimpleNamespace(name="lesson.mp4", size=100 * 1024 * 1024, content_type="video/mp4")
        validate_uploaded_file(uploaded)

    def test_rejects_file_over_100mb(self):
        uploaded = SimpleNamespace(name="lesson.mp4", size=100 * 1024 * 1024 + 1, content_type="video/mp4")
        with self.assertRaises(UploadValidationError) as ctx:
            validate_uploaded_file(uploaded)
        self.assertEqual(ctx.exception.code, "FILE_TOO_LARGE")
        self.assertIn("100", ctx.exception.message)
