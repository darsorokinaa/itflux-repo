# Исправления по аудиту безопасности (ветка `security/privacy-audit-2026-08`)

Дата: 6 августа 2026  
Полный отчёт: `SECURITY_PRIVACY_AUDIT.md`

## Что было небезопасно → как исправлено → тест → ограничения

### C-01. Публичные `/media/cabinet/homework/` и `/media/cabinet/materials/`
- **Было:** nginx отдавал файлы с диска; `media_serve` блокировал только boards/my-files.
- **Исправлено:**
  - `Generator/Generator/urls.py` — запрет homework/materials
  - `deploy/nginx.conf` — proxy этих префиксов в Django
  - `Cabinet/files_services.py` — API URL вместо публичного media
  - `MaterialViewSet` actions `file`/`preview`
  - `StudentMaterialFileView` + URL
- **Тест:** `Cabinet.tests_security_audit.PrivateMediaForbiddenTests`, `MaterialFileAclTests`, `HomeworkSubmissionMediaForbiddenTests`
- **Ограничение:** после деплоя нужно обновить nginx на сервере. Старые закладки на `/media/cabinet/...` перестанут работать (ожидаемо).

### C-02. WebSocket урока без auth
- **Было:** `LessonConsumer.connect` принимал любого; роль бралась из клиентского `join`.
- **Исправлено:** обязательный JWT (`?token=` / Bearer / `X-Lesson-Token`); room_id из токена; роль только из JWT; teacher-only события.
- **Клиент:** `lesson_room.html` передаёт token в URL WS.
- **Тест:** unit на разбор query token; полный Channels e2e — рекомендуется вручную на стенде.
- **Ограничение:** клиенты без токена отключаются (код 4401). Нужен актуальный `LESSON_SECRET`.

### C-03. Credentials в `sync_from_prod.py`
- **Было:** hardcoded admin/password и DB URL.
- **Исправлено:** только env `SYNC_PROD_ADMIN_USER`, `SYNC_PROD_ADMIN_PASS`, `SYNC_DEV_DB_URL`.
- **Ограничение:** dumps/`db.sqlite3`/tracked media **ещё в git** — нужна отдельная ops-операция (filter-repo + ротация секретов). Не выполнено автоматически.

### H-01. Legacy `BoardConsumer`
- **Было:** анонимный relay.
- **Исправлено:** отказ без authenticated session; лимит размера сообщения.
- **Ограничение:** authenticated user всё ещё может выбрать произвольный `room_name` (legacy). Основная доска — `InteractiveBoardConsumer`.

### H-02. Billing badge peer leak
- **Было:** ученик на групповом уроке видел финансы всех.
- **Исправлено:** `event_billing_badge(..., student_ids=)` + фильтрация в `BillingEventBadgeView`.
- **Тест:** `BillingBadgeIsolationTests`

### H-03. Race на accept student invite
- **Было:** нет `select_for_update`.
- **Исправлено:** lock строки приглашения + повторная проверка PENDING.
- **Тест:** `StudentInviteAcceptRaceTests`

### H-06. OAuth tokens в admin Profile
- **Было:** поля видны в admin.
- **Исправлено:** `exclude` для `yandex_oauth_token`, `yandex_refresh_token`; invite/telegram token убраны из list_display.
- **Тест:** `ProfileAdminSecretsTests`

### M-01. InteractiveAttempt cross-teacher write
- **Было:** create без проверки ownership assignment/student.
- **Исправлено:** `perform_create` валидирует `assignment.teacher` и `student.teacher`.

### Прочее
- Регистрация не поднимает `is_staff`/`is_superuser` — подтверждено тестом `RegisterCannotElevateStaffTests`.

## Дополнительно исправлено (вторая итерация)

### Дампы / media убраны из индекса Git
- `git rm --cached` для `dumps/`, `deploy/dumps/`, `db.sqlite3`, `Generator/media/cabinet/`, `*.dump`
- Файлы остаются на диске локально, но больше не трекаются
- **Ограничение:** история Git всё ещё может содержать старые объекты — нужен `git filter-repo` / BFG + ротация секретов на сервере

### systemd не от root
- `deploy/gunicorn.service`: `User=itflux`, hardening (`NoNewPrivileges`, `PrivateTmp`, …)
- `post_deploy.sh`: больше не создаёт `admin`/`admin`

### Метрика только после согласия
- Убрана из `index.html`
- `frontend/src/utils/analytics.js` + вызов из `Layout` / `main.jsx`
- URL для analytics чистится от token/invite

### Токены в URL
- Homework API: JWT в `Authorization` / `X-Lesson-Token`, не в query
- Lesson join / lesson_room: после чтения token — `history.replaceState`
- ExamPage: `lesson_token` в sessionStorage, убирается из URL
- SW: openWindow только same-origin

### HTML заданий
- `dompurify` + `sanitizeTaskHtml` в `MathContent`
- Запрет upload `.html`/`.svg`/`.js`/`.sh`

### Admin MFA (TOTP)
- `django-otp` в обоих settings
- `ADMIN_OTP_REQUIRED` (в prod по умолчанию true)
- `python manage.py setup_admin_totp <username>`
- Миграции `otp_totp` / `otp_static`

### react-router
- Обновлён до `react-router-dom@7.18.2` (+ `dompurify`)
- Часть advisory npm всё ещё помечает 7.12–8.2 (в т.ч. RSC-режим); отдельного `react-router-dom@8.3` нет. Остаточные transitive CVE (excalidraw/doc-viewer) — вне полного auto-fix без ломки UI.

## Не исправлено / осталось ops
- Purge dumps из **истории** Git + ротация секретов
- Политика ПДн / юрист (C-04)
- Hash student invite tokens
- Redis channel layer
- Полный zero npm audit (transitive)

## Как проверить локально
```bash
python manage.py test Cabinet.tests_security_audit --keepdb
python manage.py check --deploy   # на prod-подобном DEBUG=0
```

## Деплой (не выполнен автоматически)
1. Задеплоить код ветки.
2. Обновить nginx из `deploy/nginx.conf` (новые location homework/materials).
3. Перезапустить Daphne/ASGI.
4. Проверить урок: WS с token, скачивание материала через API.
5. Ротация секретов, если dumps/репо когда-либо утекали.
