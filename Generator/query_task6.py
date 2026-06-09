import os
import sys
import django

os.environ.setdefault('DJANGO_SETTINGS_MODULE', 'Generator.settings')
django.setup()

from Generator.models import Task

t = Task.objects.get(id=13715)
print("File:", t.files)
