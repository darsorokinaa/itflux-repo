#!/bin/bash
set -e

pip install django django-cors-headers django-ckeditor-5 django-ckeditor weasyprint psycopg2-binary channels gunicorn whitenoise

cd /home/runner/workspace/frontend
npm install
npm run build

cd /home/runner/workspace/Generator

echo "Running Django migrations..."
python manage.py migrate --noinput

python manage.py collectstatic --noinput

python -c "
import django, os
os.environ.setdefault('DJANGO_SETTINGS_MODULE', 'Generator.settings')
django.setup()
from django.contrib.auth.models import User
if not User.objects.filter(username='admin').exists():
    User.objects.create_superuser('admin', '', 'admin')
    print('Superuser created')
else:
    print('Superuser already exists')
"
