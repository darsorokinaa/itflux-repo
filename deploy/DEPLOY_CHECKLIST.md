# Деплой генератора в продакшен

Краткий чеклист и порядок действий на сервере.

## Шаблон окружения

Полный список переменных: **`deploy/.env.production.example`**. Скопируйте в каталог с `manage.py` как `.env` или подключите через `systemd` (`EnvironmentFile=`).

## База данных

- **Только PostgreSQL** (см. `Generator/settings.py`, переменные `PGDATABASE`, `PGUSER`, `PGPASSWORD`, `PGHOST`, `PGPORT`).
- Создайте БД и пользователя заранее, выдайте права, затем на сервере: `python manage.py migrate --noinput`.
- Бэкапы: `pg_dump` по расписанию; каталог `media/` — в резервной копии вместе с БД (файлы заданий/вложения).

## Ссылки и согласованность доменов (прод)

| Назначение | Где задаётся | Пример / правило |
|------------|----------------|------------------|
| Публичный URL генератора (страницы, API, `/lesson/`) | Nginx `server_name` + `DJANGO_ALLOWED_HOSTS` | `generator.example.com` в обоих местах, без `*` в проде |
| Публичный URL ЛК | `LK_PUBLIC_URL` в `.env` | `https://lk.example.com` — тот же origin, что в ссылках из ЛК в уроки |
| Сборка SPA: ссылки/ДЗ в сторону ЛК | `frontend`: `VITE_LK_PUBLIC_URL` при `npm run build` | = origin `LK_PUBLIC_URL` (схема+хост+порт) |
| JSON для SPA без жёсткого LK в бандле | `GET /api/site-config/` | Проверяйте `lk_public_url` после деплоя |
| Редирект HTTP → HTTPS | Nginx: отдельный `server { listen 80; return 301 https://$host$request_uri; }` | Как в `deploy/nginx.conf` |
| Выход из `/admin/logout/` | `ITFLUX_PUBLIC_HOME_URL` | Публичная главная, не `localhost` |
| WebSocket урока | `wss://<тот же host>/ws/lesson/...` | Nginx: `location /ws/` + `Upgrade` (см. `nginx.conf`) |
| Прокси ДЗ → API ЛК | `LK_*` + опционально `LK_HOMEWORK_*` | `deploy/LK_ITFLUX_DEBUG.md` |
| CORS (ограничить внешние origin) | `CORS_ALLOWED_ORIGINS` | Список через запятую; не задан — режим «все origin» (только dev) |

**CSRF / доверие к хосту:** задайте `CSRF_TRUSTED_ORIGINS` **или** только `DJANGO_ALLOWED_HOSTS` (хосты без `*`) — тогда `https`/`http` для них добавятся автоматически в `settings.py`.

**Redis** для `channels` (несколько воркеров Daphne): `CHANNEL_LAYER_BACKEND=redis`, `REDIS_HOST`, `REDIS_PORT`. Один процесс — можно `CHANNEL_LAYER_BACKEND=inmemory` (только тест/один воркер).

## Перед выкладкой (локально или в CI)

1. **Фронтенд** (из корня репозитория):

   ```bash
   cd frontend && npm ci && npm run build
   ```

   Убедитесь, что `frontend/dist` попадает в релиз (Django отдаёт SPA из этой папки).

2. **Миграции БД** — на сервере после обновления кода:

   ```bash
   cd /opt/itfluxacademy/itflux   # ваш путь к проекту (корень репозитория — там же manage.py)
   source venv/bin/activate
   python manage.py migrate --noinput
   ```

   Важно: есть миграция `LessonRoom.lesson_ended_at` (завершение урока / запрет повторного входа по комнате).

3. **Статика**:

   ```bash
   python manage.py collectstatic --noinput
   ```

## Переменные окружения (systemd / `.env`)

