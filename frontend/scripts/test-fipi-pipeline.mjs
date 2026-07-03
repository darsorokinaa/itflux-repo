import { JSDOM } from 'jsdom';
import { execFileSync } from 'child_process';
import { writeFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const dom = new JSDOM('<!DOCTYPE html><html><body></body></html>');
global.DOMParser = dom.window.DOMParser;
global.document = dom.window.document;

const pyScript = join(__dirname, '../../tmp_pipe.py');
writeFileSync(pyScript, `import psycopg2, sys
sys.path.insert(0, '.')
from fipi_bare_innerimg_repair import repair_bare_fipi_innerimg_html
conn = psycopg2.connect(dbname='itflux', user='postgres', password='postgres', host='localhost')
cur = conn.cursor()
cur.execute('SELECT id, task_template FROM "Generator_task" WHERE id=7747')
id_, html = cur.fetchone()
print(repair_bare_fipi_innerimg_html(html, task_db_id=id_, task_list_id=33, subtopic_id=122))
`);

const html = execFileSync('python3', [pyScript], { cwd: join(__dirname, '../..'), encoding: 'utf8' });

const { formatOgeMathChoiceTaskHtml } = await import('../src/utils/formatOgeMathChoiceTaskHtml.js');
const { formatFipiUnicodeMathHtml } = await import('../src/utils/formatFipiUnicodeMathHtml.js');

const choice = formatOgeMathChoiceTaskHtml(formatFipiUnicodeMathHtml(html));
console.log(choice.match(/oge-math-choice-question[\s\S]{0,400}/)?.[0] || choice.slice(0, 500));
