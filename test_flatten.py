import sys
import os
import django
sys.path.append('/Users/darsorokina/Projects/itflux/Generator')
os.environ.setdefault('DJANGO_SETTINGS_MODULE', 'Generator.settings')
django.setup()

from Generator.models import Task
from fipi_html_normalize import flatten_fipi_layout_markup

t = Task.objects.get(id=21651)
print(flatten_fipi_layout_markup(t.task_template))
