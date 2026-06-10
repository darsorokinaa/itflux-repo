const { JSDOM } = require('jsdom');
const dom = new JSDOM();

function process(html) {
  const doc = dom.window.document.createElement('div');
  doc.innerHTML = html;
  
  // This is what my formatEgeInf2TruthTableHtml does to the text nodes!
  function normalizeCellText(el) {
    return (el?.textContent || "")
      .replace(/\u00a0/g, " ")
      .replace(/\s+/g, " ")
      .trim();
  }
  
  return doc.innerHTML;
}

console.log(process('<p>(x /\\ y) \\/ z</p>'));
