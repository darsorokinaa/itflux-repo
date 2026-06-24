#!/usr/bin/env python3
"""Django's command-line utility for administrative tasks."""
import os
import sys

# Используем конфиг из Generator/ (как Generator/manage.py)
_PROJECT_ROOT = os.path.dirname(os.path.abspath(__file__))
_GENERATOR_DIR = os.path.join(_PROJECT_ROOT, "Generator")
for _path in (_PROJECT_ROOT, _GENERATOR_DIR):
    if _path not in sys.path:
        sys.path.insert(0, _path)


def main():
    """Run administrative tasks."""
    os.environ.setdefault('DJANGO_SETTINGS_MODULE', 'Generator.settings')
    try:
        from django.core.management import execute_from_command_line
    except ImportError as exc:
        raise ImportError(
            "Couldn't import Django. Are you sure it's installed and "
            "available on your PYTHONPATH environment variable? Did you "
            "forget to activate a virtual environment?"
        ) from exc
    execute_from_command_line(sys.argv)


if __name__ == '__main__':
    main()
