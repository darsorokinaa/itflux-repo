#!/bin/bash
# Запускать после копирования файлов проекта на сервер
# bash /opt/generator_test/deploy/post_deploy.sh
set -e

APP_DIR="/opt/generator_test"
DB_NAME="generatordb_test"
DB_USER="generatoruser_test"
DOMAIN="ВАШ_ДОМЕН.ru"

echo "=== Создание папки для логов ==="
mkdir -p /var/log/generator_test
chown generator_test:generator_test /var/log/generator_test

echo "=== Права на папку приложения ==="
chown -R generator_test:generator_test $APP_DIR

echo "=== Установка Python зависимостей ==="
sudo -u generator_test $APP_DIR/venv/bin/pip install \
    django django-cors-headers django-ckeditor-5 django-ckeditor \
    weasyprint psycopg2-binary channels gunicorn whitenoise PyJWT

echo "=== Сборка фронтенда ==="
cd $APP_DIR/frontend
npm install
npm run build

echo "=== Миграции и статика ==="
cd $APP_DIR/Generator
source $APP_DIR/venv/bin/activate
python manage.py migrate --noinput
python manage.py collectstatic --noinput

echo "=== Загрузка данных в БД ==="
PGPASSWORD=$(grep PGPASSWORD $APP_DIR/deploy/gunicorn.service | cut -d= -f3) \
    psql -h localhost -U $DB_USER -d $DB_NAME -f $APP_DIR/load_data.sql

echo "=== Создание суперпользователя ==="
python -c "
import django, os
os.environ['DJANGO_SETTINGS_MODULE'] = 'Generator.settings'
django.setup()
from django.contrib.auth.models import User
if not User.objects.filter(username='admin').exists():
    User.objects.create_superuser('admin', '', 'admin')
    print('Суперпользователь создан (логин: admin, пароль: admin)')
    print('ВАЖНО: смените пароль через /admin/ !')
else:
    print('Суперпользователь уже существует')
"

echo "=== Установка конфига Nginx ==="
cp $APP_DIR/deploy/nginx.conf /etc/nginx/sites-available/generator_test
ln -sf /etc/nginx/sites-available/generator_test /etc/nginx/sites-enabled/generator_test
nginx -t && systemctl reload nginx

echo "=== Установка systemd сервиса ==="
cp $APP_DIR/deploy/gunicorn.service /etc/systemd/system/generator_test.service
systemctl daemon-reload
systemctl enable generator_test
systemctl restart generator_test

echo ""
echo "=== Готово! ==="
echo "Проверьте сайт: http://$DOMAIN"
echo "Для SSL: certbot --nginx -d $DOMAIN -d www.$DOMAIN"
echo "После SSL не забудьте поменять пароль admin в /admin/"
