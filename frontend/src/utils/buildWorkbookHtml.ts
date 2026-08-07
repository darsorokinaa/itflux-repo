/**
 * Сборка печатной «Рабочей тетради» из выбранных задач банка.
 * Открывается в новой вкладке → печать / сохранение в PDF.
 *
 * Вёрстка: классический учебный лист (serif, тонкие линии, без UI-акцентов).
 */

import {
  prepareBankTaskDisplayHtml,
  polishBankTaskMathJaxTables,
} from "../components/MathContent.jsx";
import { formatTasksCount } from "./formatTasksCount";

export type WorkbookTask = {
  id: number;
  task_number: number | null;
  text: string;
  answer?: string | null;
  subtopic?: string | null;
  task_title?: string | null;
  file_url?: string | null;
  part?: number | null;
  max_score?: number | null;
  author?: string | null;
};

export type WorkbookOptions = {
  /** Блок «Для учителя» внизу листа */
  showGrading?: boolean;
  /** Компактное поле в клетку под заданием */
  showSolutionSpace?: boolean;
  /** Строка «Ответ: ___» для записи учеником */
  showAnswers?: boolean;
  /** Показать правильные ответы из банка */
  showAnswerKey?: boolean;
  /** Показать id задачи мелким серым текстом */
  showTaskIds?: boolean;
  /** Строка «Фамилия, имя / Класс / Дата» под заголовком */
  showStudentLine?: boolean;
};

export type WorkbookMeta = {
  title: string;
  subtitle?: string;
  subject?: string;
  /** Уровень экзамена (oge/ege/vpr/school) — для табличного листа programming. */
  level?: string;
  /** Заголовок на листе; по умолчанию «Рабочий лист». */
  sheetTitle?: string;
  /** workbook — тетрадь из банка; variant — PDF экзаменационного варианта */
  mode?: "workbook" | "variant";
  /** Например «150 минут» — в шапке варианта */
  examDuration?: string;
  options?: WorkbookOptions;
};

/** Задача из API варианта (ExamPage) → формат рабочей тетради. */
export type VariantPdfTask = {
  id: number;
  number?: number | null;
  text?: string;
  answer?: string | null;
  subtopic_title?: string | null;
  task_title?: string | null;
  file?: string | null;
  part?: number | null;
  max_score?: number | null;
  author?: string | null;
};

export const VARIANT_PDF_OPTIONS: Required<WorkbookOptions> = {
  showGrading: false,
  showSolutionSpace: false,
  showAnswers: true,
  showAnswerKey: true,
  showTaskIds: false,
  showStudentLine: false,
};

export function variantTasksToWorkbookTasks(tasks: VariantPdfTask[]): WorkbookTask[] {
  return tasks.map((task) => ({
      id: task.id,
      task_number: task.number != null ? Number(task.number) : null,
      text: task.text || "",
      answer: task.answer ?? null,
      subtopic: task.subtopic_title ?? null,
      task_title: task.task_title ?? null,
      file_url: task.file ?? null,
      part: task.part ?? null,
      max_score: task.max_score ?? null,
      author: task.author ?? null,
    }));
}

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

function normalizeOptions(options?: WorkbookOptions): Required<WorkbookOptions> {
  return {
    showGrading: options?.showGrading === true,
    showSolutionSpace: options?.showSolutionSpace === true,
    showAnswers: options?.showAnswers !== false,
    showAnswerKey: options?.showAnswerKey === true,
    showTaskIds: options?.showTaskIds === true,
    showStudentLine: options?.showStudentLine !== false,
  };
}

function uniqueTaskLabels(
  tasks: WorkbookTask[],
  field: "task_title" | "subtopic"
): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const task of tasks) {
    const value = (task[field] || "").trim();
    if (!value || seen.has(value)) continue;
    seen.add(value);
    out.push(value);
  }
  return out;
}

function formatRuBalls(n: number): string {
  const abs = Math.abs(n) % 100;
  const d = abs % 10;
  if (abs > 10 && abs < 20) return `${n} баллов`;
  if (d === 1) return `${n} балл`;
  if (d >= 2 && d <= 4) return `${n} балла`;
  return `${n} баллов`;
}

function taskExamPart(task: WorkbookTask): 1 | 2 | null {
  const title = String((task as { part_title?: string | null }).part_title || "").toLowerCase();
  if (/говорен|устн|speaking|oral/.test(title)) return 2;
  if (/часть\s*2\b/.test(title)) return 2;
  if (/часть\s*1\b/.test(title)) return 1;
  if (task.part === 1 || task.part === 2) return task.part;
  if (typeof task.part === "number" && task.part >= 3) return 2;
  const n = task.task_number;
  if (n != null && n >= 1 && n <= 12) return 1;
  if (n != null && n >= 13) return 2;
  return null;
}

function displayTaskNumber(_task: WorkbookTask, index: number): number {
  return index + 1;
}

function buildSheetInfoHtml(tasks: WorkbookTask[], mode?: WorkbookMeta["mode"]): string {
  if (!tasks.length) return "";

  const parts: string[] = [`В листе ${formatTasksCount(tasks.length)}.`];
  if (mode !== "variant") {
    const themes = uniqueTaskLabels(tasks, "task_title");
    if (themes.length === 1) {
      parts.push(`Тема: ${themes[0]}.`);
    } else if (themes.length > 1) {
      parts.push(`Темы: ${themes.join(", ")}.`);
    }
  }

  return `<p class="wb-sheet-info">${escapeHtml(parts.join(" "))}</p>`;
}

/** Разбор subtitle «ОГЭ · Информатика · Задание №1 · …» для шапки. */
function parseWorkbookHeader(subtitle: string): { center: string; right: string } {
  const parts = subtitle
    .split(" · ")
    .map((s) => s.trim())
    .filter(Boolean);
  if (parts.length >= 2) {
    return {
      center: `${parts[0]} · ${parts[1]}`,
      right: parts.slice(2).join(" · "),
    };
  }
  if (parts.length === 1) return { center: parts[0], right: "" };
  return { center: "", right: "" };
}

function fileDisplayName(href: string): string {
  const s = href.trim();
  if (!s) return "Материалы к заданию";
  try {
    const u = new URL(s, siteOrigin() || "http://localhost/");
    const parts = u.pathname.split("/").filter(Boolean);
    const last = parts[parts.length - 1] || "";
    const decoded = decodeURIComponent(last.split("?")[0] || "");
    if (decoded) return decoded;
  } catch {
    /* fall through */
  }
  const tail = s.split("/").pop()?.split("?")[0] || "";
  try {
    const decoded = decodeURIComponent(tail);
    if (decoded) return decoded;
  } catch {
    if (tail) return tail;
  }
  return "Материалы к заданию";
}

function fileExtensionUpper(name: string): string {
  const match = /\.([a-z0-9]+)$/i.exec(name);
  return match ? match[1].toUpperCase() : "";
}

