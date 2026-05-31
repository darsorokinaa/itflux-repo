"""Импорт заданий из Excel: текст и URL файла (ZIP и др.)."""

import time
from urllib.parse import urlparse, unquote

import pandas as pd
import requests
import urllib3
from requests.exceptions import RequestException
from django.core.files.base import ContentFile
from django.core.management.base import BaseCommand

from Generator.models import Task

DEFAULT_HEADERS = {
    "User-Agent": (
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 "
        "(KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36"
    ),
    "Accept": "*/*",
    "Accept-Language": "ru-RU,ru;q=0.9,en;q=0.8",
    "Referer": "https://oge.fipi.ru/",
}


class Command(BaseCommand):
    help = "Импорт задач из Excel (task_text в первой колонке, zip_url во второй)."

    def add_arguments(self, parser):
        parser.add_argument(
            "excel_path",
            type=str,
            help="Путь к файлу Excel (.xlsx)",
        )
        parser.add_argument(
            "--timeout",
            type=int,
            default=120,
            help="Таймаут HTTP-запроса в секундах (по умолчанию 120; для крупных .rar с ФИПИ).",
        )
        parser.add_argument(
            "--skip",
            type=int,
            default=0,
            help="Пропустить первые N строк таблицы (для продолжения импорта).",
        )
        parser.add_argument(
            "--limit",
            type=int,
            default=None,
            help="Обработать не больше N строк после --skip.",
        )
        parser.add_argument(
            "--no-verify-ssl",
            action="store_true",
            help="Не проверять HTTPS-сертификат (если ошибка CERTIFICATE_VERIFY_FAILED на macOS).",
        )
        parser.add_argument(
            "--retries",
            type=int,
            default=5,
            help="Сколько раз повторить скачивание при сетевой ошибке (по умолчанию 5).",
        )
        parser.add_argument(
            "--retry-delay",
            type=float,
            default=4.0,
            help="Базовая пауза между попытками в секундах; на k-й попытке ждём k * это значение (по умолчанию 4).",
        )

    def handle(self, *args, **options):
        path = options["excel_path"]
        timeout = options["timeout"]
        skip = max(0, options["skip"])
        limit = options["limit"]
        verify_ssl = not options["no_verify_ssl"]
        max_retries = max(1, options["retries"])
        retry_delay = max(0.5, float(options["retry_delay"]))
        if not verify_ssl:
            urllib3.disable_warnings(urllib3.exceptions.InsecureRequestWarning)
            self.stderr.write(
                self.style.WARNING("Предупреждение: проверка SSL отключена (--no-verify-ssl).")
            )

        df = pd.read_excel(path, header=None)
        if df.shape[1] < 2:
            raise SystemExit(
                "В таблице должно быть минимум 2 столбца: текст задания и URL файла."
            )
        df = df.iloc[:, :2].copy()
        df.columns = ["task_text", "zip_url"]

        file_total = len(df)
        if skip >= file_total:
            raise SystemExit(f"--skip={skip} не меньше числа строк в файле ({file_total}).")

        df_rest = df.iloc[skip:]
        if limit is not None and limit > 0:
            df_rest = df_rest.iloc[:limit]

        if skip or limit is not None:
            self.stdout.write(
                self.style.NOTICE(
                    f"Диапазон: строки {skip + 1}–{skip + len(df_rest)} из {file_total} в файле."
                )
            )

        total = file_total
        for i, (_, row) in enumerate(df_rest.iterrows()):
            idx = skip + i + 1
            raw_text = row["task_text"]
            raw_url = row["zip_url"]

            if pd.isna(raw_text):
                self.stderr.write(self.style.WARNING(f"[{idx}/{total}] Пропуск: пустой текст задания"))
                continue
            task_text = str(raw_text).strip()
            if not task_text:
                self.stderr.write(self.style.WARNING(f"[{idx}/{total}] Пропуск: пустой текст задания"))
                continue

            if pd.isna(raw_url):
                self.stderr.write(self.style.WARNING(f"[{idx}/{total}] Пропуск: нет URL"))
                continue
            zip_url = str(raw_url).strip()
            if zip_url.startswith("//"):
                zip_url = "https:" + zip_url
            elif zip_url.startswith("/") and not zip_url.lower().startswith(("http://", "https://")):
                zip_url = "https://oge.fipi.ru" + zip_url
            if not zip_url or not zip_url.lower().startswith(("http://", "https://")):
                self.stderr.write(
                    self.style.ERROR(f"[{idx}/{total}] Пропуск: некорректный URL ({zip_url!r})")
                )
                continue

            self.stdout.write(f"[{idx}/{total}] Скачивание {zip_url}...")
            self.stdout.flush()
            response = None
            last_err = None
            for attempt in range(max_retries):
                try:
                    response = requests.get(
                        zip_url,
                        timeout=timeout,
                        verify=verify_ssl,
                        headers=DEFAULT_HEADERS,
                    )
                    response.raise_for_status()
                    break
                except RequestException as e:
                    last_err = e
                    if attempt + 1 >= max_retries:
                        break
                    wait_s = retry_delay * (attempt + 1)
                    self.stderr.write(
                        self.style.WARNING(
                            f"[{idx}/{total}] Попытка {attempt + 1}/{max_retries} не удалась ({e!s}); "
                            f"пауза {wait_s:.1f} с…"
                        )
                    )
                    self.stderr.flush()
                    time.sleep(wait_s)
            if response is None:
                self.stderr.write(
                    self.style.ERROR(f"[{idx}/{total}] Ошибка скачивания после {max_retries} попыток: {last_err}")
                )
                continue

            path_part = urlparse(zip_url).path
            filename = unquote(path_part.rsplit("/", 1)[-1]).strip() or f"task_{idx}.zip"

            task = Task.objects.create(task_template=task_text)
            task.files.save(filename, ContentFile(response.content), save=True)

            self.stdout.write(self.style.SUCCESS(f"[{idx}/{total}] Создана задача id={task.id}"))

        self.stdout.write(self.style.SUCCESS("Готово."))
