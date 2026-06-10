const text = String.raw`Ниже приведена программа, записанная на языке Python. $$\begin{array}{l} s = int(input()) \\ t = int(input()) \\ A = int(input()) \\ \text{if } (s > A) \text{ or } (t > 11): \\ \quad \text{print(YES)} \\ \text{else:} \\ \quad \text{print(NO)} \end{array}$$ Было проведено 9 запусков программы...`;

function normalizeEscapedTaskSymbols(raw) {
  if (typeof raw !== "string" || !raw) return raw;
  return raw
    .replace(/\\([#+^])/g, "$1")
    .replace(/\\\\end\{/g, "\\\\ \\end{")
    .replace(/(?<!\\)\\(?=\s|<|$)/g, "");
}

function formatOgeInf6TaskHtml(html) {
  if (typeof html !== 'string' || !html) return html;

  return html.replace(/\$\$\s*\\begin\{array\}\{[a-z\|]*\}([\s\S]*?)\\end\{array\}\s*\$\$/g, (match, inner) => {
    let code = inner
      .replace(/\\\\/g, '\n') // replace \\ with newline
      .replace(/\\text\{([^}]+)\}/g, '$1') // replace \text{...} with ...
      .replace(/\\quad\s*/g, '    ') // replace \quad with 4 spaces
      .replace(/&lt;/g, '<').replace(/&gt;/g, '>') // unescape html if any
      .replace(/&amp;/g, '&')
      .replace(/\\;/g, ' ') // thin spaces
      .trim();
      
    code = code.split('\n').map(line => line.trimEnd()).join('\n');

    return '<pre class="task-code-block"><code class="language-python">' + code + '</code></pre>';
  });
}

const normalized = normalizeEscapedTaskSymbols(text);
console.log("NORMALIZED:\n", normalized);
console.log("FORMATTED:\n", formatOgeInf6TaskHtml(normalized));
