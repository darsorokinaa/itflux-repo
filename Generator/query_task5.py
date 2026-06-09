import os
import sys
import django

os.environ.setdefault('DJANGO_SETTINGS_MODULE', 'Generator.settings')
django.setup()

from Generator.models import Task

tasks = Task.objects.filter(id=13715)
t = tasks[0]
print("--- ANSWER ---")
print(t.answer)
print("--------------")
