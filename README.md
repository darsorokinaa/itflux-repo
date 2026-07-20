# itflux

Образовательная платформа **«Цифровой поток»**: генератор экзаменационных вариантов, автопроверка, PDF, уроки.

## Локальный запуск

```bash
./start-local.sh
```

- Фронтенд: http://localhost:5000  
- Django (генератор): http://localhost:8000  

## База данных

По умолчанию PostgreSQL: `PGDATABASE=itflux` (см. `Generator/Generator/settings.py`).

```bash
createdb itflux   # если БД ещё нет
cd Generator && ../.venv/bin/python manage.py migrate
```

## Деплой

См. `deploy/DEPLOY_CHECKLIST.md`, `deploy/update.sh`.

## Видеоуроки (Jitsi Meet)

Онлайн-уроки в кабинете встраиваются через Jitsi IFrame API. Настройка, JWT, миграции и проверка CSP — в [`docs/JITSI_INTEGRATION.md`](docs/JITSI_INTEGRATION.md).
