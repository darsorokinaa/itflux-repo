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
