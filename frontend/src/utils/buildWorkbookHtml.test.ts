import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import {
  buildExamTemplateDocument,
  buildWorkbookHtml,
  injectExamTemplateData,
  VARIANT_PDF_OPTIONS,
  variantTasksToWorkbookTasks,
  type ExamTemplateDocument,
} from "./buildWorkbookHtml";

const templatePath = resolve(__dirname, "../../public/templates/shablon_varianta_ege_2027.html");

function documentData(html: string): ExamTemplateDocument {
  const match = html.match(/<script id="document-data" type="application\/json">([\s\S]*?)<\/script>/);
  if (!match) throw new Error("document-data missing");
  return JSON.parse(match[1]) as ExamTemplateDocument;
}

describe("buildExamTemplateDocument", () => {
  it("numbers a workbook from 1 and never uses 0", () => {
    const doc = buildExamTemplateDocument([{ id: 10, task_number: 0, text: "Условие" }], {
      title: "Тетрадь",
      mode: "workbook",
    });
    expect(doc.mode).toBe("worksheet");
    expect(doc.title).toBe("Тетрадь");
    expect(doc.tasks.map((task) => task.number)).toEqual(["1"]);
    expect(doc.tasks[0]?.html || doc.tasks[0]?.text).toContain("Условие");
    expect(doc.options.includeCover).toBe(false);
    expect(doc.options.showWatermark).toBe(false);
    expect(doc.options.layout).toBe("spread");
  });

  it("keeps 1..N through 10 and 30 tasks", () => {
    const ten = Array.from({ length: 10 }, (_, i) => ({ id: i + 1, task_number: i, text: "t" }));
    const thirty = Array.from({ length: 30 }, (_, i) => ({ id: i + 1, task_number: 15, text: "t" }));
    expect(buildExamTemplateDocument(ten, { title: "10", mode: "workbook" }).tasks.map((task) => task.number)).toEqual(
      Array.from({ length: 10 }, (_, i) => String(i + 1))
    );
    expect(
      buildExamTemplateDocument(thirty, { title: "30", mode: "workbook" }).tasks.map((task) => task.number)
    ).toEqual(Array.from({ length: 30 }, (_, i) => String(i + 1)));
  });

  it("uses exam numbers and parts for a variant", () => {
    const tasks = variantTasksToWorkbookTasks([
      { id: 1, number: 1, part: 1, text: "p1a" },
      { id: 2, number: 2, part: 1, text: "p1b" },
      { id: 3, number: 13, part: 2, text: "p2a" },
      { id: 4, number: 15, part: 2, text: "p2b" },
    ]);
    const doc = buildExamTemplateDocument(tasks, {
      title: "Вариант 17 — Математика — ЕГЭ",
      sheetTitle: "Вариант №17",
      subtitle: "ЕГЭ · Математика",
      subject: "math",
      level: "ege",
      mode: "variant",
      examDuration: "235 минут",
      options: VARIANT_PDF_OPTIONS,
    });
    expect(doc.mode).toBe("exam");
    expect(doc.title).toBe("Тренировочный вариант");
    expect(doc.variant).toBe("17");
    expect(doc.subject).toBe("МАТЕМАТИКА");
    expect(doc.grade).toBe("11");
    expect(doc.level).toBe("Профильный уровень");
    expect(doc.year).toBe("2027");
    expect(doc.duration).toBe(235);
    expect(doc.footer).toBe("Цифровой поток • Учебные материалы");
    expect(doc.watermark).toBe("");
    expect(doc.options.showWatermark).toBe(false);
    expect(doc.options.showAlternatives).toBe(false);
    expect(doc.showAnswerExample).toBe(true);
    expect(doc.partInstructions?.["1"]).toContain("десятичн");
    expect(doc.partInstructions?.["2"]).toContain("решение");
    expect(doc.coverToolsNote).toContain("линейкой");
    expect(doc.headerLeft).toBe("");
    expect(doc.options.includeCover).toBe(true);
    expect(doc.options.showAnswerKey).toBe(true);
    expect(doc.options.solutionStyle).toBe("grid");
    expect(doc.options.solutionLines).toBe(8);
    expect(doc.tasks.map((task) => task.number)).toEqual(["1", "2", "13", "15"]);
    expect(doc.tasks.map((task) => task.part)).toEqual([1, 1, 2, 2]);
  });

  it("keeps every task file as a linked material", () => {
    const tasks = variantTasksToWorkbookTasks([
      {
        id: 1,
        number: 1,
        text: "По графику",
        file: "/media/task_files/legacy.zip",
        attachments: [
          { url: "/media/task_files/grafik.png", name: "grafik.png" },
          { url: "/media/task_files/legacy.zip", name: "legacy.zip" },
          { url: "https://files.example/data.zip", name: "data.zip" },
        ],
      },
    ]);
    const doc = buildExamTemplateDocument(tasks, {
      title: "Вариант",
      mode: "variant",
      level: "ege",
      subject: "inf",
    });
    expect(doc.tasks[0]?.materials).toEqual([
      { href: "http://localhost:3000/media/task_files/grafik.png", name: "grafik.png" },
      { href: "http://localhost:3000/media/task_files/legacy.zip", name: "legacy.zip" },
      { href: "https://files.example/data.zip", name: "data.zip" },
    ]);
    expect(doc.tasks[0]?.html || "").not.toContain("Материалы к заданию");
    const template = readFileSync(templatePath, "utf8");
    expect(template).toContain("function makeMaterials");
    expect(template).toContain('link.href=href');
    expect(template).toContain(".task-material{");
  });

  it("falls back to sequential numbers when exam numbers repeat", () => {
    const doc = buildExamTemplateDocument(
      [
        { id: 1, task_number: 1, text: "a" },
        { id: 2, task_number: 1, text: "b" },
      ],
      { title: "Вариант №4", mode: "variant", level: "ege", subject: "math" }
    );
    expect(doc.tasks.map((task) => task.number)).toEqual(["1", "2"]);
  });

  it("hides the answer line when answers are off and keeps the key off by default", () => {
    const doc = buildExamTemplateDocument([{ id: 1, task_number: 1, text: "x", answer: "5" }], {
      title: "PDF",
      mode: "workbook",
      options: { showSolutionSpace: true, showAnswers: false },
    });
    expect(doc.tasks[0]?.answerStyle).toBe("none");
    expect(doc.tasks[0]?.answer).toBe("5");
    expect(doc.options.showAnswerKey).toBe(false);
    expect(doc.options.solutionStyle).toBe("grid");
  });

  it("uses subject copy and bank overrides for the part boxes", () => {
    const rus = buildExamTemplateDocument([{ id: 1, task_number: 1, text: "x" }], {
      title: "Вариант",
      mode: "variant",
      level: "ege",
      subject: "rus",
    });
    expect(rus.partInstructions?.["1"]).toContain("слово");
    expect(rus.showAnswerExample).toBe(false);
    expect(rus.coverToolsNote).toContain("словарём");

    const overridden = buildExamTemplateDocument([{ id: 1, task_number: 1, text: "x" }], {
      title: "Вариант",
      mode: "variant",
      level: "ege",
      subject: "math",
      partInstructions: { "1": "Свой текст части 1" },
      coverParagraphs: ["Своя инструкция предмета."],
    });
    expect(overridden.partInstructions?.["1"]).toBe("Свой текст части 1");
    expect(overridden.partInstructions?.["2"]).toContain("решение");
    expect(overridden.coverParagraphs).toEqual(["Своя инструкция предмета."]);
    expect(overridden.coverAnswerNote).toBeUndefined();
  });
});

