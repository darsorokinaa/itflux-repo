const jsdom = require('jsdom');
const { JSDOM } = jsdom;
const fs = require('fs');

const { window } = new JSDOM('<!DOCTYPE html><html><body></body></html>');
global.DOMParser = window.DOMParser;
global.document = window.document;

const code = fs.readFileSync('../frontend/src/utils/formatEgeInf1TaskHtml.js', 'utf8');
const transformedCode = code.replace(/export function/g, 'function').replace(/export const/g, 'const');

eval(transformedCode);

const html = fs.readFileSync('output_html.txt', 'utf8');

const result = formatEgeInf1RoadGraphHtml(html);
console.log("Images found: ", (result.match(/<img/g) || []).length);
// console.log(result);
