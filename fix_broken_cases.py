"""
Одноразовый фикс: задачи, у которых система уравнений сохранилась в БД как
`\({eq1,eq2\)` (без `\begin{cases}`), заменяем на свежий нормализованный
вариант из исходного Excel.

Сматчиваем DB ↔ Excel по «сигнатуре»: убираем из обоих строк всю LaTeX-обвязку
(`\(`, `\)`, `\begin{cases}`, `\end{cases}`, `\\`, `^{`, `}`, пробелы) и
сравниваем оставшиеся символы (буквы, цифры, операторы).

Запуск:
    cd Generator && ../.venv/bin/python ../fix_broken_cases.py
"""
from __future__ import annotations

import os
import re
import sys
from pathlib import Path

import django
import pandas as pd

# Чтобы импорт fipi_html_normalize работал, запускаем из корня проекта.
ROOT = Path(__file__).parent.resolve()
sys.path.insert(0, str(ROOT))

os.environ.setdefault("DJANGO_SETTINGS_MODULE", "Generator.settings")
sys.path.insert(0, str(ROOT / "Generator"))
django.setup()

from django.db import transaction  # noqa: E402

from fipi_html_normalize import normalize_fipi_task_html  # noqa: E402
from Generator.models import Task  # noqa: E402


EXCEL_FILES = [
    "/Users/darsorokina/Desktop/Преподавание/kes_3_1.xlsx",
    "/Users/darsorokina/Desktop/Преподавание/kes_2_4.xlsx",
]


_SIG_NOISE = re.compile(
    r"(\\\(|\\\)|\\begin\{cases\}|\\end\{cases\}|\\\\|\^\{|[\{\}\s])",
    re.UNICODE,
)


def signature(html_or_text: str) -> str:
    """Сигнатура: оставляем только текст/цифры/операторы, убираем LaTeX-обвязку."""
    if not html_or_text:
        return ""
    s = str(html_or_text)
    # Сносим HTML-теги.
    s = re.sub(r"<[^>]+>", "", s)
    # Убираем LaTeX-обвязку и пробелы.
    s = _SIG_NOISE.sub("", s)
    # Невидимые символы и nbsp.
    s = s.replace("\u00a0", "").replace("\u2062", "")
    return s


def collect_excel_rows() -> list[tuple[str, str]]:
    """Возвращает список (signature, new_html) для строк с <mjx-mtable>."""
    out: list[tuple[str, str]] = []
    for path in EXCEL_FILES:
        if not Path(path).exists():
            print(f"  [skip excel] {path} не найден")
            continue
        df = pd.read_excel(path)
        if "text" not in df.columns:
            print(f"  [skip excel] {path}: нет колонки 'text'")
            continue
        n = 0
        for raw in df["text"].dropna():
            raw_s = str(raw)
            if "<mjx-mtable" not in raw_s:
                continue
            normalized = normalize_fipi_task_html(raw_s, download=None)
            sig = signature(normalized)
            if sig:
                out.append((sig, normalized))
                n += 1
        print(f"  [excel] {Path(path).name}: {n} строк с системами")
    return out


def main() -> None:
    print("Готовим карту Excel → новый HTML …")
    pairs = collect_excel_rows()
    print(f"Итого в Excel: {len(pairs)} систем")

    sig_to_html: dict[str, str] = {}
    for sig, html in pairs:
        sig_to_html[sig] = html

    print("Ищем в БД сломанные системы …")
    qs = (
        Task.objects.exclude(task_template__contains=r"\begin{cases}")
        .filter(task_template__contains=r"\({")
    )
    total = qs.count()
    print(f"Кандидатов в БД: {total}")

    fixed = 0
    skipped = 0
    with transaction.atomic():
        for task in qs.iterator():
            sig = signature(task.task_template)
            new_html = sig_to_html.get(sig)
            if not new_html:
                # Иногда между Excel и БД отличается «хвост» (точки/пробелы).
                # Попробуем эвристически — обрезать концевые точки.
                trimmed = sig.rstrip(".,")
                matches = [v for k, v in sig_to_html.items() if k.rstrip(".,") == trimmed]
                if len(matches) == 1:
                    new_html = matches[0]
            if not new_html:
                skipped += 1
                print(f"  [skip] task id={task.id} — нет совпадения, sig={sig[:120]}…")
                continue
            if task.task_template == new_html:
                continue
            task.task_template = new_html
            task.save(update_fields=["task_template"])
            fixed += 1
            print(f"  [fix]  task id={task.id}")

    print(f"\nГотово. Обновлено: {fixed}, пропущено: {skipped}, всего кандидатов: {total}")


if __name__ == "__main__":
    main()
