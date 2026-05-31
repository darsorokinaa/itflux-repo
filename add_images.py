import os
import re

import django

# В проекте есть несколько settings.py; для задач используем основной django-проект в папке Generator/.
os.environ.setdefault("DJANGO_SETTINGS_MODULE", "Generator.Generator.settings")
# В некоторых settings используется .strip() у переменной окружения — подставляем безопасный дефолт.
os.environ.setdefault("LINK_SECRET_FOR_TASKS", "tmp")
django.setup()

from django.conf import settings
from Generator.models import Task


def move_image_to_bottom(html: str, filename: str) -> tuple[str, bool]:
    """
    Убирает все вхождения картинки /media/tasks/<filename> из html и добавляет одно в конец.
    Возвращает (new_html, changed).
    """
    html = html or ""
    escaped = re.escape(filename)
    # Ищем figure c нужным src (с опциональным self-closing / и произвольными атрибутами).
    pattern = re.compile(
        rf'<figure[^>]*>\s*<img[^>]*src=["\']/media/tasks/{escaped}["\'][^>]*>\s*</figure>',
        flags=re.IGNORECASE,
    )
    matches = pattern.findall(html)
    if not matches:
        return html, False
    cleaned = pattern.sub("", html).strip()
    img = f'<figure class="image"><img src="/media/tasks/{filename}"></figure>'
    new_html = f"{cleaned}{img}" if cleaned else img
    return new_html, new_html != html


def main():
    tasks_dir = os.path.join(settings.MEDIA_ROOT, "tasks")
    if not os.path.isdir(tasks_dir):
        print(f"[ERROR] Directory does not exist: {tasks_dir}")
        return

    for filename in os.listdir(tasks_dir):
        name, ext = os.path.splitext(filename)
        if not name.isdigit():
            continue
        try:
            task = Task.objects.get(id=int(name))
            img = f'<figure class="image"><img src="/media/tasks/{filename}"></figure>'
            base = task.task_template or ""
            if f"/media/tasks/{filename}" in base:
                reordered_html, changed = move_image_to_bottom(base, filename)
                if not changed:
                    print(f"[SKIP] {filename} - already at bottom")
                    continue
                task.task_template = reordered_html
                task.save(update_fields=["task_template"])
                print(f"[MOVE] {filename} - moved under text")
                continue

            task.task_template = f"{base}{img}"
            task.save(update_fields=["task_template"])
            print(f"[OK] {filename}")
        except Task.DoesNotExist:
            print(f"[MISS] {filename} - task not found")


if __name__ == "__main__":
    main()
