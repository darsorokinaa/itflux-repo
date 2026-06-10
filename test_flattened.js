const { JSDOM } = require('jsdom');
const dom = new JSDOM();
global.document = dom.window.document;
global.DOMParser = dom.window.DOMParser;

const { formatEgeInf2TruthTableHtml } = require('./frontend/src/utils/formatEgeInf2TaskHtml.js');

const html = `...`; // wait, I don't need this, I can just debug inside
