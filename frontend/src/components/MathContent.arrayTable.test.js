import { describe, expect, it } from "vitest";
import { prepareBankTaskDisplayHtml, preparePlainBankTaskHtml } from "./MathContent.jsx";

const BACKEND_ARRAY_TABLE = `
<p>В таблице приведены запросы.</p>
<div class="math-display"><table class="array-table" role="table"><thead><tr class="array-row"><th class="array-cell" scope="col">Запрос</th><th class="array-cell" scope="col">Найдено страниц (в тысячах)</th></tr></thead><tbody><tr class="array-row"><td class="array-cell">Динамо &amp; (Зенит | Спартак)</td><td class="array-cell">840</td></tr><tr class="array-row"><td class="array-cell">Динамо &amp; Зенит</td><td class="array-cell">530</td></tr><tr class="array-row"><td class="array-cell">Динамо &amp; Зенит &amp; Спартак</td><td class="array-cell">130</td></tr></tbody></table></div>
<p>Какое количество страниц будет найдено по запросу $$\\text{Динамо \\& Спартак}$$ ?</p>
`;

const RAW_LATEX_ARRAY = String.raw`В таблице приведены запросы.
$$\begin{array}{|c|c|} \hline \text{Запрос} & \text{Найдено страниц (в тысячах)} \\ \hline \text{Динамо \& (Зенит | Спартак)} & 840 \\ \hline \text{Динамо \& Зенит} & 530 \\ \hline \text{Динамо \& Зенит \& Спартак} & 130 \\ \hline \end{array}$$
Какое количество страниц будет найдено по запросу $$\text{Динамо \& Спартак}$$ ?`;

function countRowCells(html, rowIndex) {
  const root = document.createElement("div");
  root.innerHTML = html;
  const rows = [...root.querySelectorAll("table.array-table tr")];
  if (!rows[rowIndex]) return 0;
  return rows[rowIndex].querySelectorAll("td, th").length;
}

describe("LaTeX array tables with literal &", () => {
  it("keeps backend array-table columns (does not split Динамо & Спартак)", () => {
    const out = prepareBankTaskDisplayHtml(BACKEND_ARRAY_TABLE);
    expect(out).toContain("array-table");
    expect(out).not.toMatch(/\\begin\{matrix\}/);
    expect(countRowCells(out, 0)).toBe(2);
    expect(countRowCells(out, 1)).toBe(2);
    expect(countRowCells(out, 2)).toBe(2);
    expect(countRowCells(out, 3)).toBe(2);
    expect(out).toMatch(/Динамо\s*&(?:amp;)?\s*\(Зенит/);
    expect(out).toContain("840");
  });

  it("does not turn \\& into a column separator inside $$array$$", () => {
    const out = preparePlainBankTaskHtml(RAW_LATEX_ARRAY);
    expect(out).not.toContain("task-code-block");
    const arrayBlock = out.match(/\$\$\\begin\{array\}[\s\S]*?\\end\{array\}\$\$/);
    expect(arrayBlock).toBeTruthy();
    // innerHTML сериализует & как &amp;; после декодирования \& — литерал, & — колонка.
    const decoded = arrayBlock[0].replace(/&amp;/gi, "&");
    expect(decoded).toMatch(/Динамо\s*\\&\s*\(Зенит/);
    const firstDataRow = decoded.split("\\\\").find((row) => row.includes("840"));
    expect(firstDataRow).toBeTruthy();
    const amps = firstDataRow.match(/(?<!\\)&/g) || [];
    expect(amps).toHaveLength(1);
  });
});
