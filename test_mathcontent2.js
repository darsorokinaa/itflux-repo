require("@babel/register")({
  presets: ["@babel/preset-env", "@babel/preset-react"]
});
const fs = require('fs');
const { JSDOM } = require('jsdom');
const dom = new JSDOM();
global.document = dom.window.document;
global.DOMParser = dom.window.DOMParser;
global.window = dom.window;

// Mock MathJax
global.window.MathJax = { typesetPromise: () => Promise.resolve() };

const { prepareBankTaskDisplayHtml } = require('./frontend/src/components/MathContent.jsx');
const html = fs.readFileSync("raw.html", "utf-8");
try {
  const result = prepareBankTaskDisplayHtml(html, { ogeMathChoiceEnhance: false });
  fs.writeFileSync("frontend_out.html", result);
  console.log("Success");
} catch (e) {
  console.error(e);
}
