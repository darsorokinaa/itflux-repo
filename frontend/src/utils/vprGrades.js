/** Классы ВПР из API. null — ответ ещё не про классы. */
export function gradesForVprSubject(apiGrades) {
  if (!Array.isArray(apiGrades)) return null;
  const grades = [];
  for (const raw of apiGrades) {
    const grade = Number(raw);
    if (Number.isInteger(grade) && grade > 0 && !grades.includes(grade)) {
      grades.push(grade);
    }
  }
  return grades;
}

/**
 * Старый URL с классом, которого нет в публичном банке предмета.
 * Возвращает новые query-параметры без grade, либо null если редирект не нужен.
 */
export function unavailableVprGradeSearch(searchParams, grades) {
  if (!Array.isArray(grades)) return null;
  const raw = searchParams.get("grade");
  if (raw == null || String(raw).trim() === "") return null;
  const grade = Number(raw);
  const listed = grades.map((item) => Number(item));
  if (Number.isInteger(grade) && listed.includes(grade)) return null;
  const next = new URLSearchParams(searchParams);
  next.delete("grade");
  return next;
}
