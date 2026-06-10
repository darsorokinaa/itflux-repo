function normalizeEscapedTaskSymbols(raw) {
  if (typeof raw !== "string" || !raw) return raw;
  return raw
    .replace(/\\([#+^])/g, "$1")
    .replace(/\\\\end\{/g, "\\\\ \\end{")
    .replace(/(?<!\\)\\(?=\s|<|$)/g, "");
}

const html1 = '<p>(x /\\<span> y) \\/ z</p>';
const html2 = '<p>¬((x → w) → (w ≡ z)) \\/ y,</p>';
const html3 = '<p>(x /\\ y) \\/ z</p>';

console.log("1:", normalizeEscapedTaskSymbols(html1));
console.log("2:", normalizeEscapedTaskSymbols(html2));
console.log("3:", normalizeEscapedTaskSymbols(html3));
