import { Fragment } from "react";
import { homeworkJournalStatusLabel, wasHomeworkSubmittedLate } from "../journal/homeworkStatus";
import LateHomeworkMark from "../journal/LateHomeworkMark";
import { TaskPosition } from "../../components/taskDocument/TaskNumber";
import { journalRowKey, startsVariantGroup } from "../homeworkVariants";

function formatPercentScore(score) {
  if (score == null || score === "") return null;
  const n = Number(score);
  if (Number.isNaN(n)) return null;
  return Number.isInteger(n) ? `${n}%` : `${n.toFixed(1)}%`;
}

/** Готовая карточка результата ДЗ или варианта: статус, балл и таблица ответов. */
export default function HomeworkResultBlock({
  result,
  showCorrectAnswer = true,
  hideHead = false,
}) {
  if (!result) return null;
  const tasks = Array.isArray(result.tasks) ? result.tasks : [];
  const scoreLabel = formatPercentScore(result.score_percent);
  const hasStatus = Boolean(result.status_label || result.status || result.submitted_at || result.is_overdue);
  const statusText = hasStatus ? homeworkJournalStatusLabel(result) : "";
  const late = wasHomeworkSubmittedLate(result);
  const hasBody =
    tasks.length > 0
    || Boolean(String(result.answer_text || "").trim())
    || Boolean(result.has_attached_file)
    || Boolean(String(result.teacher_comment || "").trim())
    || result.score_percent != null
    || Boolean(statusText);
  if (!hasBody) return null;
  return (
    <div className="jl-variant-result">
      {hideHead ? null : (
        <div className="jl-variant-result__head">
          <strong>{result.title || "Домашнее задание"}</strong>
          <span className="jg-status-cell">
            {statusText}
            {late ? <LateHomeworkMark /> : null}
            {scoreLabel ? (
              <span>
                {`${statusText || late ? " · " : ""}${
                  result.correct_count != null && result.checked_count != null
                    ? `${result.correct_count}/${result.checked_count} · `
                    : ""
                }${scoreLabel}`}
              </span>
            ) : null}
          </span>
        </div>
      )}
      {tasks.length ? (
        <div className="jl-variant-result__table-wrap">
          <table className="jl-variant-result__table">
            <thead>
              <tr>
                <th>№</th>
                <th>{showCorrectAnswer ? "Ответ ученика" : "Ваш ответ"}</th>
                {showCorrectAnswer ? <th>Правильный</th> : null}
                <th></th>
              </tr>
            </thead>
            <tbody>
              {tasks.map((task, index) => (
                <Fragment key={journalRowKey(`hw-${result.homework_id}`, task)}>
                {startsVariantGroup(tasks, index) ? (
                  <tr className="jl-variant-result__group">
                    <td colSpan={showCorrectAnswer ? 4 : 3}>Вариант №{task.variant_id}</td>
                  </tr>
                ) : null}
                <tr>
                  <td>
                    <TaskPosition
                      mode="result"
                      position={task.display_number ?? task.displayNumber ?? task.position ?? index + 1}
                      examNumber={task.number}
                      level={result.level}
                    />
                  </td>
                  <td>{String(task.student_answer || "").trim() || "—"}</td>
                  {showCorrectAnswer ? (
                    <td>{String(task.correct_answer || "").trim() || "—"}</td>
                  ) : null}
                  <td>
                    {task.ok === true ? (
                      <span className="jl-variant-result__ok">верно</span>
                    ) : task.ok === false ? (
                      <span className="jl-variant-result__bad">ошибка</span>
                    ) : (
                      "—"
                    )}
                  </td>
                </tr>
                </Fragment>
              ))}
            </tbody>
          </table>
        </div>
      ) : null}
      {String(result.answer_text || "").trim() ? (
        <p className="jl-hw-result-note">
          <strong>Ответ:</strong> {result.answer_text}
        </p>
      ) : null}
      {result.has_attached_file ? (
        <p className="jl-hw-result-note">Прикреплён файл</p>
      ) : null}
      {String(result.teacher_comment || "").trim() ? (
        <p className="jl-hw-result-note">
          <strong>Комментарий к ДЗ:</strong> {result.teacher_comment}
        </p>
      ) : null}
    </div>
  );
}
