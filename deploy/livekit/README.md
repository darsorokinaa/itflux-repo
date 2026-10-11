# LiveKit на отдельном VPS

Секретов в этом каталоге нет. Порядок включения и откат: `docs/LIVEKIT_FAILOVER.md`.

Не запускать compose на сервере Django (`5.42.106.185`, unit `itflux.service`). `install.sh` откажется, если увидит этот хост.

Образ зафиксирован: `livekit/livekit-server:v1.13.9`. На 11 октября 2026 это последний релиз линейки. Автоматически не обновлять: 1.13.0 убрал TURN без TTL, 1.13.9 чинит старт egress после поломки в 1.13.8. Egress эта платформа не включает.

## Что сделать на новом VPS

Отдельная машина, не урок и не Jitsi. Юрисдикцию и цену смотреть в панели Timeweb до заказа. Ориентир под сценарии из задания: 4 vCPU, 8 ГБ RAM, канал от 100 Мбит/с. Это оценка, не замер.

```sh
sudo apt-get update
sudo apt-get install -y docker.io docker-compose-v2 nginx certbot
sudo mkdir -p /etc/livekit
sudo cp deploy/livekit/livekit.env.example /etc/livekit/livekit.env
sudo chmod 600 /etc/livekit/livekit.env
sudo editor /etc/livekit/livekit.env
```

В файле: публичный IPv4 этого VPS, постоянный домен, `LIVEKIT_KEYS` в виде `ключ: секрет` (секрет от 32 символов). Файл не печатать в чат и не коммитить.

Сертификат домена и отдельные файлы для встроенного TURN:

```sh
sudo certbot certonly --nginx -d video.example.ru
sudo cp /etc/letsencrypt/live/video.example.ru/fullchain.pem /etc/livekit/turn.crt
sudo cp /etc/letsencrypt/live/video.example.ru/privkey.pem /etc/livekit/turn.key
sudo chmod 644 /etc/livekit/turn.crt
sudo chmod 600 /etc/livekit/turn.key
```

Проверка без запуска контейнера, затем запуск:

```sh
sudo sh deploy/livekit/install.sh
sudo sh deploy/livekit/install.sh --apply
sh deploy/livekit/healthcheck.sh
```

Nginx: взять `nginx-video.conf.example`, подставить домен, не логировать query string. Порты наружу: 443/tcp, 80/tcp, 7881/tcp, UDP 50000–50200, TURN 3478/udp и 5349/tcp. Закрыть 7880/tcp и 6789/tcp.

После старта `ss -ulpn` должен показать UDP 50000 на `0.0.0.0` или `*`. Если там только `127.0.0.1`, внешнее видео не заработает, хотя WSS откроется.

В Django, не включая флаг и не перезапуская production без согласования:

```
LIVEKIT_URL=wss://video.example.ru
LIVEKIT_HTTP_URL=https://video.example.ru
LIVEKIT_API_KEY=тот же ключ
LIVEKIT_API_SECRET=тот же секрет
VIDEO_FAILOVER_ENABLED=false
```

`ws://` сервер урока не примет.
