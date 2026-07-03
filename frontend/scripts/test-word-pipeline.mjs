import { JSDOM } from 'jsdom';
import { execFileSync } from 'child_process';
import { writeFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const dom = new JSDOM('<!DOCTYPE html><html><body></body></html>');
global.DOMParser = dom.window.DOMParser;
global.document = dom.window.document;

const pyScript = join(__dirname, '../../tmp_ids.py');
writeFileSync(pyScript, `import psycopg2, json
conn=psycopg2.connect(dbname='itflux',user='postgres',password='postgres',host='localhost')
cur=conn.cursor()
cur.execute('SELECT id, task_template FROM "Generator_task" WHERE id IN (7867,7868,7869,7870,7871)')
print(json.dumps({str(r[0]): r[1] for r in cur.fetchall()}))
`);

const tasks = JSON.parse(execFileSync('python3', [pyScript], { cwd: join(__dirname, '../..'), encoding: 'utf8' }));

// Inline minimal pipeline from MathContent
function decodeHtmlEntityLayersIfStoredEscaped(raw) {
  if (typeof raw !== "string" || !raw) return raw;
  let cur = raw;
  for (let i = 0; i < 8; i++) {
    const t = cur.trimStart();
    if (!t.startsWith("&lt;") && !t.startsWith("&amp;lt;")) break;
    const textarea = document.createElement("textarea");
    textarea.innerHTML = cur;
    const next = textarea.value;
    if (next === cur) break;
    cur = next;
  }
  return cur;
}

function repairMalformedInlineMathDelimiters(raw) {
  return raw;
}

function normalizeEscapedTaskSymbols(raw) {
  if (typeof raw !== "string" || !raw) return raw;
  return repairMalformedInlineMathDelimiters(raw)
    .replace(/\\([#+^])/g, "$1")
    .replace(/&#92;\s*&(?:amp;|#38;)/gi, "&")
    .replace(/\\+&/g, "&")
    .replace(/\\\\end\{/g, "\\\\ \\end{")
    .replace(/(?<!\\|\/)\\(?=\s|<|$)/g, "");
}

const { formatFipiUnicodeMathHtml } = await import('../src/utils/formatFipiUnicodeMathHtml.js');
const { formatOgeMathChoiceTaskHtml } = await import('../src/utils/formatOgeMathChoiceTaskHtml.js');

function preparePlainBankTaskHtml(raw) {
  const decoded = decodeHtmlEntityLayersIfStoredEscaped(raw);
  let s = decoded;
  s = normalizeEscapedTaskSymbols(s);
  s = formatFipiUnicodeMathHtml(s);
  s = formatOgeMathChoiceTaskHtml(s);
  return s;
}

for (const id of ['7867','7868','7869','7870','7871']) {
  const out = preparePlainBankTaskHtml(tasks[id]);
  console.log('===', id, '===');
  console.log(out);
}
