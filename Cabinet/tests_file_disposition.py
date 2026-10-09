from django.test import RequestFactory, SimpleTestCase

from Cabinet.files_storage import wants_inline_preview


class PreviewDispositionTests(SimpleTestCase):
    def test_images_and_pdf_open_inline(self):
        request = RequestFactory().get("/file")
        self.assertTrue(wants_inline_preview(request, "application/pdf", "a.pdf"))
        self.assertTrue(wants_inline_preview(request, "", "photo.JPG"))
        self.assertTrue(wants_inline_preview(request, "application/octet-stream", "page.png"))

    def test_office_files_download_unless_asked_to_open(self):
        request = RequestFactory().get("/file")
        self.assertFalse(wants_inline_preview(request, "", "work.docx"))
        inline = RequestFactory().get("/file?inline=1")
        self.assertTrue(wants_inline_preview(inline, "", "work.docx"))

    def test_download_param_and_active_content_stay_attachments(self):
        request = RequestFactory().get("/file?download=1")
        self.assertFalse(wants_inline_preview(request, "image/jpeg", "a.jpg"))
        html = RequestFactory().get("/file?inline=1")
        self.assertFalse(wants_inline_preview(html, "text/html", "page.html"))
        self.assertFalse(wants_inline_preview(html, "image/svg+xml", "icon.svg"))
