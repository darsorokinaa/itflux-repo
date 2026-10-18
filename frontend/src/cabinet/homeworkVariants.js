/**
 * r75: ДЗ с несколькими вариантами.
 *
 * Ответы всех вариантов лежат в одном result (by_task_id — id задач банка).
 * Строки tasks_snapshot / grading_snapshot / scoring.tasks помечены variant_id;
 * строки старых попыток без метки относятся к первому варианту ДЗ (до r75
 * считался только он). by_number в таком ДЗ неоднозначен — номера у вариантов
 * совпадают, — поэтому для экрана варианта он не используется.
 */

function toId(value) {
  const n = Number(value);
  return Number.isFinite(n) && n > 0 ? n : null;
}

/** Варианты ДЗ из контекста API (homework_review / assignment / карточка ученика). */
export function homeworkVariantList(ctx) {
  if (!ctx || typeof ctx !== "object") return [];
  const out = [];
  const seen = new Set();
  const rows = Array.isArray(ctx.variants) ? ctx.variants : [];
  for (const row of rows) {
    const variantId = toId(row?.variant_id ?? row?.variantId);
    if (!variantId || seen.has(variantId)) continue;
    seen.add(variantId);
    out.push({
      variantId,
      level: row.level || "",
      subject: row.subject || "",
      title: row.title || "",
      variantPath: row.variant_path || row.variantPath || "",
      homeworkTaskId: row.homework_task_id ?? null,
      taskCount: row.task_count ?? null,
      answeredCount: row.answered_count ?? null,
    });
  }
  if (!out.length) {
    const variantId = toId(ctx.variant_id ?? ctx.variantId);
    if (variantId) {
      out.push({
        variantId,
        level: ctx.level || "",
        subject: ctx.subject || "",
        title: "",
        variantPath: ctx.variant_path || "",
        homeworkTaskId: null,
        taskCount: null,
        answeredCount: null,
      });
    }
  }
  return out;
}

/** Варианты из списка заданий ДЗ (open_url вида /oge/math/variant/123). */
export function homeworkVariantListFromTasks(tasks) {
  const out = [];
  const seen = new Set();
  for (const task of Array.isArray(tasks) ? tasks : []) {
    if (!task?.is_variant) continue;
    const href = String(task.open_url || task.description || "");
    const m = href.match(/\/(oge|ege|vpr)\/([^/?#]+)\/variant\/(\d+)/i);
    const variantId = toId(task.variant_id) || (m ? toId(m[3]) : null);
    if (!variantId || seen.has(variantId)) continue;
    seen.add(variantId);
    out.push({
      variantId,
      level: m ? m[1].toLowerCase() : "",
      subject: m ? m[2] : "",
      title: task.title || "",
      variantPath: "",
      homeworkTaskId: task.id ?? null,
      openUrl: task.open_url || "",
      taskCount: null,
      answeredCount: null,
    });
  }
  return out;
}

function rowBelongs(row, variantId, primaryId) {
  if (!row || typeof row !== "object") return false;
  const tagged = toId(row.variant_id);
  return (tagged || primaryId) === variantId;
}

/**
 * Результат, суженный до одного варианта ДЗ: снимки и строки scoring только этого
 * варианта, без by_number. Для одного варианта возвращает result как есть.
 */
export function resultForVariant(result, variantId, variantIds) {
  if (!result || typeof result !== "object") return result;
  const ids = (Array.isArray(variantIds) ? variantIds : []).map(toId).filter(Boolean);
  const current = toId(variantId);
  if (ids.length <= 1 || !current) return result;
  const primary = ids[0];
  const scoped = { ...result };
  delete scoped.by_number;
  delete scoped.byNumber;
  for (const key of ["tasks_snapshot", "grading_snapshot"]) {
    if (Array.isArray(result[key])) {
      scoped[key] = result[key].filter((row) => rowBelongs(row, current, primary));
    }
  }
  if (result.scoring && typeof result.scoring === "object") {
    const rows = Array.isArray(result.scoring.tasks) ? result.scoring.tasks : [];
    const summary = (Array.isArray(result.scoring.variants) ? result.scoring.variants : [])
      .find((row) => toId(row?.variant_id) === current);
    scoped.scoring = {
      ...result.scoring,
      ...(summary || {}),
      tasks: rows.filter((row) => rowBelongs(row, current, primary)),
    };
    delete scoped.scoring.variants;
  }
  return scoped;
}

/** Итог одного варианта из scoring.variants (null, если попытка его ещё не считала). */
export function variantScoringSummary(result, variantId) {
  const rows = Array.isArray(result?.scoring?.variants) ? result.scoring.variants : [];
  return rows.find((row) => toId(row?.variant_id) === toId(variantId)) || null;
}

/** Другие варианты ДЗ, в которых ещё нет ни одного ответа (для предупреждения перед сдачей). */
export function otherVariantsWithoutAnswers(variants, currentVariantId) {
  const current = toId(currentVariantId);
  return (Array.isArray(variants) ? variants : []).filter((row) => (
    row
    && toId(row.variantId) !== current
    && Number(row.taskCount) > 0
    && Number(row.answeredCount) === 0
  ));
}

export function variantLabel(row, index) {
  const title = String(row?.title || "").trim();
  if (title) return title;
  return row?.variantId ? `Вариант №${row.variantId}` : `Вариант ${index + 1}`;
}

/**
 * Строки журнала ДЗ с меткой variant_id: true перед первой строкой каждого
 * варианта, если вариантов в ДЗ несколько (для заголовка группы в таблице).
 */
export function startsVariantGroup(rows, index) {
  const list = Array.isArray(rows) ? rows : [];
  const ids = new Set(list.map((row) => toId(row?.variant_id)).filter(Boolean));
  if (ids.size < 2) return false;
  const current = toId(list[index]?.variant_id);
  if (!current) return false;
  return index === 0 || toId(list[index - 1]?.variant_id) !== current;
}

export function journalRowKey(prefix, row) {
  const variant = toId(row?.variant_id);
  return `${prefix}-${variant ? `${variant}-` : ""}${row?.id || row?.number}`;
}
