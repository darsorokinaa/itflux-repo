# Jitsi на том же сервере, что и платформа

Домен: **`lesson.itflux-academy.ru`** → IP `5.42.106.185` (как у `itflux-academy.ru`).

Схема:

```text
Браузер → nginx :443 (lesson.itflux-academy.ru, SSL)
              ↓
         127.0.0.1:8000  (Docker Jitsi web)
              +
         UDP 10000       (JVB, напрямую с интернета)
```

Платформа (Django) остаётся на своём `server_name`. Jitsi — отдельный `server` в nginx.

---

## На сервере (SSH)

### 1. DNS

В Timeweb у `lesson.itflux-academy.ru` должна быть A → `5.42.106.185`.  
Проверка: `dig +short lesson.itflux-academy.ru @ns1.timeweb.ru`

### 2. Docker

```bash
sudo apt update
sudo apt install -y docker.io docker-compose-v2 git
sudo usermod -aG docker "$USER"
# перелогиньтесь в SSH
```

### 3. Клонировать и настроить Jitsi

```bash
sudo mkdir -p /opt/jitsi
sudo chown "$USER":"$USER" /opt/jitsi
cd /opt/jitsi
git clone https://github.com/jitsi/docker-jitsi-meet.git
cd docker-jitsi-meet
cp env.example .env
./gen-passwords.sh
```

Допишите / замените в `.env` (шаблон: [`.env.same-server.example`](.env.same-server.example)):

```bash
SECRET=$(openssl rand -hex 32)
echo "Сохраните секрет для Django: $SECRET"

# вручную отредактируйте .env или:
cat >> .env << EOF

PUBLIC_URL=https://lesson.itflux-academy.ru
ENABLE_LETSENCRYPT=0
DISABLE_HTTPS=1
ENABLE_HTTP_REDIRECT=0
HTTP_PORT=8000
HTTPS_PORT=8443
TZ=Europe/Moscow
DOCKER_HOST_ADDRESS=5.42.106.185
JVB_ADVERTISE_IPS=5.42.106.185

ENABLE_AUTH=1
ENABLE_GUESTS=1
AUTH_TYPE=jwt
JWT_APP_ID=itflux
JWT_APP_SECRET=${SECRET}
JWT_ACCEPTED_ISSUERS=itflux
JWT_ACCEPTED_AUDIENCES=jitsi
EOF
```

Важно: **не публикуйте** порты 80/443 контейнера наружу — они уже у nginx платформы.  
В `docker-compose.yml` web обычно мапит `${HTTP_PORT}:80` → будет `8000:80` на хосте — ок.

### 4. Firewall

```bash
sudo ufw allow 80/tcp
sudo ufw allow 443/tcp
sudo ufw allow 10000/udp
sudo ufw status
```

### 5. Запуск контейнеров

```bash
mkdir -p ~/.jitsi-meet-cfg
cd /opt/jitsi/docker-jitsi-meet
docker compose up -d
docker compose ps
curl -sI http://127.0.0.1:8000/ | head -5
```

### 6. SSL + nginx для поддомена

```bash
# сертификат (nginx уже слушает 80)
sudo certbot certonly --nginx -d lesson.itflux-academy.ru

# конфиг из репозитория платформы
sudo cp /opt/itflux/deploy/jitsi/nginx-lesson.conf /etc/nginx/sites-available/lesson.itflux-academy.ru
sudo ln -sf /etc/nginx/sites-available/lesson.itflux-academy.ru /etc/nginx/sites-enabled/

# если в nginx.conf нет map для WebSocket — добавьте в http {}:
# map $http_upgrade $connection_upgrade { default upgrade; '' close; }

sudo nginx -t && sudo systemctl reload nginx
```

Откройте в браузере: `https://lesson.itflux-academy.ru` — должна быть страница Jitsi (не редирект на академию).

Если раньше был редирект `lesson` → `itflux-academy.ru`, уберите тот `server`/`return` из старого nginx.

### 7. Django / gunicorn / CSP платформы

В env платформы:

```env
JITSI_DOMAIN=lesson.itflux-academy.ru
JITSI_AUTH_MODE=jwt
JITSI_APP_ID=itflux
JITSI_APP_SECRET=<тот же JWT_APP_SECRET>
JITSI_SUB=lesson.itflux-academy.ru
JITSI_AUD=jitsi
JITSI_EMBED_EXTRA_HOSTS=lesson.itflux-academy.ru
```

В nginx платформы для `/cabinet/meetings/` замените `meet.jit.si` на `lesson.itflux-academy.ru` (см. `deploy/nginx.conf`).

```bash
sudo systemctl daemon-reload
sudo systemctl restart gunicorn   # + daphne при необходимости
sudo nginx -t && sudo systemctl reload nginx
```

### 8. Проверка из кабинета

1. Учитель → онлайн-урок → «Начать урок».
2. Network → `join-config`: `domain=lesson.itflux-academy.ru`, `jwt` не пустой.
3. Роль организатора сразу, без «Я организатор».

---

## Если что-то сломалось

| Симптом | Что проверить |
|---------|----------------|
| **Bad Request (400)** на `lesson...` | Запрос попал в **Django**, а не в Jitsi. В `ALLOWED_HOSTS` нет `lesson` — так и должно быть. Нужен отдельный nginx `server` → `127.0.0.1:8000` (Jitsi), см. `nginx-lesson.conf` |
| **Небезопасное соединение** / предупреждение SSL | Сертификат сейчас на `itflux-academy.ru`, не на `lesson`. Выпустите: `sudo certbot certonly --nginx -d lesson.itflux-academy.ru` |
| Порт 8000 занят | `ss -lntp \| grep 8000` — смените `HTTP_PORT` в `.env` Jitsi и в `nginx-lesson.conf` |
| Редирект на академию | старый nginx `server_name lesson...` с `return 301` |
| Нет звука/видео | UDP **10000** в firewall + `JVB_ADVERTISE_IPS` = публичный IP |
| JWT не пускает | один и тот же `JWT_APP_SECRET` / `JITSI_APP_SECRET`; после смены `.env` иногда нужно `rm -rf ~/.jitsi-meet-cfg` и `docker compose up -d` заново |
| Google DNS NXDOMAIN | у Timeweb запись есть — подождите TTL или проверьте `@ns1.timeweb.ru` |

---

## Локально (ноут)

Пока Jitsi на сервере не поднят — `JITSI_DOMAIN=meet.jit.si`, `JITSI_AUTH_MODE=none`.  
После запуска — можно в локальный `Generator/.env` прописать `lesson.itflux-academy.ru` + jwt (тот же секрет).
