import { useMemo } from "react";

function stripAnswerHtml(html) {
  return String(html || "")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function liveStudentAnswer(result, task) {
  // Показываем ответ учителю только после «Проверить».
  if (liveStudentChecked(result, task) === null) return "";
  const byNum = result?.by_number || result?.byNumber || {};
  const byId = result?.by_task_id || result?.byTaskId || {};
  const numKey = task.number != null ? String(task.number) : "";
  if (numKey && byNum[numKey] != null && String(byNum[numKey]).trim() !== "") {
    return String(byNum[numKey]);
  }
  if (task.id != null) {
    const raw = byId[task.id] ?? byId[String(task.id)];
    if (raw != null && String(raw).trim() !== "") return String(raw);
  }
  return "";
}

function liveStudentChecked(result, task) {
  const checked = result?.checked || {};
  if (task.id == null) return null;
  if (checked[task.id] !== undefined) return checked[task.id];
  if (checked[String(task.id)] !== undefined) return checked[String(task.id)];
  return null;
}

function buildTasks(answers) {
  const students = answers?.students || [];
  const rows = Array.isArray(answers?.tasks) ? answers.tasks : [];
  if (rows.length) {
    return [...rows]
      .map((t) => ({
        id: t.id,
        number: t.number,
        answer: t.answer || "",
      }))
      .sort((a, b) => (Number(a.number) || 0) - (Number(b.number) || 0));
  }
  const nums = new Set();
  students.forEach((row) => {
    Object.keys(row.result?.by_number || row.result?.byNumber || {}).forEach((n) => nums.add(n));
  });
  if (nums.size) {
    return [...nums]
      .sort((a, b) => Number(a) - Number(b))
      .map((n) => ({ id: null, number: n, answer: "" }));
  }
  const ids = new Set();
  students.forEach((row) => {
    const byId = row.result?.by_task_id || row.result?.byTaskId || {};
    Object.keys(byId).forEach((id) => {
      if (String(byId[id] ?? "").trim()) ids.add(id);
    });
  });
  return [...ids].map((id) => ({ id, number: id, answer: "" }));
}

/**
 * Таблица ответов учеников по live-варианту на уроке.
 * @param {{ answers: object|null, loading?: boolean, compact?: boolean }} props
 */
export default function LiveVariantAnswersTable({ answers, loading = false, compact = false }) {
  const students = answers?.students || [];
  const tasks = useMemo(() => buildTasks(answers), [answers]);

  return (
    <section
      className={`live-variant-answers${compact ? " live-variant-answers--compact" : ""}`}
      aria-label="Ответы учеников"
    >
      <div className="live-variant-answers__title">
        <strong>{answers?.title || "Вариант"} · ответы ученика</strong>
        {loading ? <span className="live-variant-answers__meta">обновление…</span> : null}
      </div>
      {!students.length && !loading ? (
        <p className="live-variant-answers__empty">Ученик ещё не начал отвечать.</p>
      ) : null}
      {students.map((row) => {
        const result = row.result || {};
        return (
          <div key={row.studentId} className="live-variant-answers__card">
            <div className="live-variant-answers__head">
              <strong>{row.displayName}</strong>
            </div>
            {tasks.length ? (
              <div className="live-variant-answers__table-wrap">
                <table className="live-variant-answers__table">
                  <thead>
                    <tr>
                      <th>№</th>
                      <th>Ответ ученика</th>
                      <th>Правильный</th>
                      <th></th>
                    </tr>
                  </thead>
                  <tbody>
                    {tasks.map((task) => {
                      const value = liveStudentAnswer(result, task);
                      const ok = liveStudentChecked(result, task);
                      const correct = stripAnswerHtml(task.answer);
                      return (
                        <tr key={`${row.studentId}-${task.id || task.number}`}>
                          <td>{task.number ?? "—"}</td>
                          <td>{value.trim() ? value : "—"}</td>
                          <td>{correct || "—"}</td>
                          <td>
                            {ok === true ? (
                              <span className="live-variant-answers__ok">верно</span>
                            ) : ok === false ? (
                              <span className="live-variant-answers__bad">ошибка</span>
                            ) : (
                              <span className="live-variant-answers__empty">—</span>
                            )}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            ) : (
              <p className="live-variant-answers__empty">Черновик пуст</p>
            )}
          </div>
        );
      })}
    </section>
  );
}
