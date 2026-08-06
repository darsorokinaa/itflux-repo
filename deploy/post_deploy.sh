#!/bin/bash
# Запускать после копирования файлов проекта на сервер
# bash /opt/itfluxacademy/itflux/deploy/post_deploy.sh
set -e

APP_DIR="/opt/itfluxacademy/itflux"
DB_NAME="itflux"
DB_USER="itflux_user"
DOMAIN="ВАШ_ДОМЕН.ru"

echo "=== Создание папки для логов ==="
mkdir -p /var/log/itflux
chown itflux:itflux /var/log/itflux

echo "=== Права на папку приложения ==="
chown -R itflux:itflux $APP_DIR

echo "=== Установка Python зависимостей ==="
sudo -u itflux $APP_DIR/venv/bin/pip install \
    django django-cors-headers django-ckeditor-5 django-ckeditor \
    weasyprint psycopg2-binary channels gunicorn whitenoise PyJWT

echo "=== Сборка фронтенда ==="
cd $APP_DIR/frontend
npm install
npm run build

echo "=== Миграции и статика ==="
cd $APP_DIR
source $APP_DIR/venv/bin/activate
python manage.py migrate --noinput
python manage.py collectstatic --noinput

echo "=== Загрузка данных в БД ==="
PGPASSWORD=$(grep PGPASSWORD $APP_DIR/deploy/gunicorn.service | cut -d= -f3) \
    psql -h localhost -U $DB_USER -d $DB_NAME -f $APP_DIR/load_data.sql

echo "=== Суперпользователь (только через env, без паролей по умолчанию) ==="
if [ -n "${DJANGO_SUPERUSER_USERNAME:-}" ] && [ -n "${DJANGO_SUPERUSER_PASSWORD:-}" ]; then
  python -c "
import os, django
os.environ.setdefault('DJANGO_SETTINGS_MODULE', 'Generator.settings')
django.setup()
from django.contrib.auth.models import User
username = os.environ['DJANGO_SUPERUSER_USERNAME']
password = os.environ['DJANGO_SUPERUSER_PASSWORD']
email = os.environ.get('DJANGO_SUPERUSER_EMAIL', '')
if User.objects.filter(username=username).exists():
    print('Суперпользователь уже существует:', username)
else:
    User.objects.create_superuser(username, email, password)
    print('Суперпользователь создан:', username)
    print('Далее: python manage.py setup_admin_totp', username)
"
else
  echo "Пропуск: задайте DJANGO_SUPERUSER_USERNAME и DJANGO_SUPERUSER_PASSWORD, если нужен новый admin."
  echo "Не создаём admin/admin автоматически."
fi

echo "=== Установка конфига Nginx ==="
cp $APP_DIR/deploy/nginx.conf /etc/nginx/sites-available/itflux
ln -sf /etc/nginx/sites-available/itflux /etc/nginx/sites-enabled/itflux
nginx -t && systemctl reload nginx

echo "=== Установка systemd сервиса ==="
cp $APP_DIR/deploy/gunicorn.service /etc/systemd/system/itflux.service
systemctl daemon-reload
systemctl enable itflux
systemctl restart itflux

echo "=== Установка cron (напоминания, ДЗ, подписка) ==="
mkdir -p /var/log/itflux
chmod +x $APP_DIR/deploy/run_management.sh $APP_DIR/deploy/install_cron.sh
APP_DIR=$APP_DIR bash $APP_DIR/deploy/install_cron.sh || echo "WARN: cron не установился"

echo ""
echo "=== Готово! ==="
echo "Проверьте сайт: http://$DOMAIN"
echo "Для SSL: certbot --nginx -d $DOMAIN -d www.$DOMAIN"
echo "Admin: создайте суперпользователя вручную и включите TOTP:"
echo "  python manage.py createsuperuser"
echo "  python manage.py setup_admin_totp <username>"
echo "Сервис должен работать от User=itflux (см. deploy/gunicorn.service)."
echo "Cron: crontab -l | grep itflux-cron"
