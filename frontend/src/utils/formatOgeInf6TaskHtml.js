/**
 * Форматирует код в 6 задании ОГЭ по информатике.
 * В базе код часто хранится как LaTeX array:
 * $$\begin{array}{l} s = int(input()) \\ ... \end{array}$$
 * Мы преобразуем его в <pre><code class="language-python">...</code></pre>
 */
export function formatOgeInf6TaskHtml(html) {
  if (typeof html !== "string" || !html) return html;

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

    return `<pre class="task-code-block"><code class="language-python">${code}</code></pre>`;
  });
}
