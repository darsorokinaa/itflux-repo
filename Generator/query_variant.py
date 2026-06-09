import os
import sys
import django

os.environ.setdefault('DJANGO_SETTINGS_MODULE', 'Generator.settings')
django.setup()

from Generator.models import Task, VariantContent

t = Task.objects.get(id=13715)
vcs = VariantContent.objects.filter(task=t)
print("Variants containing this task:")
for vc in vcs:
    print(f"Variant ID: {vc.variant_id}")
    print(f"Task number in variant: {vc.order}")
