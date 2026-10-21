import { describe, expect, it } from "vitest";
import { formatOgeMathMatchingTaskHtml } from "./formatOgeMathMatchingTaskHtml";

const blk = (x) => `<div class="task-html-block">${x}</div>`;
const task = (intro, header) =>
  blk(
    blk(`<p>${intro}</p>`) +
      blk(blk("<b><u>ГРАФИКИ</u></b>") + ["А", "Б", "В"].map((l) => blk(`<b>${l})</b>`) + blk(`<p><img src="/media/x${l}.png"/></p>`)).join("")) +
      blk(`<b><u>${header}</u></b>`) +
      blk([1, 2, 3].map((n) => blk(`<b>${n})</b>`) + blk(`<p>\\(k&gt;0\\)</p>`)).join("")),
  );

describe("formatOgeMathMatchingTaskHtml row title", () => {
  it("КОЭФФИЦИЕНТЫ stays «Коэффициенты» even if intro says «графики функций»", () => {
    const out = formatOgeMathMatchingTaskHtml(task("На рисунках изображены графики функций вида \\(y=kx+b\\).", "КОЭФФИЦИЕНТЫ"));
    expect(out).toContain("Коэффициенты");
    expect(out).not.toContain(">Функции<");
  });
  it("ФОРМУЛЫ header gives «Формулы»", () => {
    const out = formatOgeMathMatchingTaskHtml(task("Установите соответствие между графиками функций и формулами.", "ФОРМУЛЫ"));
    expect(out).toContain("Формулы");
  });
});
