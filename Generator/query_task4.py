import os
import sys
import django

os.environ.setdefault('DJANGO_SETTINGS_MODULE', 'Generator.settings')
django.setup()

from Generator.models import Task
from Generator.latex_utils import process_latex

t = Task.objects.get(id=13715)
html = process_latex(str(t.task_template or ''), for_browser=True)

with open('output_html.txt', 'w') as f:
    f.write(html)

print("Saved output")
