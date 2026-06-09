const jsdom = require('jsdom');
const { JSDOM } = jsdom;
const fs = require('fs');

const { window } = new JSDOM('<!DOCTYPE html><html><body></body></html>');
const DOMParser = window.DOMParser;

const html = `<div><script language='javascript'> ShowPictureQ('abc.jpg');</script></div>`;

const doc = new DOMParser().parseFromString(
      `<!DOCTYPE html><html><body>${html}</body></html>`,
      "text/html"
    );
console.log("DOMParser:", doc.body.innerHTML);

const div = window.document.createElement("div");
div.innerHTML = html;
console.log("innerHTML:", div.innerHTML);
