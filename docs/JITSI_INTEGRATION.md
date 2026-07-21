# Интеграция Jitsi Meet в «Цифровой поток»

Видеоуроки встроены в кабинет через официальный **Jitsi Meet IFrame API**. Комната привязана к событию расписания (`ScheduleEvent`), а не к отдельной «гостевой» ссылке.

## 1. Добавленные компоненты

| Слой | Файлы |
|------|--------|
| Модели | `Cabinet.VideoMeeting`, `Cabinet.MeetingAttendance` |
| Сервисы | `Cabinet/jitsi_service.py`, `Cabinet/video_meeting_service.py` |
| API | `Cabinet/video_meeting_api.py`, `Cabinet/video_meeting_urls.py` → `/api/video-meetings/` |
| Admin | регистрация `VideoMeeting`, `MeetingAttendance` |
| Frontend | `/cabinet/meetings/:meetingUuid` — `VideoMeetingPage.jsx` |
| Настройки | `Generator/settings.py` (`JITSI_*`) |
| Миграция | `Cabinet/migrations/0027_video_meeting.py` |

## 2. Переменные окружения

```env
JITSI_DOMAIN=meet.jit.si
JITSI_AUTH_MODE=none

JITSI_APP_ID=
JITSI_APP_SECRET=
JITSI_SUB=
JITSI_AUD=jitsi
JITSI_TOKEN_TTL_SECONDS=7200

JITSI_JOIN_BEFORE_MINUTES=15
JITSI_JOIN_AFTER_MINUTES=30
JITSI_EMBED_EXTRA_HOSTS=
```

Секрет `JITSI_APP_SECRET` читается только на сервере. Он не попадает в HTML, JS и ответы API.

Сейчас отдельного Jitsi-домена у проекта **нет**. Рабочий режим по умолчанию — `meet.jit.si` без JWT.

Когда появится свой хост (DNS A-запись + установленный Jitsi):

```env
JITSI_DOMAIN=lesson.itflux-academy.ru
JITSI_AUTH_MODE=jwt
JITSI_APP_ID=generator_test
JITSI_APP_SECRET=<тот же app_secret, что в Prosody>
JITSI_SUB=lesson.itflux-academy.ru
JITSI_AUD=jitsi
```

Важно: если свой домен задан вместе с `JITSI_APP_ID` / `JITSI_APP_SECRET`, а `JITSI_AUTH_MODE` случайно остался `none`, бэкенд **всё равно выдаст JWT** — иначе учитель застрянет на экране «Я организатор». На `meet.jit.si` авто-JWT не включается.

Синхронизация Prosody с Django: `sudo bash deploy/jitsi/fix-jwt-prosody.sh`.

Шаблоны: `deploy/.env.production.example`, `deploy/jitsi/.env.jwt.example`.  
Пошагово: [`deploy/jitsi/README.md`](../deploy/jitsi/README.md).

## 3. Тест через meet.jit.si

1. В `.env`: `JITSI_DOMAIN=meet.jit.si`, `JITSI_AUTH_MODE=none`.
2. Применить миграции и перезапустить Django.
3. Учитель: Календарь → создать онлайн-урок → «Создать автоматически (Jitsi)» (по умолчанию) → сохранить.
   Комната создаётся сразу (`jitsi_auto_create`); либо позже — «Создать видеокомнату» / «Начать урок».
4. Откроется `/cabinet/meetings/<uuid>` с iframe Jitsi.
5. Ученик того же урока в окне подключения видит «Подключиться».

Ограничения режима без JWT описаны в §10.

## 4. Переключение на собственный Jitsi

1. Развернуть Jitsi отдельно (не в Django Compose), например `meet.itflux-academy.ru`.
2. Выставить `JITSI_DOMAIN` на этот хост.
3. Добавить домен в nginx CSP / Permissions-Policy (`deploy/nginx.conf`, блок `/cabinet/meetings/`).
4. Включить JWT (§5).
5. Перезапустить gunicorn/daphne и перезагрузить nginx.

## 5. Включение JWT

```env
JITSI_AUTH_MODE=jwt
JITSI_APP_ID=<app_id из prosody>
JITSI_APP_SECRET=<app_secret из prosody>
JITSI_SUB=<обычно тот же домен, что JITSI_DOMAIN>
JITSI_AUD=jitsi
```

Claims (Prosody `token_verification`, не JaaS):

- `iss` = `JITSI_APP_ID`
- `aud` = `JITSI_AUD` (по умолчанию `jitsi`)
- `sub` = `JITSI_SUB` или домен
- `room` = имя комнаты урока (не `*`)
- `context.user.moderator` = true только для учителя/staff
- `iat`, `nbf`, `exp`

