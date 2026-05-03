#!/usr/bin/env python3
"""
Синхронизация задач из production в dev.
Скачивает задачи с generatorexams.replit.app которых нет в dev,
добавляет их в dev-базу и обновляет load_data.sql.
"""
import urllib.request, urllib.parse, re, html, sys, os
from http.cookiejar import CookieJar

BASE = "https://generatorexams.replit.app"
ADMIN_USER = "admin"
ADMIN_PASS = "admin"
LOAD_DATA_PATH = os.path.join(os.path.dirname(__file__), "load_data.sql")
DEV_DB = "postgresql://postgres:password@helium/heliumdb?sslmode=disable"

sys.path.insert(0, os.path.join(os.path.dirname(__file__), "Generator"))
os.environ.setdefault("DJANGO_SETTINGS_MODULE", "Generator.settings")
import django
django.setup()
from Generator.models import Task, TaskList
from django.utils import timezone
import subprocess


def make_opener():
    cj = CookieJar()
    opener = urllib.request.build_opener(urllib.request.HTTPCookieProcessor(cj))
    return opener


def admin_login(opener):
    r = opener.open(f"{BASE}/admin/login/")
    body = r.read().decode()
    csrf = re.search(r'name="csrfmiddlewaretoken" value="([^"]+)"', body).group(1)
    data = urllib.parse.urlencode({
        "csrfmiddlewaretoken": csrf,
        "username": ADMIN_USER,
        "password": ADMIN_PASS,
        "next": "/admin/"
    }).encode()
    r = opener.open(urllib.request.Request(
        f"{BASE}/admin/login/", data=data,
        headers={"Referer": f"{BASE}/admin/login/"}
    ))
    if "login" in r.url:
        print("ОШИБКА: Не удалось войти в admin. Проверьте пароль.")
        sys.exit(1)
    print("Вход в production admin: ОК")


def get_prod_task_ids(opener):
    all_ids = set()
    page = 0
    while True:
        r = opener.open(f"{BASE}/admin/Generator/task/?p={page}&o=1")
        body = r.read().decode()
        ids = set(int(x) for x in re.findall(r"/admin/Generator/task/(\d+)/change/", body))
        new = ids - all_ids
        if not new:
            break
        all_ids.update(ids)
        page += 1
    return all_ids


def extract_field(body, name):
    m = re.search(rf'<textarea[^>]*name="{name}"[^>]*>(.*?)</textarea>', body, re.DOTALL)
    if m:
        return html.unescape(m.group(1).strip())
    m = re.search(rf'<input[^>]*name="{name}"[^>]*value="([^"]*)"', body)
    if m:
        return html.unescape(m.group(1).strip())
    m = re.search(rf'<select[^>]*name="{name}"[^>]*>(.*?)</select>', body, re.DOTALL)
    if m:
        sel = re.search(r'<option[^>]*selected[^>]*value="([^"]*)"', m.group(1))
        if sel:
            return sel.group(1).strip()
    return None


def fetch_and_add_tasks(opener, missing_ids):
    added = 0
    errors = []
    for i, task_id in enumerate(missing_ids, 1):
        try:
            r = opener.open(f"{BASE}/admin/Generator/task/{task_id}/change/")
            body = r.read().decode()

            task_list_id = extract_field(body, "task")
            task_template = extract_field(body, "task_template")
            answer = extract_field(body, "answer")
            author = extract_field(body, "author")
            created_by = extract_field(body, "created_by")

            if not task_list_id or not task_template:
                errors.append(f"ID {task_id}: не хватает полей")
                continue

            try:
                tl = TaskList.objects.get(id=int(task_list_id))
            except TaskList.DoesNotExist:
                errors.append(f"ID {task_id}: TaskList {task_list_id} не найден в dev")
                continue

            Task.objects.create(
                id=task_id,
                task=tl,
                task_template=task_template,
                answer=answer or "",
                author=author or "",
                created_by=created_by or "ADMIN",
                added_at=timezone.now()
            )
            added += 1
            if i % 10 == 0:
                print(f"  Скачано {i}/{len(missing_ids)}...")
        except Exception as e:
            errors.append(f"ID {task_id}: {e}")

    return added, errors


def update_load_data_sql():
    print("Обновляю load_data.sql...")
    result = subprocess.run(
        ["pg_dump", DEV_DB, "--data-only", "--no-privileges", "--no-owner"],
        capture_output=True, text=True
    )
    lines = [
        line for line in result.stdout.splitlines()
        if not line.startswith("\\restrict") and not line.startswith("\\unrestrict")
    ]
    with open(LOAD_DATA_PATH, "w", encoding="utf-8") as f:
        f.write("\n".join(lines))
    print(f"load_data.sql обновлён: {len(lines)} строк")


def main():
    print("=" * 50)
    print("Синхронизация: Production → Dev")
    print("=" * 50)

    opener = make_opener()
    admin_login(opener)

    print("Собираю ID задач из production...")
    prod_ids = get_prod_task_ids(opener)
    print(f"Задач в production: {len(prod_ids)}")

    dev_ids = set(Task.objects.values_list("id", flat=True))
    print(f"Задач в dev: {len(dev_ids)}")

    missing_ids = sorted(prod_ids - dev_ids)
    print(f"Отсутствует в dev: {len(missing_ids)} задач")

    if not missing_ids:
        print("Dev уже синхронизирован с production. Ничего делать не нужно.")
        update_load_data_sql()
        return

    print(f"\nСкачиваю {len(missing_ids)} задач...")
    added, errors = fetch_and_add_tasks(opener, missing_ids)

    print(f"\nДобавлено: {added}/{len(missing_ids)}")
    if errors:
        print(f"Ошибки ({len(errors)}):")
        for e in errors:
            print(f"  {e}")

    print(f"Всего задач в dev: {Task.objects.count()}")
    update_load_data_sql()
    print("\nСинхронизация завершена.")


if __name__ == "__main__":
    main()