function fileMetaLine(displayName: string): string {
  const ext = fileExtensionUpper(displayName);
  const hints: Record<string, string> = {
    ZIP: "ZIP · материалы к заданию",
    "7Z": "7-Zip · материалы к заданию",
    RAR: "RAR · материалы к заданию",
    PDF: "PDF · документ",
    DOC: "DOC · документ",
    DOCX: "DOCX · документ",
    XLS: "XLS · таблица",
    XLSX: "XLSX · таблица",
    TXT: "TXT · текстовый файл",
    PNG: "PNG · изображение",
    JPG: "JPG · изображение",
    JPEG: "JPEG · изображение",
    GIF: "GIF · изображение",
    WEBP: "WEBP · изображение",
  };
  if (ext && hints[ext]) return hints[ext];
  if (ext) return `${ext} · материалы к заданию`;
  return "Файл · материалы к заданию";
}

function renderTaskFileHtml(fileUrl: string | null | undefined): string {
  const href = (fileUrl || "").trim();
  if (!href) return "";
  const displayName = fileDisplayName(href);
  const meta = fileMetaLine(displayName);
  return `<div class="wb-task__file">
        <a class="wb-file-link" href="${escapeHtml(href)}" target="_blank" rel="noopener noreferrer">
          <span class="wb-file-link__icon" aria-hidden="true">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round">
              <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"></path>
              <polyline points="14 2 14 8 20 8"></polyline>
            </svg>
          </span>
          <span class="wb-file-link__text">
            <span class="wb-file-link__name">${escapeHtml(displayName)}</span>
            <span class="wb-file-link__meta">${escapeHtml(meta)}</span>
          </span>
        </a>
      </div>`;
}

function prepareTaskHtml(raw: string, subject?: string, level?: string): string {
  if (!raw) return "";
  try {
    const progTaskSheet = level === "school" && subject === "prog";
    return prepareBankTaskDisplayHtml(raw, {
      ogeMathChoiceEnhance: subject === "math" || !subject,
      progTaskSheet,
    });
  } catch {
    return raw;
  }
}

function renderTask(
  task: WorkbookTask,
  index: number,
  options: Required<WorkbookOptions>,
  variantMode = false,
  subject?: string,
  level?: string
): string {
  const num = displayTaskNumber(task, index);
  const idHtml = `<span class="wb-task__id"${options.showTaskIds ? "" : ' style="display:none"'}">${escapeHtml(String(task.id))}</span>`;

  const solutionHtml = `<div class="wb-task__solution workbook-solution-block">
        <div class="wb-solution-grid" role="presentation"></div>
      </div>`;

  const answerHtml = `<div class="wb-task__answer workbook-answer-block">
        <span class="wb-answer-label">Ответ:</span>
        <span class="wb-answer-line" aria-hidden="true"></span>
      </div>`;
  const fileHtml = renderTaskFileHtml(task.file_url);
  const scoreHtml =
    variantMode && task.max_score != null && task.max_score > 0
      ? `<div class="wb-task__score">${escapeHtml(formatRuBalls(task.max_score))}</div>`
      : "";
  const authorHtml = task.author?.trim()
    ? `<div class="wb-task__author">${escapeHtml(task.author.trim())}</div>`
    : "";

  return `
    <section class="wb-task workbook-task${variantMode ? " wb-task--variant" : ""}">
      <div class="wb-task__row">
        <div class="wb-task__num-col">
          <div class="wb-task__num">${num}</div>
          ${idHtml}
        </div>
        <div class="wb-task__content">
          <div class="workbook-task__body">${prepareTaskHtml(task.text, subject, level)}</div>
        </div>
        ${scoreHtml}
      </div>
      ${fileHtml}
      ${solutionHtml}
      ${answerHtml}
      ${authorHtml}
    </section>`;
}

function renderVariantTasksHtml(
  tasks: WorkbookTask[],
  options: Required<WorkbookOptions>,
  subject?: string,
  level?: string
): string {
  const chunks: string[] = [];
  let lastPart: 1 | 2 | null = null;

  tasks.forEach((task, index) => {
    const part = taskExamPart(task);
    if (part != null && part !== lastPart) {
      chunks.push(`<h2 class="wb-part-title">Часть ${part}</h2>`);
      lastPart = part;
    }
    chunks.push(renderTask(task, index, options, true, subject, level));
  });

  return chunks.join("\n");
}

function renderTasksHtml(
  tasks: WorkbookTask[],
  options: Required<WorkbookOptions>,
  mode?: WorkbookMeta["mode"],
  subject?: string,
  level?: string
): string {
  if (mode === "variant") {
    return renderVariantTasksHtml(tasks, options, subject, level);
  }
  return tasks
    .map((task, index) => renderTask(task, index, options, false, subject, level))
    .join("\n");
}

function buildAnswerKeySectionHtml(
  tasks: WorkbookTask[],
  subject?: string
): string {
  const rows = tasks
    .map((task, index) => {
      const num = displayTaskNumber(task, index);
      // Ответы всегда обычным текстом — без табличного task sheet.
      const body = task.answer?.trim()
        ? prepareTaskHtml(task.answer, subject, undefined)
        : '<span class="wb-answer-key-empty">—</span>';
      return `<tr>
        <td class="wb-answer-key-table__num">${num}</td>
        <td class="wb-answer-key-table__val workbook-task__body workbook-task__body--answer-key">${body}</td>
      </tr>`;
    })
    .join("\n");

  return `<section class="wb-answer-key-section workbook-answer-key-block" aria-label="Ответы">
    <h2 class="wb-answer-key-section__title">Ответы</h2>
    <table class="wb-answer-key-table">
      <thead>
        <tr>
          <th scope="col">№</th>
          <th scope="col">Ответ</th>
        </tr>
      </thead>
      <tbody>
        ${rows}
      </tbody>
    </table>
  </section>`;
}

