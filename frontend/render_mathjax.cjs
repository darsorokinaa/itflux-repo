// render_mathjax.js — supports both single formula and batch array mode
const { mathjax } = require('mathjax-full/js/mathjax.js');
const { TeX } = require('mathjax-full/js/input/tex.js');
const { SVG } = require('mathjax-full/js/output/svg.js');
const { liteAdaptor } = require('mathjax-full/js/adaptors/liteAdaptor.js');
const { RegisterHTMLHandler } = require('mathjax-full/js/handlers/html.js');
const { AllPackages } = require('mathjax-full/js/input/tex/AllPackages.js');

const adaptor = liteAdaptor();
RegisterHTMLHandler(adaptor);

const tex = new TeX({ packages: AllPackages });
// scale ~1: читаемость; слишком мало — «ломается» выравнивание с текстом Times
const svg = new SVG({ fontCache: 'none', scale: 1 });
const doc = mathjax.document('', { InputJax: tex, OutputJax: svg });

let input = '';
process.stdin.on('data', (c) => input += c);
process.stdin.on('end', () => {
  const raw = input.trim();

  try {
    const parsed = JSON.parse(raw);

    if (Array.isArray(parsed)) {
      // Batch mode: [{latex, display}, ...] → JSON array of SVG strings
      const results = parsed.map(({ latex, display }) => {
        try {
          const node = doc.convert(latex || '', { display: Boolean(display) });
          return adaptor.outerHTML(node);
        } catch (e) {
          return '';
        }
      });
      process.stdout.write(JSON.stringify(results));
    } else {
      // Single mode: {latex, display} → SVG string (backward compatible)
      const latex = parsed.latex || '';
      const display = Boolean(parsed.display);
      const node = doc.convert(latex, { display });
      process.stdout.write(adaptor.outerHTML(node));
    }
  } catch (err) {
    // Backwards-compatible: treat raw stdin as latex (display mode)
    const node = doc.convert(raw, { display: true });
    process.stdout.write(adaptor.outerHTML(node));
  }
});
