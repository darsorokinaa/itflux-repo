/** r125: помощники «Решать вариант» (без React — покрыты vitest). */

export function liveSolveJoinUrl(session, origin = typeof window !== "undefined" ? window.location.origin : "") {
  const path = session?.joinPath || (session?.id ? `/variant-live/${session.id}` : "");
  return path ? `${origin}${path}` : "";
}

/** Подпись остатка лимита для ученика. */
export function describeQuota(row) {
  if (!row) return "";
  if (row.limit == null) return "без ограничений";
  if (row.alreadyIssued) return `уже выдан в этом месяце (${row.used} из ${row.limit})`;
  const left = Math.max(0, Number(row.remaining ?? row.limit - row.used));
  if (left === 0) return `лимит исчерпан (${row.used} из ${row.limit})`;
  return `осталось ${left} из ${row.limit}`;
}

export function joinErrorText(err) {
  const status = err?.status;
  if (status === 410) return "Учитель закрыл эту ссылку.";
  if (status === 404) return "Ссылка не найдена.";
  return err?.data?.detail || err?.message || "Не удалось подключиться к варианту.";
}
