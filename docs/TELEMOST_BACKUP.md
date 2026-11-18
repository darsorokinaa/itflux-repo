# Запасной звонок Яндекс Телемост

На живом уроке учитель может открыть запасной звонок в Телемосте. Сервер создаёт публичную встречу от **сервисного** аккаунта платформы. Ученики заходят по ссылке гостями, без входа в Яндекс и без личного аккаунта преподавателя.

Яндекс запрещает встраивать Телемост в iframe (`X-Frame-Options: DENY`, `frame-ancestors 'none'`). Поэтому звонок открывается в отдельном окне или вкладке. Поверх урока показывается карточка «Открыть звонок в Телемосте»; она остаётся на месте при переходе по кабинету.

Токен хранится только в переменных окружения сервера и в базу не пишется.

## Переменные окружения

Нужен один сервисный аккаунт, например `itflux.academy@yandex.com`, **не** личный аккаунт преподавателя.

- `YANDEX_TELEMOST_OAUTH_TOKEN` или `TELEMOST_OAUTH_TOKEN` — access-токен сервисного аккаунта
- `YANDEX_TELEMOST_REFRESH_TOKEN` или `TELEMOST_REFRESH_TOKEN` — необязательно, чтобы обновлять токен
- `YANDEX_TELEMOST_CLIENT_ID` / `YANDEX_TELEMOST_CLIENT_SECRET` или `TELEMOST_CLIENT_ID` / `TELEMOST_CLIENT_SECRET` — нужны для обновления токена
- `TELEMOST_BACKUP_ENABLED` — по умолчанию включено; `false` скрывает кнопку

Кнопка и карточка появляются только если задан access-токен или refresh-токен.

## Как получить токен

1. Войдите в Яндекс как сервисный аккаунт (`itflux.academy@yandex.com`), не под личным аккаунтом.
2. Откройте [oauth.yandex.ru](https://oauth.yandex.ru/) и создайте приложение (платформа «Веб-сервисы» или standalone).
3. В правах приложения включите:
   - `telemost-api:conferences.create`
   - `telemost-api:conferences.read`
   - `telemost-api:conferences.update`
4. Callback URL: `https://oauth.yandex.ru/verification_code`.
5. Сохраните ClientID и Client secret.
6. Откройте ссылку авторизации, оставаясь в аккаунте сервиса:

   `https://oauth.yandex.ru/authorize?response_type=token&client_id=<ClientID>&scope=telemost-api:conferences.create,telemost-api:conferences.read,telemost-api:conferences.update`

   Для кода авторизации используйте `response_type=code` — его можно обменять на access и refresh token.
7. Скопируйте access_token (и refresh_token, если получили) в переменные окружения сервера. Токен можно в любой момент заменить на новый от того же или другого сервисного аккаунта.
8. Если API ответит, что создание встреч доступно только для Яндекс 360 для бизнеса, подключите тот же сервисный аккаунт к организации 360 или оформите подходящий тариф.

Не публикуйте токен в чат, репозиторий и логи.
