// r131: проверка формул разбора. stdin: [{latex, display}] -> stdout: [{latex, error}]
const { mathjax } = require("mathjax-full/js/mathjax.js");
const { TeX } = require("mathjax-full/js/input/tex.js");
const { SVG } = require("mathjax-full/js/output/svg.js");
const { liteAdaptor } = require("mathjax-full/js/adaptors/liteAdaptor.js");
const { RegisterHTMLHandler } = require("mathjax-full/js/handlers/html.js");
const { AllPackages } = require("mathjax-full/js/input/tex/AllPackages.js");

const adaptor = liteAdaptor();
RegisterHTMLHandler(adaptor);
const tex = new TeX({
  packages: AllPackages,
  formatError: (_jax, err) => { throw err; },
});
const doc = mathjax.document("", { InputJax: tex, OutputJax: new SVG({ fontCache: "none" }) });
let input = "";
process.stdin.on("data", (c) => (input += c));
process.stdin.on("end", () => {
  const items = JSON.parse(input || "[]");
  const out = items.map(({ latex, display }) => {
    try {
      const node = doc.convert(latex || "", { display: Boolean(display) });
      const html = adaptor.outerHTML(node);
      if (/data-mjx-error|merror/.test(html)) return { latex, error: "merror" };
      return { latex, error: null };
    } catch (e) {
      return { latex, error: String((e && e.message) || e) };
    }
  });
  process.stdout.write(JSON.stringify(out));
});
