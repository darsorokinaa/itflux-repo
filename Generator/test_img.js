const jsdom = require('jsdom');
const { JSDOM } = jsdom;
const fs = require('fs');

const { window } = new JSDOM('<!DOCTYPE html><html><body></body></html>');
const img = window.document.createElement("img");
img.src = "/media/test.png";
console.log(img.src);
console.log(img.getAttribute("src"));
