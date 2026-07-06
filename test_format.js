const fs = require('fs');
const { JSDOM } = require('jsdom');
const dom = new JSDOM();
global.document = dom.window.document;
global.DOMParser = dom.window.DOMParser;
global.window = dom.window;

const { formatOgeMathChoiceTaskHtml } = require('./frontend/src/utils/formatOgeMathChoiceTaskHtml.js');
const html = fs.readFileSync("raw.html", "utf-8");
const result = formatOgeMathChoiceTaskHtml(html);
fs.writeFileSync("formatted.html", result);
