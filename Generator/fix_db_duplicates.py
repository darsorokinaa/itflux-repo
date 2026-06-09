import os
import sys
import django
import re
from bs4 import BeautifulSoup

os.environ.setdefault('DJANGO_SETTINGS_MODULE', 'Generator.settings')
django.setup()

from Generator.models import Task, TaskList

# Найти все задачи ЕГЭ Информатика 1
ege_inf_1_lists = TaskList.objects.filter(
    level__level__iexact='ege',
    subject__subject_short__iexact='inf',
    task_number=1
)

tasks = Task.objects.filter(task__in=ege_inf_1_lists)
print(f"Found {tasks.count()} tasks for EGE Inf 1")

updated_count = 0

for task in tasks:
    html = task.task_template
    if not html:
        continue
        
    soup = BeautifulSoup(html, 'html.parser')
    imgs = soup.find_all('img')
    
    # Ищем картинки графа (исключаем формулы)
    graph_imgs = []
    for img in imgs:
        src = img.get('src', '')
        if 'math' not in src and 'mjx' not in src:
            graph_imgs.append(img)
            
    # Если больше одной картинки
    if len(graph_imgs) > 1:
        # Удаляем все кроме первой
        for img in graph_imgs[1:]:
            # Пытаемся удалить также родительский тег <p> или <div> если в нем только эта картинка
            parent = img.parent
            if parent and parent.name in ['p', 'div', 'figure', 'td']:
                parent_imgs = parent.find_all('img')
                if len(parent_imgs) <= 1:
                    # Если в родителе больше нет других картинок, и нет значимого текста
                    text = parent.get_text(strip=True)
                    if not text:
                        parent.decompose()
                        continue
            img.decompose()
            
        new_html = str(soup)
        if new_html != task.task_template:
            task.task_template = new_html
            task.save(update_fields=['task_template'])
            updated_count += 1
            print(f"Updated task {task.id}")

print(f"Done. Updated {updated_count} tasks.")
