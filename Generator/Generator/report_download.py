"""Имя файла отчёта после «Завершить вариант».

Тот же PDF, что отдаёт POST /api/<level>/<subject>/report-pdf/:
content-type application/pdf, шаблон report_template.html, вложение
``report-<имя>.pdf``. Пробелы в имени сохраняются, как в Content-Disposition.
"""


def finish_variant_report_filename(student_name: str) -> str:
    safe = "".join(
        c if c.isalnum() or c in " -_" else "-" for c in (student_name or "")
    ).strip() or "report"
    return f"report-{safe}.pdf"