describe("injectExamTemplateData", () => {
  it("replaces document-data and escapes script breakout", () => {
    const shell = `<!doctype html><script id="document-data" type="application/json">{"mode":"exam"}</script><script id="katex-library"></script>`;
    const doc = buildExamTemplateDocument(
      [{ id: 1, task_number: 1, text: "</script><script>alert(1)</script>" }],
      { title: "Тетрадь", mode: "workbook" }
    );
    doc.tasks[0] = { number: "1", part: 1, html: "</script><script>alert(1)</script>" };
    const html = injectExamTemplateData(shell, doc);
    expect(html.match(/<script/g)).toHaveLength(2);
    expect(html).toContain("\\u003c/script>");
    expect(html).toContain('id="katex-library"');
    expect(documentData(html).title).toBe("Тетрадь");
  });

  it("keeps $&nbsp; inside formulas instead of splicing the previous script", () => {
    const shell = `<!doctype html><script id="document-data" type="application/json">{"keep":"sentinel-chetyrehugolnik"}</script>`;
    const doc = buildExamTemplateDocument(
      [{ id: 1, task_number: 1, text: "вектор $\\vec{b}$&nbsp;и $\\vec{a}+4\\vec{b}$." }],
      { title: "Тетрадь", mode: "workbook" }
    );
    doc.tasks[0] = { number: "1", part: 1, html: "вектор $\\vec{b}$&nbsp;и $\\vec{a}+4\\vec{b}$." };
    const html = injectExamTemplateData(shell, doc);
    const taskHtml = documentData(html).tasks[0]?.html || "";
    expect(taskHtml).toContain("\\vec{b}");
    expect(taskHtml).toContain("\\vec{a}+4\\vec{b}");
    expect(taskHtml).toMatch(/&nbsp;|\u00a0/);
    expect(taskHtml).not.toContain("sentinel-chetyrehugolnik");
    expect(html).not.toContain("sentinel-chetyrehugolnik");
  });

  it("turns bank dollar math into KaTeX delimiters", () => {
    const doc = buildExamTemplateDocument(
      [{ id: 1, task_number: 1, text: "Найдите корень $3^{x-5}=27$.", answer: "$2$" }],
      { title: "Тетрадь", mode: "workbook" }
    );
    expect(doc.tasks[0]?.html).toContain("\\(3^{x-5}=27\\)");
    expect(doc.tasks[0]?.html).not.toContain("$3^{");
    expect(doc.tasks[0]?.answer).toBe("\\(2\\)");
  });

  it("fills the real template without touching its shell", () => {
    const template = readFileSync(templatePath, "utf8");
    const html = buildWorkbookHtml(
      [{ id: 1, task_number: 1, text: "Первое условие \\(x^2\\)" }],
      {
        title: "Вариант 17 — Математика — ЕГЭ",
        sheetTitle: "Вариант №17",
        subtitle: "ЕГЭ · Математика",
        subject: "math",
        level: "ege",
        mode: "variant",
      },
      template
    );
    const data = documentData(html);
    expect(html).toContain("window.ExamTemplate");
    expect(html).toContain("@page{size:A4 landscape;margin:0}");
    expect(html).toContain("logical-page");
    expect(html).toContain("Шаблон варианта");
    expect(data.mode).toBe("exam");
    expect(data.headerLeft).toBe("");
    expect(data.subject).toBe("МАТЕМАТИКА");
    expect(data.tasks[0]?.number).toBe("1");
    expect(data.tasks[0]?.html).toContain("Первое условие");
    expect(data.tasks[0]?.html).toContain("\\(x^2\\)");
    expect(html).toContain('id="variant-download-style"');
    expect(html).toContain("https://t.me/itfluxacademy");
    expect(html).toContain(".answer-table th,.answer-table td{border:0.075mm solid #222;padding:0.165mm 1mm");
    expect(html.match(/<script id="document-data" type="application\/json">([\s\S]*?)<\/script>/)?.[1]).not.toContain(
      "четырёхугольник"
    );
  });

  it("leaves the workbook footer and does not hide variant controls", () => {
    const html = buildWorkbookHtml([{ id: 1, task_number: 1, text: "Условие" }], {
      title: "Тетрадь",
      mode: "workbook",
    });
    const data = documentData(html);
    expect(data.footer).toBe("Цифровой поток • Учебные материалы");
    expect(data.partInstructions).toBeUndefined();
    expect(html).not.toContain("variant-download-style");
  });
});