| Переменная | Назначение |
|------------|------------|
| `DJANGO_SETTINGS_MODULE` | `Generator.settings` |
| `SECRET_KEY` | Случайная длинная строка (не коммитить) |
| `DEBUG` | `false` |
| `PGDATABASE`, `PGUSER`, `PGPASSWORD`, `PGHOST`, `PGPORT` | PostgreSQL |
| `LESSON_SECRET` | **Тот же**, что в ЛК — иначе `/lesson/join/` не откроется |
| `LESSON_WEBHOOK_SECRET` | **Тот же**, что в ЛК — общий webhook-секрет для `teacher-joined`/`student-joined` и homework proxy |
| `LK_PUBLIC_URL` | Базовый URL ЛК (домен), например `http://lk.example.com` — для обратных вызовов к API ЛК |
| `CABINET_API_BASE` | Базовый URL API ЛК для server-to-server запросов генератора (если пусто, берётся `LK_PUBLIC_URL`) |
| `LK_DASHBOARD_URL` | **Опционально.** Полный URL дашборда после входа, куда ведёт кнопка «Личный кабинет», например `http://lk.example.com/dashboard`. Если не задан, открывается корень `LK_PUBLIC_URL` (часто это не дашборд, а лендинг или логин) |
| `ITFLUX_PUBLIC_HOME_URL` | Публичная главная после **выхода из админки** генератора (`/admin/logout/`). По умолчанию `https://itflux.ru`. Без этого при `LOGOUT_REDIRECT_URL='/'` с dev-сервера уводило на `localhost` |
| `LK_NAVIGATION_PASSWORD` | Пароль для кнопки «Личный кабинет» на сайте генератора. Не задан — по умолчанию `100326`. Пустое значение `LK_NAVIGATION_PASSWORD=` — **отключить** запрос пароля |
| `CSRF_TRUSTED_ORIGINS` | Список через запятую с **схемой** (`https://...`). При необходимости отдельно ЛК. Альтернатива: оставить пусто и задать только `DJANGO_ALLOWED_HOSTS` |
| `CORS_ALLOWED_ORIGINS` | **Прод:** перечислить origin’ы (генератор + при необходимости ЛК). Пусто = как в dev (все origin) — нежелательно в бою |
| `SECURE_SSL_REDIRECT` | По умолчанию при `DEBUG=false` — `false` (редирект в nginx). `true` — только если Django сам принимает HTTP и отдаёт 301 |
| `SESSION_COOKIE_SECURE` / `CSRF_COOKIE_SECURE` | При `DEBUG=false` по умолчанию `true` (куки только по HTTPS) |
| `CHANNEL_LAYER_BACKEND` | `inmemory` — один процесс Daphne. Для нескольких воркеров — Redis (см. ниже) |
| `TELEGRAM_BOT_TOKEN`, `TELEGRAM_BOT_USERNAME`, `TELEGRAM_WEBHOOK_SECRET` | Токен от @BotFather, username бота без `@`, секрет вебхука. Без токена отправка молча не работает (`send_telegram_message` возвращает `False` и пишет warning в лог). После задания — один раз выполнить `python manage.py set_telegram_webhook` (иначе привязка Telegram и личные уведомления не работают) |
| `TELEGRAM_CHAT_ID` / `TELEGRAM_TOPIC_ID` | Опционально: общий чат для отчётов об ошибках. На личные уведомления пользователям не влияет |

Пример фрагмента unit-файла см. `deploy/gunicorn.service`.

## WebSocket и уроки

- HTTP + WebSocket обрабатывает **Daphne** (ASGI), не Gunicorn WSGI.
- Nginx должен проксировать и обычные запросы, и `Upgrade` для `/ws/` на тот же порт ASGI (в чеклисте ниже — 8002).
- При **нескольких** процессах Daphne/Gunicorn для каналов нужен **Redis** (см. `Generator/settings.py`).
- Важно: `Generator.asgi:application` и `Generator.settings` резолвятся относительно **рабочей директории** процесса. `WorkingDirectory` в `deploy/gunicorn.service` — корень репозитория (например, `/opt/itfluxacademy/itflux`), а **не** `.../Generator`: в корне лежит пакет `Cabinet` (доски/Excalidraw и т.д.), который подключает `Generator/asgi.py`. Если запустить Daphne с `cwd=.../Generator`, `Cabinet` не найдётся и ASGI-приложение не поднимется (упадёт `ModuleNotFoundError`/`AppRegistryNotReady`) — сломается не только совместное редактирование досок, а весь бэкенд.

