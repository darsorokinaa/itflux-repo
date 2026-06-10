function normalizeEscapedTaskSymbols(raw) {
  if (typeof raw !== 'string' || !raw) return raw;
  return raw
    .replace(/\\([#+^])/g, "$1")
    .replace(/\\\\end\{/g, "\\\\ \\end{")
    .replace(/(?<!\\|\/)\\(?=\s|<|$)/g, ""); // Added |\/ to negative lookbehind
}

const tests = [
  '<p>(x /\\<span> y) \\/ z</p>',
  '<p>¬((x → w) → (w ≡ z)) /\\ y,</p>',
  '<p>(x /\\ y) \\/ z</p>',
  '<p>text \\ </p>',
  '<p>text \\<tag></p>'
];

tests.forEach((t, i) => console.log(i, ":", normalizeEscapedTaskSymbols(t)));