function workbookPrintCss(): string {
  return `
    :root {
      --wb-text: #1a2433;
      --wb-text-secondary: #55657a;
      --wb-line: #334155;
      --wb-line-light: #b8c5d4;
      --wb-accent: #4a6280;
      --wb-accent-muted: #5c6d82;
      --wb-accent-light: #edf1f6;
      --wb-accent-border: #b8c5d6;
      --wb-accent-soft: #d8e0ea;
      --wb-link: #3d5673;
      --wb-bg: #e8ecf2;
      --wb-surface: #f7f9fc;
      --wb-font: "PT Serif", "Liberation Serif", "Times New Roman", Times, Georgia, serif;
      --wb-margin-top: 10mm;
      --wb-margin-right: 9mm;
      --wb-margin-bottom: 10mm;
      --wb-margin-left: 12mm;
      --wb-print-header-h: 10mm;
      --wb-print-footer-h: 8mm;
      --wb-num-w: 10mm;
      --wb-num-h: 6mm;
      --wb-cell: 4.5mm;
      --wb-grid-rows: 6;
      --wb-grid-line: rgba(74, 98, 128, 0.28);
      --wb-table-border: #94a3b8;
    }

    * { box-sizing: border-box; }

    @page {
      size: A4;
      margin: var(--wb-margin-top) var(--wb-margin-right) var(--wb-margin-bottom) var(--wb-margin-left);
    }

    html, body.workbook-body {
      margin: 0;
      padding: 0;
      background: var(--wb-bg);
      color: var(--wb-text);
      font-family: var(--wb-font);
      font-size: 10.5pt;
      line-height: 1.3;
      -webkit-font-smoothing: antialiased;
    }
    body.workbook-body--variant {
      --wb-print-header-h: 11mm;
    }

    .wb-print-frame {
      width: 100%;
      border-collapse: collapse;
      border-spacing: 0;
    }
    .wb-print-frame > :is(thead, tfoot, tbody) > tr > :is(td, th) {
      padding: 0;
      border: none;
      vertical-align: top;
    }
    .wb-print-header-gap,
    .wb-print-footer-gap {
      display: none;
    }

    /* Экранный превью: обёртка печати не должна ломать вложенные таблицы */
    @media screen {
      .wb-print-frame {
        display: block;
      }
      .wb-print-frame > thead,
      .wb-print-frame > tfoot {
        display: none !important;
      }
      .wb-print-frame > tbody,
      .wb-print-frame > tbody > tr,
      .wb-print-frame > tbody > tr > .wb-print-frame__body {
        display: block;
      }
      .wb-print-header,
      .wb-print-footer {
        display: none !important;
        visibility: hidden !important;
        position: absolute !important;
        width: 0 !important;
        height: 0 !important;
        overflow: hidden !important;
        pointer-events: none !important;
      }
    }

    /* ── Панель перед печатью (не попадает в PDF) ── */
    .wb-toolbar {
      width: 210mm;
      max-width: calc(100% - 24px);
      margin: 12px auto 0;
      padding: 10px 14px;
      display: flex;
      flex-wrap: wrap;
      gap: 10px 16px;
      align-items: center;
      justify-content: flex-end;
      background: var(--wb-surface);
      border: 1px solid var(--wb-accent-border);
      font-family: system-ui, sans-serif;
      font-size: 12px;
    }
    .wb-toolbar__group {
      display: inline-flex;
      flex-wrap: wrap;
      gap: 12px 18px;
      align-items: center;
      margin-right: auto;
      color: var(--wb-text-secondary);
    }
    .wb-toolbar__group label {
      display: inline-flex;
      align-items: center;
      gap: 6px;
      cursor: pointer;
      user-select: none;
    }
    .wb-toolbar button {
      font: inherit;
      font-size: 12px;
      padding: 7px 14px;
      border: 1px solid var(--wb-accent);
      background: var(--wb-surface);
      color: var(--wb-text);
      cursor: pointer;
      border-radius: 2px;
    }
    .wb-toolbar button.wb-toolbar__print {
      background: var(--wb-accent);
      color: #fff;
      border-color: var(--wb-accent);
    }
    .wb-toolbar button:disabled {
      opacity: 0.5;
      cursor: wait;
    }

    /* ── Лист A4 (экранный превью) ── */
    .workbook-sheet {
      width: 210mm;
      min-height: 297mm;
      margin: 16px auto 24px;
      padding: var(--wb-margin-top) var(--wb-margin-right) var(--wb-margin-bottom) var(--wb-margin-left);
      background: #fff;
      position: relative;
      box-shadow: 0 2px 12px rgba(52, 65, 85, 0.1);
    }

    /* ── Шапка ── */
    .wb-header__row {
      display: flex;
      align-items: baseline;
      justify-content: space-between;
      gap: 8px;
      font-size: 8pt;
      line-height: 1.35;
      color: var(--wb-text-secondary);
    }
    .wb-header__left {
      flex: 1;
      text-align: left;
      color: var(--wb-accent-muted);
    }
    .wb-header__center {
      flex: 1.2;
      text-align: center;
    }
    .wb-header__right {
      flex: 1;
      text-align: right;
    }
    .wb-header__rule {
      border: none;
      border-top: 0.5pt solid var(--wb-line);
      margin: 4px 0 10px;
    }
    .wb-sheet-title {
      margin: 0 0 6px;
      font-size: 13pt;
      font-weight: 400;
      line-height: 1.2;
      text-align: left;
      color: var(--wb-text);
      letter-spacing: 0.01em;
    }
    .wb-header {
      margin: 0 0 4mm;
    }
    .wb-sheet-info {
      margin: 0 0 8px;
      font-size: 9.5pt;
      line-height: 1.45;
      color: var(--wb-text-secondary);
    }
    .wb-student-line {
      margin: 0 0 14px;
      font-size: 10pt;
      line-height: 1.4;
      color: var(--wb-text);
    }
    .wb-fill {
      display: inline-block;
      min-width: 52mm;
      border-bottom: 0.5pt solid var(--wb-line);
      vertical-align: baseline;
      margin: 0 4mm 0 2mm;
      height: 1.1em;
    }
    .wb-fill--short {
      min-width: 18mm;
    }

    /* ── Задания ── */
    .wb-tasks {
      margin-top: 2mm;
    }
    .wb-task {
      margin-bottom: 5mm;
      page-break-inside: avoid;
      break-inside: avoid;
    }
    .wb-task__row {
      display: flex;
      align-items: flex-start;
      gap: 4mm;
    }
    .wb-task__num-col {
      flex: 0 0 var(--wb-num-w);
      width: var(--wb-num-w);
      display: flex;
      flex-direction: column;
      align-items: center;
      padding-top: 1px;
    }
    .wb-task__num {
      width: var(--wb-num-w);
      height: var(--wb-num-h);
      border: 0.5pt solid var(--wb-line);
      display: flex;
      align-items: center;
      justify-content: center;
      font-size: 10pt;
      font-weight: 400;
      line-height: 1;
      color: var(--wb-text);
      background: #fff;
    }
    .wb-task__id {
      margin-top: 1.5mm;
      font-size: 7pt;
      line-height: 1.2;
      color: var(--wb-text-secondary);
      text-align: center;
      font-family: system-ui, sans-serif;
    }
    .wb-task__content {
      flex: 1;
      min-width: 0;
    }
    .wb-task__score {
      flex-shrink: 0;
      font-size: 8pt;
      color: var(--wb-text-secondary);
      padding-top: 2px;
      white-space: nowrap;
      text-align: right;
    }
    .wb-part-title {
      margin: 10mm 0 6mm;
      padding: 0;
      font-size: 13pt;
      font-weight: 400;
      line-height: 1.25;
      text-align: center;
      color: var(--wb-accent);
      letter-spacing: 0.06em;
    }
    .wb-tasks > .wb-part-title:first-child {
      margin-top: 2mm;
    }

    /* ── Текст задания (банк) ── */
    .workbook-task__body {
      font-size: 10.5pt;
      line-height: 1.32;
      color: var(--wb-text);
      overflow: visible;
    }
    .workbook-task__body p {
      margin: 0 0 0.35em;
    }
    .workbook-task__body p:last-child {
      margin-bottom: 0;
    }
    .workbook-task__body :is(figure.table, figure.image, .table) {
      max-width: 100%;
      margin: 0.3em 0;
      overflow: visible !important;
      max-height: none !important;
      width: auto;
    }
    .workbook-task__body :is(div, p):has(> table) {
      overflow: visible !important;
      max-height: none !important;
    }
    .workbook-task__body figure.image:has(table) {
      width: 100%;
      max-width: 100%;
      text-align: left;
    }
    .workbook-task__body img {
      max-width: 100%;
      height: auto;
    }
    .workbook-task__body p span > img[src*="innerimg"],
    .workbook-task__body img.oge-math-fipi-inline-letter,
    .workbook-task__body img.oge-math-fipi-inline-frac {
      display: inline-block;
      vertical-align: middle;
      width: auto;
      max-width: none;
      height: auto;
      max-height: 3.1em;
      margin: 0 0.06em;
    }
    .workbook-task__body img.oge-math-fipi-inline-letter {
      max-height: 1.35em;
    }
    .workbook-task__body img.oge-math-fipi-diagram,
    .workbook-task__body p:has(> img[src*="innerimg"]:only-child) > img[src*="innerimg"] {
      display: block;
      width: auto;
      max-width: 100%;
      height: auto;
      margin: 0.3em auto;
    }
    /* ── Таблицы в условиях ── */
    .workbook-sheet table:not(.wb-print-frame),
    .wb-answer-key-table {
      display: table !important;
    }
    .workbook-sheet table:not(.wb-print-frame) :is(thead, tbody, tfoot),
    .wb-answer-key-table :is(thead, tbody, tfoot) {
      display: table-row-group !important;
    }
    .workbook-sheet table:not(.wb-print-frame) tr,
    .wb-answer-key-table tr {
      display: table-row !important;
    }
    .workbook-sheet table:not(.wb-print-frame) :is(th, td),
    .wb-answer-key-table :is(th, td) {
      display: table-cell !important;
    }
    .workbook-task__body table.bank-task-table,
    .workbook-task__body table.array-table {
      border-collapse: collapse !important;
      border-spacing: 0;
      display: table;
      width: auto;
      max-width: 100%;
      margin: 0.4em 0;
      overflow: visible !important;
      background: #fff;
      -webkit-print-color-adjust: exact;
      print-color-adjust: exact;
    }
    .workbook-task__body table.bank-task-table {
      border: 0.5pt solid var(--wb-table-border) !important;
      font-size: 11.5pt !important;
      line-height: 1.35;
    }
    .workbook-task__body table.bank-task-table :is(th, td) {
      border: 0.5pt solid var(--wb-table-border) !important;
      padding: 2mm 3.5mm !important;
      vertical-align: middle;
      background: #fff !important;
      font-size: 11.5pt !important;
      line-height: 1.35;
    }
    .workbook-task__body table.bank-task-table th {
      font-weight: 600;
      background: var(--wb-accent-light) !important;
    }
    .workbook-task__body table.array-table {
      border: 0.5pt solid var(--wb-table-border);
      margin: 0.4em auto;
    }
    .workbook-task__body table.array-table :is(th.array-cell, td.array-cell) {
      border: 0.5pt solid var(--wb-table-border) !important;
      padding: 1.5mm 3mm !important;
      text-align: center;
      vertical-align: middle;
      background: #fff !important;
    }
    .workbook-task__body .math-display > table.array-table {
      display: inline-table;
    }
    .workbook-task__body table.cases-table,
    .workbook-task__body table.cases-table :is(thead, tbody, tfoot, tr, th, td) {
      border: none !important;
      padding: 0.15em 0.35em !important;
      background: transparent !important;
    }
    .workbook-task__body table.wb-layout-table,
    .workbook-task__body table.wb-layout-table :is(th, td) {
      border: none !important;
      padding: 0 2mm !important;
      background: transparent !important;
      vertical-align: top;
    }
    .workbook-task__body table.wb-layout-table {
      width: 100% !important;
      max-width: 100% !important;
      margin: 0.3em 0;
    }
    .workbook-task__body table.wb-layout-table img {
      max-width: 100%;
      height: auto;
    }
    .workbook-task__body .ege-inf-1-road-table {
      display: table !important;
      width: auto !important;
      max-width: 100% !important;
      margin: 0.4em 0 !important;
      border-collapse: separate !important;
      border-spacing: 0 !important;
      border: none !important;
      background: transparent !important;
      table-layout: auto !important;
      font-variant-numeric: tabular-nums;
    }
    .workbook-task__body .ege-inf-1-road-table :is(th, td) {
      border: none !important;
      padding: 1.5mm 3mm !important;
      text-align: left !important;
      vertical-align: middle !important;
      background: transparent !important;
      white-space: nowrap !important;
    }
    .workbook-task__body .ege-inf-1-road-table tr:first-child :is(th, td),
    .workbook-task__body .ege-inf-1-road-table tr:nth-child(2) :is(th, td),
    .workbook-task__body .ege-inf-1-road-table tr :is(th, td):first-child {
      font-weight: 600;
      color: var(--wb-accent);
    }
    .workbook-task__body .ege-inf-1-road-table tr:first-child :is(th, td):first-child {
      font-weight: 400;
      color: var(--wb-text);
    }
    .workbook-task__body .ege-inf-2-truth-table {
      display: table !important;
      width: auto !important;
      max-width: 100% !important;
      margin: 0.4em 0 !important;
      border-collapse: collapse !important;
      border: 0.5pt solid var(--wb-table-border) !important;
      table-layout: fixed !important;
      font-variant-numeric: tabular-nums;
    }
    .workbook-task__body .ege-inf-2-truth-table :is(th, td) {
      border: 0.5pt solid var(--wb-table-border) !important;
      padding: 2mm !important;
      text-align: center !important;
      vertical-align: middle !important;
      background: #fff !important;
      width: 9mm !important;
      min-width: 9mm !important;
      max-width: 9mm !important;
      box-sizing: border-box !important;
      white-space: nowrap !important;
    }
    .workbook-task__body .ege-inf-22-process-table {
      display: table !important;
      width: auto !important;
      max-width: 100% !important;
      margin: 0.4em 0 !important;
      border-collapse: collapse !important;
      border: 0.5pt solid var(--wb-table-border) !important;
      background: #fff !important;
    }
    .workbook-task__body .ege-inf-22-process-table :is(th, td) {
      border: 0.5pt solid var(--wb-table-border) !important;
      padding: 2mm 3.5mm !important;
      text-align: center !important;
      vertical-align: middle !important;
      background: #fff !important;
      white-space: nowrap;
    }
    .workbook-task__body .ege-inf-22-process-table thead th {
      background: var(--wb-accent-light) !important;
      font-weight: 600;
      white-space: normal;
    }
    .workbook-task__body .oge-math-choice-question :is(table, th, td),
    .workbook-task__body .oge-math-choice-option__body :is(table, th, td),
    .workbook-task__body .oge-math-choice-task :is(table.bank-task-table, table.bank-task-table th, table.bank-task-table td) {
      border: none !important;
      padding: 0 !important;
      background: transparent !important;
    }
    .workbook-task__body mjx-container[jax="CHTML"] {
      overflow: visible !important;
      max-width: 100%;
    }
    .workbook-task__body mjx-mtable,
    .workbook-task__body mjx-mtable.bank-task-mjx-table {
      border-collapse: collapse !important;
      border-spacing: 0 !important;
      overflow: visible !important;
    }
    .workbook-task__body mjx-mtable > mjx-table {
      border-collapse: collapse !important;
      border-spacing: 0 !important;
      overflow: visible !important;
    }
    .workbook-task__body mjx-mtable.bank-task-mjx-table mjx-mtd {
      border: 0.5pt solid var(--wb-table-border) !important;
      box-sizing: content-box !important;
      padding: 0.25em 0.55em !important;
    }
    .workbook-task__body mjx-cases mjx-mtd,
    .workbook-task__body mjx-cases mjx-mtable,
    .workbook-task__body mjx-cases mjx-mtable mjx-mtd,
    .workbook-task__body mjx-cases mjx-table {
      border: none !important;
      padding: 0 !important;
    }
    .workbook-task__body mjx-mtable.bank-task-mjx-table mjx-mtr:first-child > mjx-mtd {
      border-top: 0.5pt solid var(--wb-table-border) !important;
    }
    .workbook-task__body mjx-mtable.bank-task-mjx-table mjx-mtr:last-child > mjx-mtd {
      border-bottom: 0.5pt solid var(--wb-table-border) !important;
    }
    .workbook-task__body mjx-mtable.bank-task-mjx-table mjx-mtr > mjx-mtd:first-child {
      border-left: 0.5pt solid var(--wb-table-border) !important;
    }
    .workbook-task__body mjx-mtable.bank-task-mjx-table mjx-mtr > mjx-mtd:last-child {
      border-right: 0.5pt solid var(--wb-table-border) !important;
    }
    .workbook-task__body table.bank-task-table mjx-container[jax="CHTML"] {
      font-size: 118% !important;
    }
    .workbook-task__body mjx-container[jax="CHTML"] {
      font-size: 140% !important;
      margin: 0 0.05em;
    }
    .workbook-task__body mjx-container[jax="CHTML"][display="true"] {
      font-size: 112% !important;
      margin: 0.4em 0;
      display: block;
      text-align: center;
    }
    .workbook-task__body mjx-container[jax="CHTML"]:has(mjx-cases) {
      display: block !important;
      margin: 0.4em auto !important;
      text-align: center !important;
    }
    .workbook-task__body .task-code-block {
      font-family: "Liberation Mono", "Courier New", monospace;
      font-size: 9pt;
      white-space: pre-wrap;
      margin: 0.3em 0;
    }
    .workbook-task__body .oge-math-choice-task {
      margin: 0;
    }
    .workbook-task__body .oge-math-choice-options {
      list-style: none;
      margin: 0.3em 0 0;
      padding: 0;
    }
    .workbook-task__body .oge-math-choice-option {
      display: flex;
      gap: 0.4em;
      margin: 0.15em 0;
    }
    .workbook-task__body .oge-math-choice-option__num {
      flex-shrink: 0;
      font-size: 10pt;
    }

    /* ── ОГЭ математика: соответствие графиков и формул (№11) ── */
    .workbook-task__body .oge-math-matching-task {
      margin: 0;
    }
    .workbook-task__body .oge-math-matching-question {
      margin: 0 0 3mm;
    }
    .workbook-task__body .oge-math-matching-question p {
      margin: 0;
    }
    .workbook-task__body .oge-math-matching-row {
      margin: 0 0 4mm;
    }
    .workbook-task__body .oge-math-matching-row__title {
      font-weight: 700;
      font-size: 9pt;
      letter-spacing: 0.06em;
      text-transform: uppercase;
      color: var(--wb-accent);
      margin: 0 0 2mm;
    }
    .workbook-task__body .oge-math-matching-strip {
      display: flex;
      flex-wrap: wrap;
      align-items: flex-start;
      justify-content: flex-start;
      gap: 3mm 4mm;
      overflow: visible;
    }
    .workbook-task__body .oge-math-matching-strip--graphs {
      flex-wrap: nowrap;
      justify-content: space-between;
      gap: 2mm;
    }
    .workbook-task__body .oge-math-matching-item {
      flex: 1 1 0;
      min-width: 0;
      display: flex;
      flex-direction: column;
      align-items: center;
      gap: 1.5mm;
      text-align: center;
    }
    .workbook-task__body .oge-math-matching-strip--graphs .oge-math-matching-item {
      flex: 1 1 0;
      max-width: 33%;
    }
    .workbook-task__body .oge-math-matching-item__label {
      flex-shrink: 0;
      font-weight: 700;
      font-size: 10pt;
      color: var(--wb-accent);
      line-height: 1;
    }
    .workbook-task__body .oge-math-matching-item__body {
      width: 100%;
      text-align: center;
    }
    .workbook-task__body .oge-math-matching-item__body p {
      margin: 0;
    }
    .workbook-task__body .oge-math-matching-item--graph .oge-math-matching-item__body img {
      display: block;
      max-width: 100%;
      height: auto;
      margin: 0 auto;
    }
    .workbook-task__body .oge-math-matching-footer {
      margin: 2mm 0 0;
      font-size: 10pt;
      line-height: 1.35;
      color: var(--wb-text-muted);
    }
    .workbook-task__body .oge-math-matching-answer-grid {
      margin: 3mm 0 0;
      width: fit-content;
      max-width: 100%;
    }
    .workbook-task__body .oge-math-matching-answer-table {
      border-collapse: collapse;
      width: auto;
      min-width: 42mm;
      margin: 0;
      border: 0.5pt solid var(--wb-accent-border);
      background: #fff;
    }
    .workbook-task__body .oge-math-matching-answer-table :is(th, td) {
      border: 0.5pt solid var(--wb-accent-border) !important;
      padding: 0 !important;
      text-align: center !important;
      vertical-align: middle !important;
      background: #fff !important;
      font-size: 10pt !important;
    }
    .workbook-task__body .oge-math-matching-answer-table th {
      font-weight: 700;
      color: var(--wb-accent);
      padding: 2mm 5mm !important;
      background: var(--wb-accent-light) !important;
    }
    .workbook-task__body .oge-math-matching-answer-table td {
      padding: 0 !important;
    }
    .workbook-task__body .oge-math-matching-answer-cell {
      display: block;
      min-width: 10mm;
      min-height: 3.33rem;
    }

    /* ── Вариант: иллюстрации в 2 раза компактнее (inline-глифы не трогаем) ── */
    body.workbook-body--variant .workbook-task__body img:not(.oge-math-fipi-inline-letter):not(.oge-math-fipi-inline-frac) {
      max-width: 50%;
      width: auto;
      height: auto;
    }
    body.workbook-body--variant .workbook-task__body figure.image img {
      max-width: 50%;
    }

    /* ── Поле для решения (сетка на всю ширину) ── */
    .wb-task__solution {
      margin: 3mm 0 0;
      width: 100%;
    }
    .wb-solution-grid {
      width: 100%;
      height: calc(var(--wb-cell) * var(--wb-grid-rows));
      border: 0.5pt solid var(--wb-grid-line);
      background-color: #fff;
      background-image:
        repeating-linear-gradient(
          to bottom,
          var(--wb-grid-line) 0,
          var(--wb-grid-line) 0.5pt,
          transparent 0.5pt,
          transparent var(--wb-cell)
        ),
        repeating-linear-gradient(
          to right,
          var(--wb-grid-line) 0,
          var(--wb-grid-line) 0.5pt,
          transparent 0.5pt,
          transparent var(--wb-cell)
        );
      -webkit-print-color-adjust: exact;
      print-color-adjust: exact;
    }

    /* ── Строка ответа ── */
    .wb-task__answer {
      display: flex;
      align-items: baseline;
      gap: 3mm;
      margin: 3mm 0 0 calc(var(--wb-num-w) + 4mm);
      font-size: 10pt;
      line-height: 1.3;
    }
    .wb-answer-label {
      flex-shrink: 0;
      color: var(--wb-text);
    }
    .wb-answer-line {
      flex: 1;
      max-width: 95mm;
      border-bottom: 0.5pt solid var(--wb-line-light);
      min-height: 1.15em;
    }
    .wb-task__author {
      margin: 2mm 0 0 calc(var(--wb-num-w) + 4mm);
      text-align: right;
      font-size: 7.5pt;
      font-style: italic;
      line-height: 1.25;
      color: var(--wb-text-secondary);
    }

    /* ── Файлы к заданию ── */
    .wb-task__file {
      margin: 2.5mm 0 0 calc(var(--wb-num-w) + 4mm);
    }
    .wb-file-link {
      display: inline-flex;
      align-items: center;
      gap: 2.5mm;
      max-width: 100%;
      padding: 1.8mm 3.5mm;
      border: 0.5pt solid var(--wb-accent-border);
      border-radius: 1mm;
      background: var(--wb-accent-light);
      color: var(--wb-link);
      text-decoration: none;
      font-size: 8.5pt;
      line-height: 1.35;
      font-family: var(--wb-font);
      -webkit-print-color-adjust: exact;
      print-color-adjust: exact;
    }
    .wb-file-link__icon {
      flex-shrink: 0;
      width: 4.5mm;
      height: 4.5mm;
      color: var(--wb-accent);
    }
    .wb-file-link__icon svg {
      display: block;
      width: 100%;
      height: 100%;
    }
    .wb-file-link__text {
      min-width: 0;
    }
    .wb-file-link__name {
      display: block;
      color: var(--wb-link);
      word-break: break-word;
    }
    .wb-file-link__meta {
      display: block;
      margin-top: 0.5mm;
      font-size: 7.5pt;
      color: var(--wb-text-secondary);
    }

    /* ── Таблица ответов (всегда с новой страницы) ── */
    .wb-answer-key-section {
      margin-top: 12mm;
      page-break-before: always;
      break-before: page;
    }
    .wb-answer-key-section__title {
      margin: 0 0 5mm;
      font-size: 11pt;
      font-weight: 400;
      line-height: 1.2;
      color: var(--wb-accent);
    }
    .wb-answer-key-table {
      width: 100%;
      border-collapse: collapse;
      font-size: 9.5pt;
      line-height: 1.3;
      table-layout: fixed;
      display: table !important;
    }
    .wb-answer-key-table :is(th, td) {
      border: 0.5pt solid var(--wb-accent-border);
      padding: 1.5mm 3mm;
      vertical-align: top;
      text-align: left;
    }
    .wb-answer-key-table th {
      font-weight: 400;
      color: var(--wb-text-secondary);
      background: var(--wb-accent-light);
    }
    .wb-answer-key-table__num {
      width: 14mm;
      text-align: center;
      color: var(--wb-text);
    }
    .wb-answer-key-table__val {
      width: auto;
      color: var(--wb-text);
    }
    .wb-answer-key-table__val mjx-container[jax="CHTML"] {
      font-size: 118% !important;
    }
    .wb-answer-key-empty {
      color: var(--wb-text-secondary);
    }

    /* ── Блок для учителя (внизу) ── */
    .wb-teacher-block {
      margin-top: 14mm;
      padding-top: 4mm;
      border-top: 0.5pt solid var(--wb-line-light);
      font-size: 8.5pt;
      color: var(--wb-text-secondary);
      page-break-inside: avoid;
    }
    .wb-teacher-block__title {
      font-size: 8pt;
      text-transform: uppercase;
      letter-spacing: 0.06em;
      margin-bottom: 3mm;
      color: var(--wb-text-secondary);
    }
    .wb-teacher-block__row {
      display: flex;
      flex-wrap: wrap;
      gap: 8mm 12mm;
      align-items: baseline;
    }
    .wb-teacher-field {
      display: inline-flex;
      align-items: baseline;
      gap: 2mm;
    }
    .wb-teacher-field__line {
      display: inline-block;
      width: 14mm;
      border-bottom: 0.5pt solid var(--wb-line-light);
      height: 1.1em;
      vertical-align: baseline;
    }
    .wb-teacher-field__line--wide {
      width: 22mm;
    }

    /* ── Колонтитулы (на каждой странице при печати) ── */
    .wb-print-header,
    .wb-print-footer {
      display: none;
    }

    body.no-grading-fields .wb-teacher-block { display: none !important; }
    body.no-solution-fields .workbook-solution-block { display: none !important; }
    body.no-answer-fields .workbook-answer-block { display: none !important; }
    body.no-answer-key-fields .workbook-answer-key-block { display: none !important; }
    body.no-student-line .wb-student-line { display: none !important; }

    @media print {
      html, body.workbook-body {
        background: #fff;
      }
      .wb-toolbar {
        display: none !important;
      }
      .workbook-sheet {
        width: auto;
        min-height: auto;
        margin: 0;
        padding: 0 var(--wb-margin-right) 0 var(--wb-margin-left);
        box-shadow: none;
      }
      .wb-print-frame {
        display: table;
      }
      .wb-print-frame > thead {
        display: table-header-group;
      }
      .wb-print-frame > tfoot {
        display: table-footer-group;
      }
      .wb-print-frame > tbody {
        display: table-row-group;
      }
      .wb-print-frame > tbody > tr {
        display: table-row;
      }
      .wb-print-frame > tbody > tr > .wb-print-frame__body {
        display: table-cell;
      }
      .wb-print-header-gap {
        display: block;
        height: calc(var(--wb-print-header-h) + 1em);
      }
      .wb-print-footer-gap {
        display: block;
        height: var(--wb-print-footer-h);
      }
      .wb-answer-key-section {
        break-inside: avoid;
        page-break-inside: avoid;
      }
      .wb-task,
      .wb-solution-grid,
      .wb-teacher-block {
        break-inside: avoid;
        page-break-inside: avoid;
      }
      .wb-answer-key-table tr {
        break-inside: avoid;
        page-break-inside: avoid;
      }
      .workbook-task__body table.bank-task-table,
      .workbook-task__body table.array-table,
      .workbook-task__body table.wb-layout-table {
        break-inside: auto;
        page-break-inside: auto;
      }
      .workbook-task__body table.bank-task-table :is(th, td),
      .workbook-task__body table.array-table :is(th, td) {
        -webkit-print-color-adjust: exact;
        print-color-adjust: exact;
      }
      .wb-print-header {
        display: grid !important;
        visibility: visible !important;
        position: fixed !important;
        top: 0;
        left: 0;
        right: 0;
        width: auto !important;
        height: var(--wb-print-header-h) !important;
        overflow: visible !important;
        pointer-events: none !important;
        grid-template-columns: 1fr auto 1fr;
        align-items: center;
        gap: 3mm;
        box-sizing: border-box;
        padding: 1.5mm var(--wb-margin-right) 1.5mm var(--wb-margin-left);
        font-size: 7.5pt;
        line-height: 1.2;
        color: var(--wb-text-secondary);
        border-bottom: 0.5pt solid var(--wb-line-light);
        background: #fff;
        z-index: 2;
      }
      .wb-print-header--simple {
        display: flex !important;
        justify-content: space-between;
      }
      .wb-print-header__brand {
        color: var(--wb-accent-muted);
        text-align: left;
      }
      .wb-print-header__center {
        text-align: center;
        font-size: 7pt;
        color: var(--wb-text-secondary);
      }
      .wb-print-header__handle {
        text-align: right;
        color: var(--wb-text-secondary);
      }
      .wb-print-header--simple .wb-print-header__center {
        display: none;
      }
      .wb-print-footer {
        display: flex !important;
        visibility: visible !important;
        position: fixed !important;
        bottom: 0;
        left: 0;
        right: 0;
        width: auto !important;
        height: var(--wb-print-footer-h) !important;
        overflow: visible !important;
        pointer-events: none !important;
        box-sizing: border-box;
        align-items: center;
        justify-content: space-between;
        padding: 0 var(--wb-margin-right) 0 var(--wb-margin-left);
        font-size: 7.5pt;
        line-height: 1.2;
        color: var(--wb-text-secondary);
        background: #fff;
        z-index: 2;
      }
      .wb-print-footer__brand {
        color: var(--wb-accent-muted);
      }
      .wb-print-footer__page::after {
        content: counter(page);
      }
    }
  `;
}

