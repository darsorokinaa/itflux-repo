import psycopg2, json, sys
sys.path.insert(0, '.')
from fipi_bare_innerimg_repair import repair_bare_fipi_innerimg_html
conn = psycopg2.connect(dbname='itflux', user='postgres', password='postgres', host='localhost')
cur = conn.cursor()
cur.execute('SELECT id, task_template FROM "Generator_task" WHERE is_active=TRUE AND subtopic_id=122 ORDER BY id')
rows = []
for id_, html in cur.fetchall():
    fixed = repair_bare_fipi_innerimg_html(html, task_db_id=id_, task_list_id=33, subtopic_id=122)
    if '<b>1)</b>' in fixed and '<b>2)</b>' in fixed:
        rows.append({'id': id_, 'html': fixed})
print(json.dumps(rows[:15]))
