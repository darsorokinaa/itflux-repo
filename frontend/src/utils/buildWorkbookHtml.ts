/**
 * Сборка печатной «Рабочей тетради» из выбранных задач банка.
 * Открывается в новой вкладке: поле в клетку для решения + строка для ответа.
 */

import { preparePlainBankTaskHtml } from "../components/MathContent.jsx";

export type WorkbookTask = {
  id: number;
  task_number: number | null;
  text: string;
  subtopic?: string | null;
  task_title?: string | null;
};

export type WorkbookOptions = {
  showGrading?: boolean;
  showSolutionSpace?: boolean;
  showAnswers?: boolean;
};

export type WorkbookMeta = {
  title: string;
  subtitle?: string;
  options?: WorkbookOptions;
};

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function siteOrigin(): string {
  if (typeof window !== "undefined" && window.location?.origin) {
    return window.location.origin;
  }
  return "";
}

function logoUrl(): string {
  const base = import.meta.env.BASE_URL || "/";
  const origin = siteOrigin();
  return `${origin}${base}favicon.png?v=1`;
}

function prepareTaskHtml(raw: string): string {
  if (!raw) return "";
  try {
    return preparePlainBankTaskHtml(raw);
  } catch {
    return raw;
  }
}

function renderTask(
  task: WorkbookTask,
  index: number,
  options: Required<WorkbookOptions>
): string {
  const solutionHtml = options.showSolutionSpace
    ? '<div class="calculation-field workbook-solution-block"></div>'
    : "";
  const answerHtml = options.showAnswers
    ? `<div class="answer-row workbook-answer-block">
        <span class="answer-label">Ответ:</span>
        <span class="answer-line"></span>
      </div>`
    : "";

  return `
    <section class="task">
      <div class="task-header">
        <div class="task-left">
          <div class="task-badge">
            <div class="task-number-box">${index + 1}</div>
            <div class="task-id">${escapeHtml(String(task.id))}</div>
          </div>
          <div class="task-meta">
            <div class="task-text">${prepareTaskHtml(task.text)}</div>
          </div>
        </div>
      </div>
      ${solutionHtml}
      ${answerHtml}
    </section>`;
}

function normalizeOptions(options?: WorkbookOptions): Required<WorkbookOptions> {
  return {
    showGrading: options?.showGrading !== false,
    showSolutionSpace: options?.showSolutionSpace !== false,
    showAnswers: options?.showAnswers !== false,
  };
}

