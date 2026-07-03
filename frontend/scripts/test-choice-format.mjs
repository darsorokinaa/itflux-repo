import { JSDOM } from 'jsdom';
import { execFileSync } from 'child_process';
import { writeFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const dom = new JSDOM('<!DOCTYPE html><html><body></body></html>');
global.DOMParser = dom.window.DOMParser;
global.document = dom.window.document;

const pyScript = join(__dirname, '../../tmp_test_choice.py');
writeFileSync(pyScript, `import psycopg2, sys
sys.path.insert(0, '.')
from fipi_bare_innerimg_repair import repair_bare_fipi_innerimg_html
conn = psycopg2.connect(dbname='itflux', user='postgres', password='postgres', host='localhost')
cur = conn.cursor()
cur.execute('SELECT id, task_template FROM "Generator_task" WHERE is_active=TRUE AND task_id=33 AND subtopic_id=122 ORDER BY id')
for id_, html in cur.fetchall():
    fixed = repair_bare_fipi_innerimg_html(html, task_db_id=id_, task_list_id=33, subtopic_id=122)
    if 'Укажите решение неравенства' in fixed and 'xs3qvrsrc' in fixed:
        print(id_)
        print(fixed)
        break
`);

const out = execFileSync('python3', [pyScript], {
  cwd: join(__dirname, '../..'),
  encoding: 'utf8',
  env: { ...process.env, PYTHONPATH: join(__dirname, '../..') },
});

const lines = out.trim().split('\n');
const id = lines[0];
const html = lines.slice(1).join('\n');
console.log('task', id, 'len', html.length);

const { formatOgeMathChoiceTaskHtml } = await import('../src/utils/formatOgeMathChoiceTaskHtml.js');
const result = formatOgeMathChoiceTaskHtml(html);
console.log('has oge-math-choice-task:', result.includes('oge-math-choice-task'));
console.log('has table borders:', /<table[^>]*class="bank-task-table"/i.test(result));
console.log(result.slice(0, 1200));
