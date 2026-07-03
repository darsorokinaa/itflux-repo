import { JSDOM } from 'jsdom';
import { execFileSync } from 'child_process';
import { writeFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const dom = new JSDOM('<!DOCTYPE html><html><body></body></html>');
global.DOMParser = dom.window.DOMParser;
global.document = dom.window.document;
global.window = dom.window;

const pyScript = join(__dirname, '../../tmp_ids.py');
writeFileSync(pyScript, `import psycopg2, json
conn=psycopg2.connect(dbname='itflux',user='postgres',password='postgres',host='localhost')
cur=conn.cursor()
cur.execute('SELECT id, task_template FROM "Generator_task" WHERE id IN (7867,7868,7869,7870,7871)')
print(json.dumps({str(r[0]): r[1] for r in cur.fetchall()}))
`);

const tasks = JSON.parse(execFileSync('python3', [pyScript], { cwd: join(__dirname, '../..'), encoding: 'utf8' }));

// Import pipeline pieces - replicate preparePlainBankTaskHtml
const { formatFipiUnicodeMathHtml } = await import('../src/utils/formatFipiUnicodeMathHtml.js');
const { formatOgeMathChoiceTaskHtml } = await import('../src/utils/formatOgeMathChoiceTaskHtml.js');

for (const id of ['7867','7868','7869','7870','7871']) {
  let s = tasks[id];
  const afterFipi = formatFipiUnicodeMathHtml(s);
  const changed = afterFipi !== s;
  console.log('---', id, 'fipi changed:', changed);
  if (changed) console.log(afterFipi);
  else console.log(s.slice(0, 200));
}
