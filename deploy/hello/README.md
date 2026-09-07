# hello.itflux-academy.ru — осенняя промо-страница

Статический HTML. Django не обслуживает этот хост.

DNS: **A** `hello` → `5.42.106.185` (как у `itflux-academy.ru` и `lesson.itflux-academy.ru`).

## 1. DNS (Timeweb)

Проверка:

```bash
dig +short hello.itflux-academy.ru @ns1.timeweb.ru
```

Нужен ответ `5.42.106.185`.

## 2. Файлы на сервер

С ноутбука:

```bash
scp -r ~/Downloads/itflux-september-promo \
  USER@5.42.106.185:/tmp/itflux-september-promo
```

На сервере:

```bash
sudo mkdir -p /var/www/hello.itflux-academy.ru
sudo rsync -a --delete /tmp/itflux-september-promo/ /var/www/hello.itflux-academy.ru/
sudo mv /var/www/hello.itflux-academy.ru/itflux_september_promo.html \
        /var/www/hello.itflux-academy.ru/index.html
sudo chown -R www-data:www-data /var/www/hello.itflux-academy.ru
```

## 3. nginx + SSL

```bash
sudo cp /opt/itfluxacademy/itflux/deploy/hello/nginx-hello.conf \
        /etc/nginx/sites-available/hello.itflux-academy.ru
sudo ln -sf /etc/nginx/sites-available/hello.itflux-academy.ru \
            /etc/nginx/sites-enabled/hello.itflux-academy.ru
sudo nginx -t && sudo systemctl reload nginx

sudo certbot --nginx -d hello.itflux-academy.ru
sudo nginx -t && sudo systemctl reload nginx
```

Путь к репозиторию на сервере может быть `/opt/itflux/…` — подставьте свой.

## 4. CORS (цифры уроков/заданий)

В прод-`.env` платформы добавьте origin (через запятую к уже существующим):

```text
CORS_ALLOWED_ORIGINS=https://itflux-academy.ru,https://hello.itflux-academy.ru
```

Перезапустите сервис платформы. Кнопки оплаты от CORS не зависят.

`DJANGO_ALLOWED_HOSTS` для `hello` не нужен.

## 5. Проверка

Откройте https://hello.itflux-academy.ru
