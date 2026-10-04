# tldraw sync

Отдельный Node-сервис протокола `@tldraw/sync` 5.5.1 (`TLSocketRoom` + `SQLiteSyncStorage`).
Старый Django WebSocket `/ws/interactive-boards/<uuid>/` не используется.

Слушает `127.0.0.1:5858`. Снаружи его открывает nginx: `wss://<текущий host>/ws/tldraw/<uuid>/`.

## Локально

```bash
cd services/tldraw-sync
npm install
npm start
```

Без `TLDRAW_SYNC_SECRET` и без `NODE_ENV=production` сервис берёт тот же локальный допуск, что Django в `DEBUG`. Vite проксирует `/ws/tldraw` на порт 5858.

Проверка протокола, двух комнат и файла после перезапуска:

```bash
npm run verify
```

## Сервер

Один раз:

```bash
cd /opt/itfluxacademy/itflux/services/tldraw-sync
npm install
sudo mkdir -p /var/lib/itflux/tldraw-sync
sudo chown itflux:itflux /var/lib/itflux/tldraw-sync
```

В `/etc/itflux/itflux.env` задайте один и тот же `TLDRAW_SYNC_SECRET` для Django и этого сервиса.

```bash
sudo cp deploy/tldraw-sync.service /etc/systemd/system/tldraw-sync.service
sudo systemctl daemon-reload
sudo systemctl enable --now tldraw-sync
sudo nginx -t && sudo systemctl reload nginx
```

`enable` поднимает сервис после перезагрузки машины. Перезапуск: `sudo systemctl restart tldraw-sync`.

Документ комнаты лежит в `/var/lib/itflux/tldraw-sync/<uuid>.sqlite` и остаётся после рестарта процесса.
