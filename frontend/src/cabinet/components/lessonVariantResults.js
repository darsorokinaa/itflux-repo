export function lessonVariantsOf(record) {
  const list = Array.isArray(record?.variant_results) ? record.variant_results.filter(Boolean) : [];
  if (list.length) return list;
  const one = record?.variant_result;
  if (!one || typeof one !== "object") return [];
  const tasks = Array.isArray(one.tasks) ? one.tasks : [];
  if (one.title || one.variant_id || one.variantId || tasks.length || one.score_percent != null) {
    return [one];
  }
  return [];
}

/** Балл только у проверенного варианта. Незавершённый ноль не показываем. */
export function variantScoreLabel(variant) {
  if (!variant) return null;
  const status = variant.status;
  if (status && status !== "checked") return null;
  if (variant.score_percent == null || variant.score_percent === "") return null;
  const score = Number(variant.score_percent);
  if (!Number.isFinite(score)) return null;
  if (status !== "checked" && score === 0 && !variant.checked_count) return null;
  const percent = Number.isInteger(score) ? `${score}%` : `${score.toFixed(1)}%`;
  if (variant.earned_points != null && variant.max_points) {
    const earned = Number(variant.earned_points);
    const max = Number(variant.max_points);
    const points = Number.isFinite(earned) && Number.isFinite(max) ? `${earned} из ${max}` : "";
    return points ? `${points} · ${percent}` : percent;
  }
  if (variant.correct_count != null && variant.checked_count) {
    return `${variant.correct_count}/${variant.checked_count} · ${percent}`;
  }
  return percent;
}
