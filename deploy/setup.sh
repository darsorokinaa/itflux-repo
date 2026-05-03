#!/bin/bash
# Скрипт первоначальной настройки VPS для проекта Генератор (тестовый сервер)
# Запускать от root: bash setup.sh
set -e

APP_DIR="/opt/generator_test"
APP_USER="generator_test"
DB_NAME="generatordb_test"
DB_USER="generatoruser_test"
DB_PASS="ЗАМЕНИТЕ_НА_НАДЁЖНЫЙ_ПАРОЛЬ"
DOMAIN="ВАШ_ДОМЕН.ru"

echo "=== 1. Обновление системы ==="
apt update && apt upgrade -y

echo "=== 2. Установка системных зависимостей ==="
apt install -y \
    python3 python3-pip python3-venv \
    postgresql postgresql-contrib \
    nginx \
    nodejs npm \
    git curl \
    libpangocairo-1.0-0 libpango-1.0-0 libgdk-pixbuf2.0-0 \
    libffi-dev shared-mime-info \
    fonts-liberation fonts-dejavu \
    certbot python3-certbot-nginx

echo "=== 3. Создание пользователя приложения ==="
id -u $APP_USER &>/dev/null || useradd -m -s /bin/bash $APP_USER

echo "=== 4. Настройка PostgreSQL ==="
systemctl enable postgresql && systemctl start postgresql
su - postgres -c "psql -c \"CREATE USER $DB_USER WITH PASSWORD '$DB_PASS';\"" 2>/dev/null || true
su - postgres -c "psql -c \"CREATE DATABASE $DB_NAME OWNER $DB_USER;\"" 2>/dev/null || true
su - postgres -c "psql -c \"GRANT ALL PRIVILEGES ON DATABASE $DB_NAME TO $DB_USER;\""

echo "=== 5. Создание директории приложения ==="
mkdir -p $APP_DIR
chown $APP_USER:$APP_USER $APP_DIR

echo "=== 6. Создание Python venv ==="
sudo -u $APP_USER python3 -m venv $APP_DIR/venv
sudo -u $APP_USER $APP_DIR/venv/bin/pip install --upgrade pip
sudo -u $APP_USER $APP_DIR/venv/bin/pip install \
    django django-cors-headers django-ckeditor-5 django-ckeditor \
    weasyprint psycopg2-binary channels gunicorn whitenoise

echo "=== 7. Копирование файлов проекта ==="
echo "Скопируйте файлы проекта в $APP_DIR"
echo "Например: rsync -av /путь/к/проекту/ $APP_USER@$DOMAIN:$APP_DIR/"
echo "Или загрузите через SFTP в $APP_DIR"
echo ""
echo "После копирования файлов выполните: bash $APP_DIR/deploy/post_deploy.sh"
