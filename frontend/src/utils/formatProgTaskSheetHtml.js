/**
 * Программирование (только школьная программа / prog): условие → единая таблица
 * «Раздел / Содержание». Для остальных предметов и уровней не используется —
 * там остаётся обычный текст условия.
 */

function escapeHtml(value) {
  return String(value || "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function convertLatexTextCommands(html) {
  if (typeof html !== "string" || !html) return html || "";
  return html
    .replace(/\\textbf\{([^{}]+)\}/g, "<strong>$1</strong>")
    .replace(/\\textit\{([^{}]+)\}/g, "<em>$1</em>")
    .replace(/\\texttt\{([^{}]+)\}/g, "<code>$1</code>")
    .replace(/\\text\{([^{}]+)\}/g, "$1");
}

function stripTags(html) {
  return String(html || "")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function extractTitle(html) {
  const patterns = [
    /\\textbf\{([^{}]+)\}/,
    /<strong[^>]*>\s*([^<]+?)\s*<\/strong>/i,
    /<b[^>]*>\s*([^<]+?)\s*<\/b>/i,
  ];
  for (const re of patterns) {
    const match = html.match(re);
    if (!match) continue;
    const title = String(match[1] || "")
      .replace(/&nbsp;/g, " ")
      .replace(/\s+/g, " ")
      .replace(/[.。]\s*$/, "")
      .trim();
    if (!title) continue;
    return {
      title,
      body: html.replace(match[0], "").replace(/^\s*[.。]\s*/, "").trim(),
    };
  }

  // Плоский текст: «Короткий заголовок. Дальше условие...»
  const plain = stripTags(html);
  const plainMatch = plain.match(/^([^.]{8,90})\.\s+([\s\S]+)$/u);
  if (plainMatch) {
    const title = plainMatch[1].trim();
    const restPlain = plainMatch[2].trim();
    // Вырезаем заголовок из HTML только если он стоит в начале без разметки.
    const escapedTitle = title.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const leading = new RegExp(`^\\s*${escapedTitle}\\.\\s*`, "u");
    if (leading.test(html)) {
      return {
        title,
        body: html.replace(leading, "").trim() || restPlain,
      };
    }
    return { title, body: html };
  }

  return { title: "", body: html };
}

function looksLikeProgTask(html) {
  if (typeof html !== "string" || !html) return false;
  const sample = html.slice(0, 1200);
  return (
    /\\textbf\{/.test(sample) ||
    /<strong[\s>]/i.test(sample) ||
    /<code[\s>]/i.test(sample) ||
    /(for|while|список|массив|цикл|матриц|броск)/i.test(sample)
  );
}

function splitConditionAndTask(bodyHtml) {
  const match = bodyHtml.match(
    /^(.*?)(\s+(?:Используя|Примените|Напишите|Реализуйте|Как считать:)[\s\S]+)$/iu,
  );
  if (!match) {
    return [{ label: "Условие", html: bodyHtml.trim() }];
  }
  const condition = match[1].trim();
  const taskPart = match[2].trim();

  const rows = [];
  if (condition) rows.push({ label: "Условие", html: condition });

  const answerHint = taskPart.match(/^(.*?)(\s+В ответе запишите[\s\S]+)$/iu);
  if (answerHint) {
    const assignment = answerHint[1].trim();
    const outputHint = answerHint[2].trim();
    if (assignment) rows.push({ label: "Задание", html: assignment });
    if (outputHint) rows.push({ label: "Вывод", html: outputHint });
  } else if (taskPart) {
    rows.push({ label: "Задание", html: taskPart });
  }

  return rows.length ? rows : [{ label: "Условие", html: bodyHtml.trim() }];
}

function collectTestDataRows(bodyHtml) {
  if (typeof document === "undefined") return [];
  const root = document.createElement("div");
  root.innerHTML = bodyHtml;
  const codes = [...root.querySelectorAll("code")]
    .map((node) => (node.textContent || "").replace(/\s+/g, " ").trim())
    .filter((text) => /=/.test(text) && text.length <= 120);

  if (codes.length < 1) return [];

  const unique = [...new Set(codes)];
  if (!unique.length) return [];

  const html = unique.map((item) => `<code>${escapeHtml(item)}</code>`).join("<br>");
  return [{ label: "Тестовые данные", html }];
}

/**
 * @param {string} rawHtml
 * @param {{ taskNumber?: number|string|null, force?: boolean }} [options]
 * @returns {string|null}
 */
export function formatProgTaskSheetHtml(rawHtml, options = {}) {
  const { force = false } = options;
  if (typeof rawHtml !== "string" || !rawHtml.trim()) return null;
  if (!force && !looksLikeProgTask(rawHtml)) return null;

  const html = convertLatexTextCommands(rawHtml.trim());
  const { title, body } = extractTitle(html);
  let bodyHtml = convertLatexTextCommands(body || html).trim();
  if (!bodyHtml) bodyHtml = convertLatexTextCommands(rawHtml).trim();

  const rows = splitConditionAndTask(bodyHtml);
  const testRows = collectTestDataRows(bodyHtml);
  if (testRows.length) {
    rows.push(...testRows);
  }

  // Если заголовок так и не нашли — не подставляем общее «Программирование»,
  // а берём первую фразу условия.
  let headingTitle = title;
  if (!headingTitle) {
    const fallback = stripTags(bodyHtml).split(/[.!?]/u)[0]?.trim() || "";
    headingTitle = fallback.length >= 8 && fallback.length <= 90 ? fallback : "Условие задачи";
  }

  const bodyRows = rows.filter((row) => row.html);
  if (!bodyRows.length) return null;

  // Div-grid вместо <table>: общие стили all-tasks table снимают border:none.
  const gridRows = [
    `<div class="prog-task-sheet__row prog-task-sheet__row--head" role="row">
      <div class="prog-task-sheet__cell prog-task-sheet__cell--head" role="columnheader">Раздел</div>
      <div class="prog-task-sheet__cell prog-task-sheet__cell--head" role="columnheader">Содержание</div>
    </div>`,
    ...bodyRows.map(
      (row) => `<div class="prog-task-sheet__row" role="row">
      <div class="prog-task-sheet__cell prog-task-sheet__cell--label" role="rowheader">${escapeHtml(row.label)}</div>
      <div class="prog-task-sheet__cell prog-task-sheet__cell--body" role="cell">${row.html}</div>
    </div>`,
    ),
  ].join("");

  return `
    <article class="prog-task-sheet">
      <h3 class="prog-task-sheet__title">${escapeHtml(headingTitle)}</h3>
      <div class="prog-task-sheet__grid" role="table" aria-label="Условие задачи">
        ${gridRows}
      </div>
    </article>
  `.trim();
}

export function convertLatexTextCommandsHtml(html) {
  return convertLatexTextCommands(html);
}