function normalizeWorkbookTableTypography(root: ParentNode): void {
  root.querySelectorAll("table").forEach((table) => {
    if (table instanceof HTMLElement) {
      table.style.removeProperty("font-size");
    }
    table.querySelectorAll("th, td").forEach((cell) => {
      if (!(cell instanceof HTMLElement)) return;
      for (const prop of ["font-size", "line-height", "height", "width"]) {
        cell.style.removeProperty(prop);
      }
      cell.querySelectorAll("font, span, p, b, strong").forEach((node) => {
        if (node instanceof HTMLElement) {
          node.style.removeProperty("font-size");
        }
        if (node instanceof HTMLFontElement) {
          node.removeAttribute("size");
        }
      });
    });
  });
}

export function typesetWorkbookMath(doc: Document): Promise<void> {
  const mj = (doc.defaultView as Window | null)?.MathJax;
  if (!mj?.typesetPromise) {
    return new Promise((resolve) => {
      setTimeout(() => {
        typesetWorkbookMath(doc).then(resolve);
      }, 120);
    });
  }
  const startup = mj.startup?.promise ?? Promise.resolve();
  return startup
    .then(() => mj.typesetPromise?.())
    .then(() => {
      doc.querySelectorAll(".workbook-task__body, .workbook-task__body--answer-key").forEach((el) => {
        normalizeWorkbookTableTypography(el);
        polishBankTaskMathJaxTables(el);
      });
    })
    .catch(() => undefined);
}

