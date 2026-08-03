import json

from django.test import RequestFactory, SimpleTestCase

from Generator.middleware import (
    MinimumClientVersionMiddleware,
    NoStoreApiMiddleware,
    client_version_is_outdated,
)


class ClientVersionHelpersTests(SimpleTestCase):
    def test_outdated_compare(self):
        self.assertTrue(client_version_is_outdated("20260101000000-aaa", "20260803120000-bbb"))
        self.assertFalse(client_version_is_outdated("20260803120000-bbb", "20260803120000-bbb"))
        self.assertFalse(client_version_is_outdated("", "20260803120000-bbb"))


class NoStoreApiMiddlewareTests(SimpleTestCase):
    def test_sets_no_store_on_api(self):
        factory = RequestFactory()

        def view(_request):
            from django.http import JsonResponse

            return JsonResponse({"ok": True})

        mw = NoStoreApiMiddleware(view)
        response = mw(factory.get("/api/cabinet/me/"))
        self.assertIn("no-store", response["Cache-Control"])

    def test_leaves_non_api_alone(self):
        factory = RequestFactory()

        def view(_request):
            from django.http import HttpResponse

            return HttpResponse("ok")

        mw = NoStoreApiMiddleware(view)
        response = mw(factory.get("/cabinet/"))
        self.assertNotIn("Cache-Control", response)


class MinimumClientVersionMiddlewareTests(SimpleTestCase):
    def test_blocks_outdated_client_when_configured(self):
        factory = RequestFactory()

        def view(_request):
            from django.http import JsonResponse

            return JsonResponse({"ok": True})

        mw = MinimumClientVersionMiddleware(view)
        mw.minimum = "20260803120000-bbb"
        request = factory.get("/api/cabinet/me/", HTTP_X_CLIENT_VERSION="20260101000000-aaa")
        response = mw(request)
        self.assertEqual(response.status_code, 409)
        self.assertEqual(json.loads(response.content)["code"], "client_update_required")
