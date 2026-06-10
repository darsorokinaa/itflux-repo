const text = 'Ниже приведена программа, записанная на языке Python. $$\\begin{array}{l} s = int(input()) \\\\ t = int(input()) \\\\ A = int(input()) \\\\ \\text{if } (s > A) \\text{ or } (t > 11): \\\\ \\quad \\text{print(YES)} \\\\ \\text{else:} \\\\ \\quad \\text{print(NO)} \\end{array}$$ Было проведено 9 запусков программы...';

function normalizeEscapedTaskSymbols(raw) {
  if (typeof raw !== "string" || !raw) return raw;
  return raw
    .replace(/\\([#+^])/g, "$1")
    .replace(/\\\\end\{/g, "\\\\ \\end{")
    .replace(/(?<!\\)\\(?=\s|<|$)/g, "");
}

const normalized = normalizeEscapedTaskSymbols(text);
console.log("RAW:", JSON.stringify(text));
console.log("NORMALIZED:", JSON.stringify(normalized));
