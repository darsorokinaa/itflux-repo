const text = String.raw`Ниже приведена программа, записанная на языке Python. $$\begin{array}{l} s = int(input()) \\ t = int(input()) \\ A = int(input()) \\ \text{if } (s > A) \text{ or } (t > 11): \\ \quad \text{print(YES)} \\ \text{else:} \\ \quad \text{print(NO)} \end{array}$$ Было проведено 9 запусков программы, при которых в качестве значений переменных $s$ и $t$ вводились следующие пары чисел: $(-9, 11)$; $(2, 7)$; $(5, 12)$; $(2, -2)$; $(7, -9)$; $(12, 6)$; $(9, -1)$; $(7, 11)$; $(11, -5)$. Укажите наименьшее целое значение параметра $A$, при котором для указанных входных данных программа напечатает «NO» пять раз.`;

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
      
    // Убираем лишние пробелы в конце строк, но сохраняем отступы слева
    code = code.split('\n').map(line => line.trimEnd()).join('\n');

    return '<pre class="task-code-block"><code class="language-python">' + code + '</code></pre>';
  });
}

console.log(formatOgeInf6TaskHtml(text));