## 6. Миграции

```bash
python manage.py migrate Cabinet
# или
python manage.py migrate
```

## 7. CSP и Permissions-Policy

Проверьте заголовки для `/cabinet/meetings/`:

- `script-src` / `frame-src` / `connect-src` / `img-src` / `media-src` — только свой origin и `https://<JITSI_DOMAIN>` (+ `wss://` для connect).
- Permissions-Policy: `camera`, `microphone`, `display-capture`, `fullscreen`, `autoplay` — для платформы и домена Jitsi.

Не используйте `*` и не добавляйте `unsafe-eval` без необходимости.

## 8. Камера и микрофон

1. Платформа и Jitsi должны быть на HTTPS (кроме localhost).
2. Браузер запросит разрешения на prejoin-экране Jitsi.
3. При отказе пользователь видит русскоязычные сообщения на странице урока.
4. Убедитесь, что камера не занята другим приложением.

## 9. Проверка учителем и учеником

**Учитель**

1. Создать/открыть онлайн-урок в расписании.
2. «Создать видеокомнату» → комната один раз на урок.
3. В окне подключения — «Начать урок» / «Войти в комнату».
4. «Завершить урок» закрывает вход для новых участников и открытые сессии посещаемости.
5. «Посещаемость» показывает входы/выходы.

**Ученик**

1. Урок должен быть его (участник / группа / `Student.user`).
2. Кнопка «Подключиться» в окне: за 15 мин до начала … +30 мин после конца.
3. Имя берётся из профиля; посторонний UUID даёт 403.

## 10. Ограничения режима без JWT (`meet.jit.si` / `JITSI_AUTH_MODE=none`)

- Комнату теоретически можно угадать/открыть напрямую на домене Jitsi, если знать `roomName`.
- На **meet.jit.si** учитель увидит экран «ожидание модератора» и кнопку **«Я организатор»** — это ограничение публичного сервера, а не платформы. Нужно нажать кнопку и войти в аккаунт Jitsi.
- `startAsModerator` и роль из профиля платформы на meet.jit.si **не работают** без JWT их сервера (JaaS).
- Платформа по-прежнему не отдаёт `join-config` посторонним (403), но это не заменяет auth на сервере Jitsi.
- Для production используйте свой Jitsi + JWT — тогда учитель входит сразу как модератор.

## 11. Откат

1. Откатить миграцию: `python manage.py migrate Cabinet 0026_invitation_pre_student` (или предыдущий номер).
2. Убрать/закомментировать `JITSI_*` в env.
3. Откатить фронтенд-сборку и nginx-блок `/cabinet/meetings/`.
4. Модели можно оставить пустыми — Телемост продолжит работать для уроков с `telemost_url`.

## 12. Перезапуск после деплоя

```bash
python manage.py migrate
# сборка фронта при изменении React
npm run build   # в frontend/
sudo systemctl reload nginx
sudo systemctl restart gunicorn   # или ваш unit
sudo systemctl restart daphne     # если используется отдельно
```

Jitsi на отдельном хосте перезапускается своим compose/systemd, не через Django.

## Production-схема

```text
Пользователь
    ↓
Django проверяет доступ
    ↓
Django создаёт короткоживущий JWT
    ↓
Frontend загружает external_api.js
    ↓
Jitsi проверяет JWT
    ↓
Пользователь входит в конкретную комнату
```

```text
itflux.ru (или staging)   — Django-платформа
meet.<ваш-домен>          — отдельный Jitsi Meet (+ JWT), когда будет создан
```

Не проксируйте WebSocket Jitsi через Django. Развёртывание Jitsi — см. `deploy/jitsi/README.md`.

## API

| Метод | Путь | Назначение |
|-------|------|------------|
| GET/POST | `/api/video-meetings/for-event/<id>/` | статус / создать комнату |
| GET | `/api/video-meetings/<uuid>/` | карточка конференции |
| GET/POST | `/api/video-meetings/<uuid>/join-config/` | domain, room, jwt, userInfo |
| POST | `/api/video-meetings/<uuid>/start/` | статус live |
| POST | `/api/video-meetings/<uuid>/finish/` | завершить + закрыть сессии |
| POST | `/api/video-meetings/<uuid>/attendance/join/` | вход |
| POST | `/api/video-meetings/<uuid>/attendance/leave/` | выход |
| GET | `/api/video-meetings/<uuid>/attendance/` | список для учителя |

Повторный `join` при открытой сессии идемпотентен. После `leave` следующее подключение создаёт новую сессию. Длительность считается на сервере по `joined_at` / `left_at`.
