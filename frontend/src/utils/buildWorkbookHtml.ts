/**
 * Сборка печатной «Рабочей тетради» из выбранных задач банка.
 * Открывается в новой вкладке: поле в клетку для решения + строка для ответа.
 */

export type WorkbookTask = {
  id: number;
  task_number: number | null;
  text: string;
  subtopic?: string | null;
  task_title?: string | null;
};

export type WorkbookMeta = {
  title: string;
  subtitle?: string;
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
  return `${origin}${base}img/digital-flow-logo.png`;
}

function renderTask(task: WorkbookTask, index: number): string {
  return `
    <section class="task">
      <div class="task-header">
        <div class="task-left">
          <div class="task-badge">
            <div class="task-number-box">${index + 1}</div>
            <div class="task-id">${escapeHtml(String(task.id))}</div>
          </div>
          <div class="task-meta">
            <div class="task-text">${task.text || ""}</div>
          </div>
        </div>
      </div>
      <div class="calculation-field"></div>
      <div class="answer-row">
        <span class="answer-label">Ответ:</span>
        <span class="answer-line"></span>
      </div>
    </section>`;
}

export function buildWorkbookHtml(tasks: WorkbookTask[], meta: WorkbookMeta): string {
  const origin = siteOrigin();
  const title = escapeHtml(meta.title || "Рабочая тетрадь");
  const subtitle = meta.subtitle ? escapeHtml(meta.subtitle) : "";
  const tasksHtml = tasks.map((task, index) => renderTask(task, index)).join("\n");

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
      chtml: { scale: 1.525, mtextInheritFont: false, matchFontHeight: false },
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
      --grid: #D8E5FF;
      --page: #FFFFFF;
    }
    * { box-sizing: border-box; }
    body {
      margin: 0;
      background: #EEF3FA;
      font-family: Arial, Helvetica, sans-serif;
      color: var(--text);
      line-height: 1.45;
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
      margin-right: auto;
      cursor: pointer;
      user-select: none;
    }
    .page {
      width: 210mm;
      min-height: 297mm;
      margin: 20px auto;
      padding: 24mm 18mm 20mm;
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
    .title-block { margin-bottom: 20px; }
    .workbook-title {
      margin: 0 0 8px;
      font-size: 28px;
      line-height: 1.15;
      color: var(--dark);
      letter-spacing: -.03em;
    }
    .workbook-subtitle {
      margin: 0;
      font-size: 14px;
      color: var(--muted);
    }
    .student-info {
      display: grid;
      grid-template-columns: 1fr 1fr;
      gap: 12px;
      margin: 20px 0 14px;
    }
    .info-field {
      display: flex;
      align-items: flex-end;
      gap: 8px;
      font-size: 13px;
      color: var(--muted);
    }
    .info-line {
      flex: 1;
      height: 20px;
      border-bottom: 1px solid #AFC2E8;
    }
    .info-box {
      width: 36px;
      height: 28px;
      border: 1.5px solid #AFC2E8;
      flex-shrink: 0;
    }
    .score-summary {
      display: flex;
      gap: 24px;
      margin: 0 0 22px;
      font-size: 13px;
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
    .instruction {
      margin: 0 0 22px;
      font-size: 14px;
      color: var(--text);
    }
    .section-title {
      margin: 0 0 14px;
      font-size: 18px;
      color: var(--dark);
    }
    .task {
      margin-bottom: 26px;
      page-break-inside: avoid;
      break-inside: avoid;
    }
    .task-header {
      display: flex;
      align-items: flex-start;
      gap: 16px;
      margin-bottom: 12px;
    }
    .task-left {
      display: flex;
      align-items: flex-start;
      gap: 14px;
      flex: 1;
    }
    .task-badge {
      width: 48px;
      min-width: 48px;
      display: flex;
      flex-direction: column;
      align-items: center;
      padding-top: 2px;
    }
    .task-number-box {
      width: 28px;
      height: 21px;
      border: 1.5px solid var(--blue);
      color: var(--blue);
      display: flex;
      align-items: center;
      justify-content: center;
      font-size: 13px;
      font-weight: 700;
      background: #fff;
    }
    .task-id {
      margin-top: 7px;
      font-size: 11px;
      color: #98A1B2;
      font-weight: 600;
    }
    .task-meta { flex: 1; padding-top: 2px; }
    .task-text { margin: 0; font-size: 15px; color: var(--text); }
    .calculation-field {
      width: 100%;
      height: 147px;
      margin-top: 14px;
      background-color: #FFFFFF;
      background-image:
        linear-gradient(var(--grid) 1px, transparent 1px),
        linear-gradient(90deg, var(--grid) 1px, transparent 1px);
      background-size: 21px 21px;
      background-position: -1px -1px;
    }
    .answer-row {
      display: flex;
      align-items: flex-end;
      gap: 10px;
      margin-top: 12px;
    }
    .answer-label {
      font-size: 13px;
      color: var(--muted);
      white-space: nowrap;
    }
    .answer-line {
      flex: 1;
      height: 24px;
      border-bottom: 1px solid #9FB5DC;
    }
    body.no-grading-fields .grading-block { display: none !important; }
    @media print {
      body { background: #fff; }
      .toolbar { display: none !important; }
      .page {
        width: auto;
        min-height: auto;
        margin: 0;
        box-shadow: none;
      }
    }
    @page { size: A4; margin: 0; }
  </style>
</head>
<body>
  <div class="toolbar">
    <label>
      <input type="checkbox" id="toggle-grading" checked />
      Поля для оценивания
    </label>
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

    <p class="instruction">
      Решай задания аккуратно. Для каждого задания предусмотрено поле в клетку для решения и отдельная строка для ответа.
    </p>

    <h2 class="section-title">Задания</h2>
    ${tasksHtml}
  </main>
  <script>
    (function () {
      var cb = document.getElementById("toggle-grading");
      function sync() {
        document.body.classList.toggle("no-grading-fields", !cb.checked);
      }
      cb.addEventListener("change", sync);
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
