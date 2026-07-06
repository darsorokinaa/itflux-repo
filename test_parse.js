const fs = require('fs');
const { JSDOM } = require('jsdom');
const html = fs.readFileSync("task.html", "utf-8");
const dom = new JSDOM(html);
const tables = dom.window.document.querySelectorAll("table");
tables.forEach((t, i) => {
  console.log(`Table ${i}:`);
  console.log(`  Rows: ${t.rows.length}`);
  for (let r = 0; r < t.rows.length; r++) {
    console.log(`  Row ${r} cells: ${t.rows[r].cells.length}`);
    for (let c = 0; c < t.rows[r].cells.length; c++) {
      console.log(`    Cell ${c} text length: ${t.rows[r].cells[c].textContent.length}`);
    }
  }
});