## Команды на сервере (по порядку)

**Рекомендуется:** один скрипт из репозитория (ветка по умолчанию `itflux`, nginx-файл `itflux`; см. переменные в шапке скрипта):

```bash
sudo bash /opt/itfluxacademy/itflux/deploy/update.sh
```

**Вручную** (если нужно обойти скрипт):

```bash
cd /opt/itfluxacademy/itflux
git pull origin itflux

sudo cp deploy/gunicorn.service /etc/systemd/system/itflux.service
sudo systemctl daemon-reload

# при изменении nginx (имя файла должно совпадать с тем, что в sites-enabled):
sudo cp deploy/nginx.conf /etc/nginx/sites-available/itflux
sudo ln -sf /etc/nginx/sites-available/itflux /etc/nginx/sites-enabled/itflux
sudo nginx -t && sudo systemctl reload nginx

source venv/bin/activate
pip install -r requirements.txt
python manage.py migrate --noinput
python manage.py collectstatic --noinput

cd frontend && rm -rf dist && npm ci && npm run build && cd ..

sudo systemctl restart itflux
sudo systemctl status itflux
```

## Фоновые задачи (cron)

Устанавливаются автоматически в `deploy/update.sh` через `deploy/install_cron.sh`.

Вручную:

```bash
sudo bash /opt/itfluxacademy/itflux/deploy/install_cron.sh
crontab -l | grep itflux-cron
```

Задачи: напоминания об уроках, отсутствие, дайджесты ДЗ, просрочки ДЗ, окончание подписки, очистка anon. Логи: `/var/log/itflux/cron-*.log`. Нужен env: `/etc/itflux/itflux.env` (или `.env` в корне приложения).

## Проверки после деплоя

0. `python manage.py check --deploy` — предупреждения Django по безопасности (с `DEBUG=false` и целевым `.env`).
0a. `crontab -l | grep itflux-cron` — блок cron установлен; `ls -lt /var/log/itflux/cron-*.log`.

1. `GET /api/site-config/` — в ответе `lk_public_url`, `lk_nav_password_required`, `lk_nav_unlocked`.
2. Кнопка «Личный кабинет» — при включённом пароле открывается только после `POST /api/lk-nav-unlock/` с верным паролем.
3. `GET /api/lesson/verify/?token=…` — `ok: true` для валидного JWT.
4. `GET /lesson/join/?token=…` — HTML комнаты урока, не пустая SPA-ошибка.
5. WebSocket: `wss://домен/ws/lesson/<room_id>/` подключается без ошибки.
6. WebSocket досок (совместное редактирование Excalidraw в кабинете): `wss://домен/ws/interactive-boards/<board_id>/` подключается без ошибки; `systemctl status itflux` — процесс не в цикле рестартов, в логах нет `ModuleNotFoundError: No module named 'Cabinet'` / `AppRegistryNotReady`.

## Типичные проблемы

- **Разный `LESSON_SECRET`** в генераторе и ЛК — проверка токена падает.
- **`ROOT_URLCONF`** должен включать маршруты приложения (в актуальной конфигурации — `Generator.urls` внутри пакета `Generator`).
- **Кнопка ЛК ведёт на главную генератора** — не задан или неверен `LK_PUBLIC_URL` на сервере.
- **Не работает совместное редактирование досок (Excalidraw) или сайт вообще не отвечает** — Daphne запущен не из корня репозитория (см. `WorkingDirectory` выше). Проверьте `systemctl status itflux --no-pager` и `journalctl -u itflux -n 50`.
