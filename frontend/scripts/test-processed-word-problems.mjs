import { JSDOM } from 'jsdom';
import { execFileSync } from 'child_process';
import { writeFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const dom = new JSDOM('<!DOCTYPE html><html><body></body></html>');
global.DOMParser = dom.window.DOMParser;
global.document = dom.window.document;

const py = join(__dirname, '../../tmp_proc.py');
writeFileSync(py, `import sys, os, json
sys.path.insert(0,'Generator')
os.environ.setdefault('DJANGO_SETTINGS_MODULE','Generator.settings')
import django; django.setup()
from Generator.models import Task
from Generator.latex_utils import process_latex
out={}
for tid in [7867,7870,7871]:
    t=Task.objects.get(id=tid)
    out[str(tid)]=process_latex(str(t.task_template or ''), for_browser=True)
print(json.dumps(out))
`);

const tasks = JSON.parse(execFileSync('python3', [py], { cwd: join(__dirname, '../..'), encoding: 'utf8' }));
const { formatFipiUnicodeMathHtml } = await import('../src/utils/formatFipiUnicodeMathHtml.js');
for (const [id, html] of Object.entries(tasks)) {
  const out = formatFipiUnicodeMathHtml(html);
  console.log(id, out.includes('$') ? 'BROKEN' : 'OK');
  console.log(out.slice(0, 150));
}
