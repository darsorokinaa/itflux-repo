"""Daphne для live-тестов: тестовая БД выбирается до загрузки приложения."""

import os

from daphne.testing import DaphneProcess


class TestDatabaseDaphneProcess(DaphneProcess):
    def run(self):
        name = os.environ.get("MESSAGING_E2E_TEST_DB")
        if name:
            from django.conf import settings

            settings.DATABASES["default"]["NAME"] = name
        self.setup = None
        super().run()
