import { fipiUnicodeExprToLatex, looksLikeFipiUnicodeMath } from "../src/utils/formatFipiUnicodeMathHtml.js";

const cases = [
  [" 𝑥2⁢ &lt;9 .", "x^{2} \\lt 9"],
  [" 6⁢𝑥 −𝑥2⁢ ≤0 .", "6x - x^{2} \\le 0"],
  [" 81⁢𝑥2⁢ ≤16 .", "81x^{2} \\le 16"],
  [" 8⁢𝑥 −𝑥2⁢ &gt;0 .", "8x - x^{2} \\gt 0"],
  [" 6⁢𝑥 −𝑥2⁢ &lt;0 .", "6x - x^{2} \\lt 0"],
  [" {−\u2009\u206212+3\u2062𝑥&gt;0,9−4\u2062𝑥&gt;−\u2009\u20623. ", "\\begin{cases}- 12 + 3x \\gt 0 \\\\ 9 - 4x \\gt - 3\\end{cases}"],
  ["{х+3,2≤0,х+1≤−\u2009\u20621.", "\\begin{cases}x + 3{,}2 \\le 0 \\\\ x + 1 \\le - 1\\end{cases}"],
];

const skipCases = [
  "Свежие фрукты содержат 86% воды, а высушенные – 23%. Сколько сухих фруктов получится из 341 кг свежих фруктов?",
  "Первый рабочий за час делает на 5 деталей больше, чем второй, и выполняет заказ, состоящий из 180 деталей, на 3 часа быстрее, чем второй рабочий, выполняющий такой же заказ. Сколько деталей в час делает первый рабочий?",
  "Свежие фрукты содержат 79 % воды, а высушенные — 16 %. Сколько требуется свежих фруктов для приготовления 72 кг высушенных фруктов?",
];

let failed = 0;
for (const [input, expected] of cases) {
  const got = fipiUnicodeExprToLatex(input);
  const ok = got === expected;
  if (!ok) {
    failed += 1;
    console.log("FAIL");
    console.log(" in:", JSON.stringify(input));
    console.log("want:", expected);
    console.log(" got:", got);
  } else {
    console.log("OK:", expected);
  }
}
if (failed) process.exit(1);

for (const text of skipCases) {
  if (looksLikeFipiUnicodeMath(text)) {
    console.log("FAIL should skip:", text.slice(0, 60));
    process.exit(1);
  }
}
console.log("skip cases OK");
