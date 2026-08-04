import { useMemo } from "react";
import { isUserAnswerCorrect } from "../../utils/examAnswerCheck";

export function stripAnswerHtml(html) {
  return String(html || "")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * Вердикт для строки live-таблицы.
 * Не доверяем checked ученика: у него эталон скрыт, клиент часто шлёт false.
 */
export function liveAnswerVerdict(result, task, tasks, subject = "") {
  const value = liveStudentAnswer(result, task, tasks);
  const saved = liveStudentChecked(result, task, tasks);
  // Показываем статус только после «Проверить».
  if (saved === null) return null;
  if (task?.answer != null && String(task.answer).trim() !== "" && String(value || "").trim()) {
    return isUserAnswerCorrect(value, task.answer, subject);
  }
  return saved;
}

export function numberCollisionCount(tasks, numKey) {
  if (!numKey || !Array.isArray(tasks)) return 0;
  return tasks.reduce((n, t) => (String(t?.number) === numKey ? n + 1 : n), 0);
}

/**
 * Ответ ученика по задаче. Сначала по task id — иначе при одинаковых
 * bank-номерах (тетрадь из одного типа заданий) один ответ попадает во все строки.
 */
export function liveStudentAnswer(result, task, tasks) {
  const byNum = result?.by_number || result?.byNumber || {};
  const byId = result?.by_task_id || result?.byTaskId || {};
  const numKey = task.number != null ? String(task.number) : "";
  const idKey = task.id != null ? String(task.id) : "";

  if (idKey && byId[idKey] != null && String(byId[idKey]).trim() !== "") {
    return String(byId[idKey]);
  }

  // by_number безопасен только если номер уникален среди задач варианта.
  if (numKey && numberCollisionCount(tasks, numKey) <= 1) {
    if (byNum[numKey] != null && String(byNum[numKey]).trim() !== "") {
      return String(byNum[numKey]);
    }
  }

  if (idKey && numKey && idKey !== numKey && numberCollisionCount(tasks, numKey) <= 1) {
    const knownIds = Array.isArray(tasks) ? new Set(tasks.map((t) => String(t.id))) : null;
    if (!knownIds || !knownIds.has(numKey)) {
      const legacy = byId[numKey];
      if (legacy != null && String(legacy).trim() !== "") return String(legacy);
    }
  }
  return "";
}

export function liveStudentChecked(result, task, tasks) {
  const checked = result?.checked || {};
  if (task.id == null && task.number == null) return null;
  if (task.id != null) {
    if (checked[task.id] !== undefined) return checked[task.id];
    if (checked[String(task.id)] !== undefined) return checked[String(task.id)];
  }
  const numKey = task.number != null ? String(task.number) : "";
  // Нельзя брать checked по номеру, если в варианте несколько задач с одним №.
  if (numKey && numberCollisionCount(tasks, numKey) <= 1) {
    if (checked[numKey] !== undefined) return checked[numKey];
  }
  return null;
}

function buildTasks(answers) {
  const students = answers?.students || [];
  const rows = Array.isArray(answers?.tasks) ? answers.tasks : [];
  if (rows.length) {
    return [...rows]
      .map((t, index) => ({
        id: t.id,
        number: t.number != null ? t.number : index + 1,
        answer: t.answer || "",
      }))
      .sort((a, b) => (Number(a.number) || 0) - (Number(b.number) || 0));
  }
  const byIdKeys = new Set();
  students.forEach((row) => {
    const byId = row.result?.by_task_id || row.result?.byTaskId || {};
    Object.keys(byId).forEach((id) => {
      if (String(byId[id] ?? "").trim()) byIdKeys.add(id);
    });
  });
  if (byIdKeys.size) {
    return [...byIdKeys].map((id, index) => ({ id, number: index + 1, answer: "" }));
  }
  const nums = new Set();
  students.forEach((row) => {
    Object.keys(row.result?.by_number || row.result?.byNumber || {}).forEach((n) => nums.add(n));
  });
  return [...nums]
    .sort((a, b) => Number(a) - Number(b))
    .map((n) => ({ id: null, number: n, answer: "" }));
}

/**
 * Таблица ответов учеников по live-варианту на уроке.
 * @param {{ answers: object|null, loading?: boolean, compact?: boolean }} props
 */
export default function LiveVariantAnswersTable({ answers, loading = false, compact = false }) {
  const students = answers?.students || [];
  const tasks = useMemo(() => buildTasks(answers), [answers]);
  const subject = String(answers?.subject || "").toLowerCase();

  return (
    <section
      className={`live-variant-answers${compact ? " live-variant-answers--compact" : ""}`}
      aria-label="Ответы учеников"
      aria-busy={loading || undefined}
    >
      <div className="live-variant-answers__title">
        <strong>{answers?.title || "Вариант"} · ответы</strong>
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
                  <colgroup>
                    <col className="live-variant-answers__col-num" />
                    <col />
                    <col />
                    <col className="live-variant-answers__col-status" />
                  </colgroup>
                  <thead>
                    <tr>
                      <th>№</th>
                      <th>Ответ</th>
                      <th>Верный</th>
                      <th></th>
                    </tr>
                  </thead>
                  <tbody>
                    {tasks.map((task) => {
                      const value = liveStudentAnswer(result, task, tasks);
                      const ok = liveAnswerVerdict(result, task, tasks, subject);
                      const correct = stripAnswerHtml(task.answer);
                      return (
                        <tr key={`${row.studentId}-${task.id || task.number}`}>
                          <td>{task.number ?? "—"}</td>
                          <td className="live-variant-answers__pre">{value.trim() ? value : "—"}</td>
                          <td className="live-variant-answers__pre">{correct || "—"}</td>
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
