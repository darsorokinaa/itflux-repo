from pathlib import Path
from tempfile import TemporaryDirectory

from django.test import RequestFactory, SimpleTestCase, override_settings

from Generator.views import frontend_public_tree


class FrontendAssetsUrlTests(SimpleTestCase):
    def test_rejects_unknown_prefix_and_traversal(self):
        factory = RequestFactory()
        self.assertEqual(frontend_public_tree(factory.get("/x"), "secret", "a.js").status_code, 404)
        self.assertEqual(
            frontend_public_tree(factory.get("/x"), "assets", "../settings.py").status_code,
            404,
        )

    def test_serves_hashed_bundle_from_frontend_dir(self):
        factory = RequestFactory()
        with TemporaryDirectory() as tmp:
            root = Path(tmp)
            assets = root / "assets"
            assets.mkdir()
            (assets / "main-testhash.js").write_bytes(b"console.log(1)")
            with override_settings(FRONTEND_DIR=root):
                response = frontend_public_tree(
                    factory.get("/assets/main-testhash.js"),
                    "assets",
                    "main-testhash.js",
                )
            self.assertEqual(response.status_code, 200)
            self.assertIn("javascript", response["Content-Type"])
            self.assertIn("immutable", response["Cache-Control"])
            self.assertEqual(b"".join(response.streaming_content), b"console.log(1)")