export function buildWorkbookHtml(tasks: WorkbookTask[], meta: WorkbookMeta): string {
  const origin = siteOrigin();
  const title = escapeHtml(meta.title || "Рабочая тетрадь");
  const subtitle = meta.subtitle ? escapeHtml(meta.subtitle) : "";
  const options = normalizeOptions(meta.options);
  const tasksHtml = tasks
    .map((task, index) => renderTask(task, index, options))
    .join("\n");
  const gradingChecked = options.showGrading ? "checked" : "";
  const solutionChecked = options.showSolutionSpace ? "checked" : "";
  const answersChecked = options.showAnswers ? "checked" : "";
  const bodyClasses = [
    !options.showGrading ? "no-grading-fields" : "",
    !options.showSolutionSpace ? "no-solution-fields" : "",
    !options.showAnswers ? "no-answer-fields" : "",
  ]
    .filter(Boolean)
    .join(" ");

  return `<!DOCTYPE html>
<html lang="ru">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>${title} | Цифровой поток</title>
  ${origin ? `<base href="${escapeHtml(origin)}/">` : ""}
  <script>
    window.MathJax = {
      tex: {
        inlineMath: [['$', '$'], ['\\\\(', '\\\\)']],
        displayMath: [['$$', '$$'], ['\\\\[', '\\\\]']]
      },
      chtml: { scale: 1.32, mtextInheritFont: false, matchFontHeight: false },
      startup: { typeset: false }
    };
  </script>
  <script async src="https://cdn.jsdelivr.net/npm/mathjax@3/es5/tex-mml-chtml.js"></script>
  <style>
    :root {
      --blue: #214ACD;
      --dark: #0D1B3E;
      --text: #1F2937;
      --muted: #8A94A6;
      --grid: #C5D4F2;
      --grid-border: #AFC2E8;
      --page: #FFFFFF;
      --workbook-cell: 18px;
      --workbook-rows: 5;
    }
    * { box-sizing: border-box; }
    body {
      margin: 0;
      background: #EEF3FA;
      font-family: Arial, Helvetica, sans-serif;
      color: var(--text);
      line-height: 1.28;
    }
    .toolbar {
      width: 210mm;
      max-width: calc(100% - 24px);
      margin: 16px auto 0;
      display: flex;
      flex-wrap: wrap;
      gap: 10px;
      align-items: center;
      justify-content: flex-end;
    }
    .toolbar button {
      font: inherit;
      font-weight: 700;
      font-size: 13px;
      padding: 9px 16px;
      border-radius: 999px;
      border: 1.5px solid var(--blue);
      background: var(--blue);
      color: #fff;
      cursor: pointer;
    }
    .toolbar button.secondary { background: #fff; color: var(--blue); }
    .toolbar label {
      display: inline-flex;
      align-items: center;
      gap: 8px;
      font-size: 13px;
      color: var(--muted);
      cursor: pointer;
      user-select: none;
    }
    .page {
      width: 210mm;
      min-height: 297mm;
      margin: 20px auto;
      padding: 18mm 16mm 14mm;
      background: var(--page);
      position: relative;
      box-shadow: 0 10px 35px rgba(15, 23, 42, 0.08);
    }
    .header {
      position: absolute;
      top: 8mm;
      left: 18mm;
      right: 18mm;
      display: flex;
      align-items: center;
      justify-content: space-between;
      font-size: 11px;
      color: var(--muted);
    }
    .brand {
      display: flex;
      align-items: center;
      gap: 9px;
      color: var(--dark);
      font-weight: 600;
      text-decoration: none;
    }
    .brand-logo {
      width: 30px;
      height: 18px;
      object-fit: contain;
      display: block;
    }
    .brand-handle {
      color: var(--blue);
      font-weight: 700;
      text-decoration: none;
    }
    .title-block { margin-bottom: 10px; }
    .workbook-title {
      margin: 0 0 4px;
      font-size: 22px;
      line-height: 1.1;
      color: var(--dark);
      letter-spacing: -.03em;
    }
    .workbook-subtitle {
      margin: 0;
      font-size: 12px;
      color: var(--muted);
      line-height: 1.25;
    }
    .student-info {
      display: grid;
      grid-template-columns: 1fr 1fr;
      gap: 8px;
      margin: 12px 0 8px;
    }
    .info-field {
      display: flex;
      align-items: flex-end;
      gap: 6px;
      font-size: 12px;
      color: var(--muted);
    }
    .info-line {
      flex: 1;
      height: 16px;
      border-bottom: 1px solid #AFC2E8;
    }
    .info-box {
      width: 32px;
      height: 22px;
      border: 1.5px solid #AFC2E8;
      flex-shrink: 0;
    }
    .score-summary {
      display: flex;
      gap: 18px;
      margin: 0 0 10px;
      font-size: 12px;
      color: var(--muted);
    }
    .score-summary span {
      display: inline-flex;
      align-items: flex-end;
      gap: 8px;
    }
    .score-line {
      width: 72px;
      height: 20px;
      border-bottom: 1px solid #AFC2E8;
      display: inline-block;
    }
    .section-title {
      margin: 0 0 8px;
      font-size: 15px;
      color: var(--dark);
    }
    .task {
      margin-bottom: 14px;
      page-break-inside: avoid;
      break-inside: avoid;
    }
    .task-header {
      display: flex;
      align-items: flex-start;
      gap: 10px;
      margin-bottom: 4px;
    }
    .task-left {
      display: flex;
      align-items: flex-start;
      gap: 10px;
      flex: 1;
    }
    .task-badge {
      width: 40px;
      min-width: 40px;
      display: flex;
      flex-direction: column;
      align-items: center;
      padding-top: 1px;
    }
    .task-number-box {
      width: 24px;
      height: 18px;
      border: 1.5px solid var(--blue);
      color: var(--blue);
      display: flex;
      align-items: center;
      justify-content: center;
      font-size: 12px;
      font-weight: 700;
      background: #fff;
    }
    .task-id {
      margin-top: 4px;
      font-size: 10px;
      color: #98A1B2;
      font-weight: 600;
    }
    .task-meta { flex: 1; padding-top: 0; }
    .task-text {
      margin: 0;
      font-size: 13.5px;
      color: var(--text);
      line-height: 1.25;
    }
    .task-text :is(p, div, li) { margin: 0 0 0.2em; }
    .task-text :is(p, div, ul, ol):last-child { margin-bottom: 0; }
    .task-text table { margin: 0.15em 0; border-collapse: collapse; }
    .task-text td, .task-text th { padding: 1px 4px; }
    .task-text > :not(.oge-math-choice-task) img,
    .task-text :not(.oge-math-choice-task) > img {
      display: block;
      max-width: 100%;
      max-height: 110px;
      margin: 0.15em 0;
    }
    .task-text .oge-math-choice-task img {
      max-width: 100%;
    }
    .task-text .oge-math-choice-question .oge-math-fipi-inline-frac,
    .task-text .oge-math-choice-question p span > img[src*="xs3qstsrc"] {
      display: inline-block !important;
      vertical-align: middle;
      width: auto !important;
      max-width: none !important;
      height: auto !important;
      max-height: 1.55em !important;
      margin: 0 0.06em !important;
    }
    .task-text .oge-math-choice-question > p:has(> img[src*="xs3qstsrc"]:only-child) > img[src*="xs3qstsrc"] {
      display: block !important;
      max-width: 100% !important;
      max-height: 100px;
      margin: 0.2em 0 !important;
    }
    .task-text .oge-math-choice-question mjx-container[jax="CHTML"] {
      display: inline-block !important;
      vertical-align: middle;
      margin: 0 0.04em !important;
    }
    .task-text .oge-math-choice-question .task-html-block {
      display: inline;
      margin: 0;
      padding: 0;
    }
    .task-text .oge-math-choice-question .task-html-block:has(> img:only-child) {
      display: block;
      margin: 0.2em 0;
    }
    .task-text .oge-math-choice-task { margin: 0; }
    .task-text .oge-math-choice-question {
      margin: 0 0 4px;
      padding: 0;
      font-size: inherit;
      line-height: 1.25;
    }
    .task-text .oge-math-choice-question p {
      margin: 0 0 0.3em;
      display: block;
    }
    .task-text .oge-math-choice-question p:last-child {
      margin-bottom: 0;
    }
    .task-text .oge-math-choice-question table {
      margin: 0;
      border: none;
      border-collapse: collapse;
    }
    .task-text .oge-math-choice-question :is(td, th) {
      border: none;
      padding: 0 0.1em;
      vertical-align: baseline;
    }
    .task-text .oge-math-choice-footer,
    .task-text .oge-math-choice-prompt {
      display: block;
      margin: 2px 0 4px;
      padding: 0;
      font-size: inherit;
      line-height: 1.25;
      color: var(--text);
    }
    .task-text .oge-math-choice-options {
      list-style: none;
      margin: 0;
      padding: 0;
      display: flex;
      flex-direction: column;
      gap: 2px;
    }
    .task-text .oge-math-choice-option {
      display: flex;
      align-items: center;
      gap: 8px;
      margin: 0;
      padding: 0;
      min-height: 0;
    }
    .task-text .oge-math-choice-option__num {
      flex-shrink: 0;
      width: 22px;
      height: 22px;
      display: inline-flex;
      align-items: center;
      justify-content: center;
      border-radius: 5px;
      background: var(--blue);
      color: #fff;
      font-weight: 800;
      font-size: 11px;
      line-height: 1;
    }
    .task-text .oge-math-choice-option__body {
      flex: 1;
      min-width: 0;
      font-size: inherit;
      line-height: 1.1;
    }
    .task-text .oge-math-choice-option__body :is(p, div, span) {
      margin: 0;
      padding: 0;
      display: inline;
    }
    .task-text .oge-math-choice-option__body img,
    .task-text .oge-math-choice-option__body .oge-math-fipi-bitmap {
      display: inline-block;
      vertical-align: middle;
      width: auto;
      height: auto;
      max-height: 1.45em;
      max-width: none;
      margin: 0;
    }
    .task-text .oge-math-choice-option__body mjx-container {
      display: inline-block !important;
      vertical-align: middle;
    }
    .task-text .oge-math-choice-option__body table {
      display: inline-table;
      margin: 0;
      border: none;
      border-collapse: collapse;
    }
    .task-text .oge-math-choice-option__body :is(td, th) {
      border: none;
      padding: 0;
      vertical-align: baseline;
    }
    .task-text table.bank-task-table {
      border-collapse: collapse;
      margin: 0.15em 0;
    }
    .task-text table.bank-task-table :is(td, th) {
      border: 1px solid #94a3b8;
      padding: 2px 5px;
    }
    .calculation-field {
      box-sizing: border-box;
      width: 100%;
      height: calc(var(--workbook-cell) * var(--workbook-rows));
      margin-top: 6px;
      border: 1px solid var(--grid-border);
      background-color: #fff;
      background-image:
        repeating-linear-gradient(
          to bottom,
          var(--grid) 0,
          var(--grid) 1px,
          transparent 1px,
          transparent var(--workbook-cell)
        ),
        repeating-linear-gradient(
          to right,
          var(--grid) 0,
          var(--grid) 1px,
          transparent 1px,
          transparent var(--workbook-cell)
        );
      background-position: 0 0;
      background-repeat: repeat;
      -webkit-print-color-adjust: exact;
      print-color-adjust: exact;
    }
    .answer-row {
      display: flex;
      align-items: flex-end;
      gap: 8px;
      margin-top: 5px;
    }
    .answer-label {
      font-size: 12px;
      color: var(--muted);
      white-space: nowrap;
    }
    .answer-line {
      flex: 1;
      height: 18px;
      border-bottom: 1px solid #9FB5DC;
    }
    body.no-grading-fields .grading-block { display: none !important; }
    body.no-solution-fields .workbook-solution-block { display: none !important; }
    body.no-answer-fields .workbook-answer-block { display: none !important; }
    .toolbar__group {
      display: inline-flex;
      flex-wrap: wrap;
      gap: 14px;
      align-items: center;
      margin-right: auto;
    }
    @media print {
      body {
        background: #fff;
        -webkit-print-color-adjust: exact;
        print-color-adjust: exact;
      }
      .toolbar { display: none !important; }
      .page {
        width: auto;
        min-height: auto;
        margin: 0;
        box-shadow: none;
      }
      :root {
        --workbook-cell: 5mm;
        --workbook-rows: 5;
        --grid: #B8C8E8;
        --grid-border: #9FB5DC;
      }
      .calculation-field,
      .workbook-solution-block {
        break-inside: avoid;
        page-break-inside: avoid;
      }
      .task {
        break-inside: avoid;
        page-break-inside: avoid;
      }
    }
    @page { size: A4; margin: 0; }
  </style>
</head>
<body class="${bodyClasses}">
  <div class="toolbar">
    <div class="toolbar__group">
      <label>
        <input type="checkbox" id="toggle-grading" ${gradingChecked} />
        Поля для оценивания
      </label>
      <label>
        <input type="checkbox" id="toggle-solution" ${solutionChecked} />
        Место для решения
      </label>
      <label>
        <input type="checkbox" id="toggle-answers" ${answersChecked} />
        Строки для ответа
      </label>
    </div>
    <button type="button" onclick="window.print()">Печать / Сохранить в PDF</button>
    <button type="button" class="secondary" onclick="window.close()">Закрыть</button>
  </div>
  <main class="page">
    <header class="header">
      <a class="brand" href="https://t.me/itfluxacademy" target="_blank" rel="noreferrer">
        <img class="brand-logo" src="${logoUrl()}" alt="Логотип" onerror="this.style.display='none'">
        <span class="brand-title">Цифровой поток</span>
      </a>
      <a class="brand-handle" href="https://t.me/itfluxacademy" target="_blank" rel="noreferrer">@itfluxacademy</a>
    </header>

    <section class="grading-block">
      <section class="student-info">
        <div class="info-field"><span>Фамилия, имя:</span><span class="info-line"></span></div>
        <div class="info-field"><span>Класс:</span><span class="info-line"></span></div>
        <div class="info-field"><span>Дата:</span><span class="info-line"></span></div>
        <div class="info-field"><span>Оценка:</span><span class="info-box"></span></div>
      </section>
      <div class="score-summary">
        <span>Правильных: <span class="score-line"></span></span>
        <span>Неправильных: <span class="score-line"></span></span>
      </div>
    </section>

    <section class="title-block">
      <h1 class="workbook-title">${title}</h1>
      ${subtitle ? `<p class="workbook-subtitle">${subtitle}</p>` : ""}
    </section>

    <h2 class="section-title">Задания</h2>
    ${tasksHtml}
  </main>
  <script>
    (function () {
      var gradingCb = document.getElementById("toggle-grading");
      var solutionCb = document.getElementById("toggle-solution");
      var answersCb = document.getElementById("toggle-answers");
      function sync() {
        document.body.classList.toggle("no-grading-fields", !gradingCb.checked);
        document.body.classList.toggle("no-solution-fields", !solutionCb.checked);
        document.body.classList.toggle("no-answer-fields", !answersCb.checked);
      }
      gradingCb.addEventListener("change", sync);
      solutionCb.addEventListener("change", sync);
      answersCb.addEventListener("change", sync);
      sync();
      function typeset() {
        if (window.MathJax && window.MathJax.typesetPromise) {
          window.MathJax.typesetPromise().catch(function () {});
        } else {
          setTimeout(typeset, 120);
        }
      }
      typeset();
    })();
  </script>
</body>
</html>`;
}

export function openWorkbook(tasks: WorkbookTask[], meta: WorkbookMeta): void {
  const html = buildWorkbookHtml(tasks, meta);
  const win = window.open("", "_blank");
  if (!win) {
    window.alert("Разрешите всплывающие окна, чтобы открыть рабочую тетрадь.");
    return;
  }
  win.document.open();
  win.document.write(html);
  win.document.close();
}
