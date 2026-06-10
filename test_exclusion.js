const fs = require('fs');
const content = fs.readFileSync('frontend/src/components/MathContent.jsx', 'utf8');
console.log(content.includes('table.classList.contains("ege-inf-2-truth-table")'));
