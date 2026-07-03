import { JSDOM } from 'jsdom';
import { execFileSync } from 'child_process';
import { writeFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const dom = new JSDOM('<!DOCTYPE html><html><body></body></html>');
global.DOMParser = dom.window.DOMParser;
global.document = dom.window.document;

const pyScript = join(__dirname, '../../tmp_batch_choice.py');
writeFileSync(pyScript, `import psycopg2, json, sys
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
`);

const out = execFileSync('python3', [pyScript], {
  cwd: join(__dirname, '../..'),
  encoding: 'utf8',
});

const rows = JSON.parse(out.trim());
const { formatOgeMathChoiceTaskHtml } = await import('../src/utils/formatOgeMathChoiceTaskHtml.js');

let ok = 0, fail = 0;
for (const { id, html } of rows) {
  const result = formatOgeMathChoiceTaskHtml(html);
  const formatted = result.includes('oge-math-choice-task');
  if (formatted) ok++; else fail++;
  console.log(id, formatted ? 'OK' : 'FAIL');
}
console.log(`\n${ok} ok, ${fail} fail of ${rows.length}`);