export function buildWorkbookHtml(tasks: WorkbookTask[], meta: WorkbookMeta): string {
  const origin = siteOrigin();
  const isVariant = meta.mode === "variant";
  const docTitle = escapeHtml(meta.title || "Рабочая тетрадь");
  const sheetTitle = escapeHtml(meta.sheetTitle?.trim() || "Рабочий лист");
  const subtitle = meta.subtitle?.trim() ?? "";
  const { center: headerCenter, right: headerRight } = parseWorkbookHeader(subtitle);
  const options = normalizeOptions(meta.options);
  const tasksHtml = renderTasksHtml(tasks, options, meta.mode, meta.subject, meta.level);
  const sheetInfoHtml = buildSheetInfoHtml(tasks, meta.mode);
  const answerKeyHtml = buildAnswerKeySectionHtml(tasks, meta.subject);

  const pageHeaderCenter = [headerCenter, meta.examDuration].filter(Boolean).join(" · ");

  const gradingChecked = options.showGrading ? "checked" : "";
  const solutionChecked = options.showSolutionSpace ? "checked" : "";
  const answersChecked = options.showAnswers ? "checked" : "";
  const taskIdsChecked = options.showTaskIds ? "checked" : "";
  const studentLineChecked = options.showStudentLine ? "checked" : "";

  const answerKeyChecked = options.showAnswerKey ? "checked" : "";

  const bodyClasses = [
    "workbook-body",
    isVariant ? "workbook-body--variant" : "",
    !options.showGrading ? "no-grading-fields" : "",
    !options.showSolutionSpace ? "no-solution-fields" : "",
    !options.showAnswers ? "no-answer-fields" : "",
    !options.showAnswerKey ? "no-answer-key-fields" : "",
    !options.showStudentLine ? "no-student-line" : "",
  ]
    .filter(Boolean)
    .join(" ");

  const sheetHeaderHtml = isVariant
    ? `<header class="wb-header wb-header--variant">
      <h1 class="wb-sheet-title">${sheetTitle}</h1>
      ${sheetInfoHtml}
      <p class="wb-student-line">
        Фамилия, имя<span class="wb-fill"></span>
        Класс<span class="wb-fill wb-fill--short"></span>
        Дата<span class="wb-fill wb-fill--short"></span>
      </p>
    </header>`
    : `<header class="wb-header">
      <div class="wb-header__row">
        <span class="wb-header__left">Цифровой поток · @itfluxacademy</span>
        <span class="wb-header__center">${escapeHtml(headerCenter)}</span>
        <span class="wb-header__right">${escapeHtml(headerRight)}</span>
      </div>
      <hr class="wb-header__rule" />
      <p class="wb-student-line">
        Фамилия, имя<span class="wb-fill"></span>
        Класс<span class="wb-fill wb-fill--short"></span>
        Дата<span class="wb-fill wb-fill--short"></span>
      </p>
    </header>`;

  const printHeaderClass = isVariant ? "wb-print-header" : "wb-print-header wb-print-header--simple";
  const printHeaderHtml = isVariant
    ? `<header class="${printHeaderClass}" aria-hidden="true">
    <span class="wb-print-header__brand">Цифровой поток</span>
    <span class="wb-print-header__center">${escapeHtml(pageHeaderCenter)}</span>
    <span class="wb-print-header__handle">@itfluxacademy</span>
  </header>`
    : `<header class="${printHeaderClass}" aria-hidden="true">
    <span class="wb-print-header__brand">Цифровой поток</span>
    <span class="wb-print-header__center"></span>
    <span class="wb-print-header__handle">@itfluxacademy</span>
  </header>`;

  const teacherBlock = `
      <section class="wb-teacher-block" aria-label="Для учителя">
        <div class="wb-teacher-block__title">Для учителя</div>
        <div class="wb-teacher-block__row">
          <span class="wb-teacher-field">Оценка: <span class="wb-teacher-field__line"></span></span>
          <span class="wb-teacher-field">Правильных: <span class="wb-teacher-field__line wb-teacher-field__line--wide"></span></span>
          <span class="wb-teacher-field">Неправильных: <span class="wb-teacher-field__line wb-teacher-field__line--wide"></span></span>
        </div>
      </section>`;

  return `<!DOCTYPE html>
<html lang="ru">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>${docTitle} | Цифровой поток</title>
  ${origin ? `<base href="${escapeHtml(origin)}/">` : ""}
  <link rel="preconnect" href="https://fonts.googleapis.com" />
  <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin />
  <link href="https://fonts.googleapis.com/css2?family=PT+Serif:ital,wght@0,400;0,700;1,400&display=swap" rel="stylesheet" />
  <script>
    window.MathJax = {
      tex: {
        inlineMath: [['$', '$'], ['\\\\(', '\\\\)']],
        displayMath: [['$$', '$$'], ['\\\\[', '\\\\]']]
      },
      chtml: {
        scale: 1.38,
        mtextInheritFont: false,
        matchFontHeight: false
      },
      startup: { typeset: false }
    };
  </script>
  <script async src="https://cdn.jsdelivr.net/npm/mathjax@3/es5/tex-mml-chtml.js"></script>
  <style>${workbookPrintCss()}</style>
</head>
<body class="${bodyClasses}">
  <div class="wb-toolbar">
    <div class="wb-toolbar__group">
      <label>
        <input type="checkbox" id="toggle-grading" ${gradingChecked} />
        Блок для учителя
      </label>
      <label>
        <input type="checkbox" id="toggle-solution" ${solutionChecked} />
        Поле для решения
      </label>
      <label>
        <input type="checkbox" id="toggle-answers" ${answersChecked} />
        Строки для ответа
      </label>
      <label>
        <input type="checkbox" id="toggle-answer-key" ${answerKeyChecked} />
        Ответы
      </label>
      <label>
        <input type="checkbox" id="toggle-task-ids" ${taskIdsChecked} />
        ID задач
      </label>
      <label>
        <input type="checkbox" id="toggle-student-line" ${studentLineChecked} />
        Строка ученика
      </label>
    </div>
    <button type="button" id="workbook-print-btn" class="wb-toolbar__print" disabled>Подготовка формул…</button>
    <button type="button" onclick="window.close()">Закрыть</button>
  </div>

  <main class="workbook-sheet">
    <table class="wb-print-frame">
      <thead>
        <tr>
          <td><div class="wb-print-header-gap" aria-hidden="true"></div></td>
        </tr>
      </thead>
      <tfoot>
        <tr>
          <td><div class="wb-print-footer-gap" aria-hidden="true"></div></td>
        </tr>
      </tfoot>
      <tbody>
        <tr>
          <td class="wb-print-frame__body">
            ${sheetHeaderHtml}

            <div class="wb-tasks">
              ${tasksHtml}
            </div>

            ${answerKeyHtml}

            ${teacherBlock}
          </td>
        </tr>
      </tbody>
    </table>
  </main>

  ${printHeaderHtml}

  <footer class="wb-print-footer" aria-hidden="true">
    <span class="wb-print-footer__brand">Цифровой поток</span>
    <span class="wb-print-footer__page"></span>
    <span class="wb-print-footer__handle">@itfluxacademy</span>
  </footer>

  <script>
    (function () {
      var gradingCb = document.getElementById("toggle-grading");
      var solutionCb = document.getElementById("toggle-solution");
      var answersCb = document.getElementById("toggle-answers");
      var answerKeyCb = document.getElementById("toggle-answer-key");
      var taskIdsCb = document.getElementById("toggle-task-ids");
      var studentLineCb = document.getElementById("toggle-student-line");
      var printBtn = document.getElementById("workbook-print-btn");
      function sync() {
        document.body.classList.toggle("no-grading-fields", !gradingCb.checked);
        document.body.classList.toggle("no-solution-fields", !solutionCb.checked);
        document.body.classList.toggle("no-answer-fields", !answersCb.checked);
        document.body.classList.toggle("no-answer-key-fields", !answerKeyCb.checked);
        document.body.classList.toggle("no-student-line", !studentLineCb.checked);
        document.querySelectorAll(".wb-task__id").forEach(function (el) {
          el.style.display = taskIdsCb.checked ? "" : "none";
        });
      }
      gradingCb.addEventListener("change", sync);
      solutionCb.addEventListener("change", sync);
      answersCb.addEventListener("change", sync);
      answerKeyCb.addEventListener("change", sync);
      taskIdsCb.addEventListener("change", sync);
      studentLineCb.addEventListener("change", sync);
      sync();
      function enablePrint() {
        printBtn.disabled = false;
        printBtn.textContent = "Печать / Сохранить в PDF";
        printBtn.onclick = function () { window.print(); };
      }
      if (window.opener && typeof window.opener.__typesetWorkbookTab === "function") {
        window.opener.__typesetWorkbookTab(window).then(enablePrint).catch(enablePrint);
      } else {
        enablePrint();
      }
    })();
  </script>
</body>
</html>`;
}

export function openWorkbook(tasks: WorkbookTask[], meta: WorkbookMeta): void {
  let html = "";
  try {
    html = buildWorkbookHtml(tasks, meta);
  } catch (err) {
    console.error("WORKBOOK_BUILD_ERR:", err);
    window.alert("Не удалось сформировать файл. Обновите страницу и попробуйте снова.");
    return;
  }
  const win = window.open("", "_blank");
  if (!win) {
    window.alert("Разрешите всплывающие окна, чтобы открыть рабочую тетрадь.");
    return;
  }

  (window as Window & { __typesetWorkbookTab?: (w: Window) => Promise<void> }).__typesetWorkbookTab =
    (tab) => typesetWorkbookMath(tab.document);

  win.document.open();
  win.document.write(html);
  win.document.close();
}
