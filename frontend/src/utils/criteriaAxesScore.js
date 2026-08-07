/**
 * Сумма баллов по осям рубрики (без gate-обнуления).
 *
 * @param {Array<{code:string,max_score?:number}>} axes
 * @param {Record<string, number|null|undefined>} selected
 */
export function computeAxesTaskScore(axes, selected = {}) {
  const list = Array.isArray(axes) ? axes : [];
  let total = 0;
  const perAxis = {};
  let answered = 0;

  for (const axis of list) {
    const code = axis?.code;
    if (!code) continue;
    const raw = selected[code];
    if (raw == null || raw === "") continue;
    const max = Number(axis.max_score) || 0;
    let score = Number(raw);
    if (!Number.isFinite(score)) continue;
    score = Math.max(0, max > 0 ? Math.min(score, max) : score);
    perAxis[code] = score;
    answered += 1;
    total += score;
  }

  return {
    total,
    perAxis,
    gated: false,
    complete: list.length > 0 && answered === list.length,
  };
}

/** Уровень оси по баллу (или null, если для этого балла нет строки). */
export function findAxisLevel(axis, score) {
  const levels = Array.isArray(axis?.levels) ? axis.levels : [];
  const sc = Number(score);
  return levels.find((lv) => Number(lv.criteria_score) === sc) || null;
}

/**
 * Строки баллов для матрицы (как в КИМ): от max вниз до 0.
 */
export function axesScoreRows(axes) {
  const list = Array.isArray(axes) ? axes : [];
  let top = 0;
  for (const axis of list) {
    const fromMax = Number(axis?.max_score) || 0;
    const fromLevels = Math.max(
      0,
      ...(Array.isArray(axis?.levels) ? axis.levels.map((lv) => Number(lv.criteria_score) || 0) : [0])
    );
    top = Math.max(top, fromMax, fromLevels);
  }
  const rows = [];
  for (let s = top; s >= 0; s -= 1) rows.push(s);
  return rows;
}

/** Есть ли ось с шкалой больше 0/1 — тогда матрица «баллы × критерии». */
export function axesNeedScoreMatrix(axes) {
  const list = Array.isArray(axes) ? axes : [];
  return list.some((a) => (Number(a?.max_score) || 0) > 1 || (a?.levels?.length || 0) > 2);
}
