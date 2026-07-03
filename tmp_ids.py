import psycopg2, json
conn=psycopg2.connect(dbname='itflux',user='postgres',password='postgres',host='localhost')
cur=conn.cursor()
cur.execute('SELECT id, task_template FROM "Generator_task" WHERE id IN (7867,7868,7869,7870,7871)')
print(json.dumps({str(r[0]): r[1] for r in cur.fetchall()}))
