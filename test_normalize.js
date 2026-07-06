const { JSDOM } = require('jsdom');
const dom = new JSDOM();
const document = dom.window.document;

const html = `<div><figure class="table"><div class="task-html-block"><figure class="table"><table><tbody><tr><td><strong>1)</strong>&nbsp;</td><td><p>Напишите сочинение-рассуждение</p></td></tr></tbody></table></figure></div></figure></div>`;

const tempDiv = document.createElement("div");
tempDiv.innerHTML = html;

tempDiv.querySelectorAll("figure").forEach((fig) => {
  const table = fig.querySelector(":scope > table");
  if (table) fig.replaceWith(table);
});

console.log(tempDiv.innerHTML);
