import {
  buildStudentHomeworkReviewRows,
  computeHomeworkReviewSummary,
  formatHomeworkVerdict,
  homeworkTaskAnswer,
  homeworkTaskComment,
  homeworkTaskScore,
  homeworkTeacherAttachments,
  resolvePart1Verdict,
  taskMaxScore,
} from "./cabinetReviewUtils";

function normalizeMediaUrl(url) {
  if (!url) return "";
  if (typeof window === "undefined") return url;
  let normalized = url;
  if (normalized.startsWith("http://127.0.0.1:8000")) {
    normalized = normalized.replace("http://127.0.0.1:8000", "");
  } else if (normalized.startsWith("http://localhost:8000")) {
    normalized = normalized.replace("http://localhost:8000", "");
  }
  return normalized;
}

function FileLinks({ files, label, emptyLabel }) {
  if (!files?.length) {
    return emptyLabel ? <span className="hw-review-empty">{emptyLabel}</span> : null;
  }
  return (
    <div className="hw-review-files">
      {label ? <span className="hw-review-files__label">{label}</span> : null}
      <ul className="hw-review-files__list">
        {files.map((file) => {
          const isAudio = /\.(mp3|wav|ogg|aac|flac|m4a)$/i.test(file.filename || file.url || "");
          const normalizedUrl = normalizeMediaUrl(file.url);
          if (isAudio) {
            return (
              <li key={file.url} className="hw-review-files__item--audio">
                <audio controls src={normalizedUrl} className="hw-review-audio-player" preload="metadata">
                  Ваш браузер не поддерживает элемент <code>audio</code>.
                </audio>
              </li>
            );
          }
          return (
            <li key={file.url}>
              <a href={normalizedUrl} target="_blank" rel="noreferrer">
                {file.filename || "Файл"}
              </a>
            </li>
          );
        })}
      </ul>
    </div>
  );
}

function SummaryStat({ label, main, sub }) {
  return (
    <div className="hw-review-summary__stat">
      <span className="hw-review-summary__stat-label">{label}</span>
      <strong className="hw-review-summary__stat-main">{main}</strong>
      {sub ? <span className="hw-review-summary__stat-sub">{sub}</span> : null}
    </div>
  );
}

function ReviewSummary({ summary }) {
  if (!summary?.total) return null;
  const { part1, part2 } = summary;

  return (
    <div className="hw-review-summary">
      <div className="hw-review-summary__grid">
        <SummaryStat
          label="Выполнено"
          main={`${summary.completed} из ${summary.total}`}
          sub={`${summary.completedPct}% от всех заданий`}
        />
        <SummaryStat
          label="Верно"
          main={`${summary.correct} из ${summary.completed || summary.total}`}
          sub={`${summary.correctOfCompletedPct}% от выполненных · ${summary.correctOfTotalPct}% от всех`}
        />
      </div>

      {part1.total > 0 ? (
        <div className="hw-review-summary__part">
          <h3 className="hw-review-summary__part-title">Часть 1</h3>
          <div className="hw-review-summary__part-grid">
            <SummaryStat
              label="Выполнено"
              main={`${part1.completed} из ${part1.total}`}
              sub={`${part1.completedPct}%`}
            />
            <SummaryStat
              label="Верно"
              main={`${part1.correct} из ${part1.completed || part1.total}`}
              sub={`${part1.correctOfCompletedPct}% от выполненных · ${part1.correctOfTotalPct}% от всех`}
            />
          </div>
        </div>
      ) : null}

      {part2.total > 0 ? (
        <div className="hw-review-summary__part">
          <h3 className="hw-review-summary__part-title">Часть 2</h3>
          <div className="hw-review-summary__part-grid">
            <SummaryStat
              label="Сдано"
              main={`${part2.completed} из ${part2.total}`}
              sub={`${part2.completedPct}%`}
            />
            <SummaryStat
              label="Баллы"
              main={`${part2.scoreSum} из ${part2.maxSum}`}
              sub={`${part2.scorePct}% · полный балл: ${part2.correct} из ${part2.total}`}
            />
          </div>
        </div>
      ) : null}
    </div>
  );
}

function Part1Table({ rows }) {
  if (!rows?.length) return null;
  return (
    <div className="hw-review-block">
      <h3 className="hw-review-block__title">Часть 1 — краткий ответ</h3>
      <div className="hw-review-table-wrap">
        <table className="hw-review-table">
          <thead>
            <tr>
              <th>№ п/п</th>
              <th>Задание</th>
              <th>Ответ ученика</th>
              <th>Правильный ответ</th>
              <th>Решения</th>
              <th>Результат</th>
              <th>Комментарий</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row, index) => (
              <tr key={row.taskId}>
                <td className="hw-review-table__ord">{index + 1}</td>
                <td>{row.number}</td>
                <td className="hw-review-table__pre">{row.answer || "—"}</td>
                <td className="hw-review-table__pre">{row.correctAnswer || "—"}</td>
                <td>
                  <FileLinks files={row.studentFiles} emptyLabel="—" />
                </td>
                <td>
                  <span className={`hw-review-verdict hw-review-verdict--${
                    row.verdict === true ? "ok" : row.verdict === false ? "bad" : "empty"
                  }`}
                  >
                    {formatHomeworkVerdict(row.verdict)}
                  </span>
                </td>
                <td>
                  {row.comment || "—"}
                  <FileLinks files={row.teacherFiles} label="Файлы учителя" />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function Part2Table({ rows }) {
  if (!rows?.length) return null;
  return (
    <div className="hw-review-block">
      <h3 className="hw-review-block__title">Часть 2 — развёрнутый ответ</h3>
      <div className="hw-review-table-wrap">
        <table className="hw-review-table">
          <thead>
            <tr>
              <th>№ п/п</th>
              <th>Задание</th>
              <th>Ответ ученика</th>
              <th>Правильный ответ</th>
              <th>Решения</th>
              <th>Баллы</th>
              <th>Комментарий</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row, index) => (
              <tr key={row.taskId}>
                <td className="hw-review-table__ord">{index + 1}</td>
                <td>{row.number}</td>
                <td className="hw-review-table__pre">{row.answer || "—"}</td>
                <td className="hw-review-table__pre">{row.correctAnswer || "—"}</td>
                <td>
                  <FileLinks files={row.studentFiles} emptyLabel="—" />
                </td>
                <td>
                  {row.score === "" || row.score == null
                    ? "—"
                    : `${row.score} / ${row.maxScore}`}
                </td>
                <td>
                  {row.comment || "—"}
                  <FileLinks files={row.teacherFiles} label="Разбор ошибок" />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

export function HomeworkReviewSummary({ review, className = "", title = "Результаты проверки" }) {
  const summary = computeHomeworkReviewSummary(review);
  if (!summary?.total) return null;
  return (
    <div className={className}>
      {title ? <h2 className="hw-review-results__title">{title}</h2> : null}
      <ReviewSummary summary={summary} />
    </div>
  );
}

export default function HomeworkReviewResults({
  review,
  teacherComment: teacherCommentProp,
  className = "",
  id,
}) {
  if (!review) return null;
  const teacherComment = teacherCommentProp || review.teacherComment || "";
  const hasPart1 = review.part1?.length > 0;
  const hasPart2 = review.part2?.length > 0;
  if (!hasPart1 && !hasPart2 && !teacherComment) return null;

  const summary = computeHomeworkReviewSummary(review);

  return (
    <section
      id={id}
      className={`hw-review-results${className ? ` ${className}` : ""}`}
    >
      <h2 className="hw-review-results__title">Результаты проверки</h2>
      <ReviewSummary summary={summary} />
      {teacherComment ? (
        <div className="hw-review-results__teacher">
          <span className="hw-review-results__teacher-label">Комментарий учителя</span>
          <p>{teacherComment}</p>
        </div>
      ) : null}
      <Part1Table rows={review.part1} />
      <Part2Table rows={review.part2} />
    </section>
  );
}

export function HomeworkTaskReviewNote({ task, result, level, subject, part }) {
  if (!result || typeof result !== "object" || !task) return null;

  const answer = homeworkTaskAnswer(result, task.id, task.number);
  const comment = homeworkTaskComment(result, task.id, task.number);
  const teacherFiles = homeworkTeacherAttachments(result, task.id, task.number);

  let verdict = null;
  let score = "";
  let maxScore = null;

  if (part === 1) {
    verdict = resolvePart1Verdict(task, answer, result, subject);
  } else {
    score = homeworkTaskScore(result, task.id);
    maxScore = taskMaxScore(task);
  }

  const hasContent = part === 1
    ? verdict !== null || comment || teacherFiles.length
    : (score !== "" && score != null) || comment || teacherFiles.length;
  if (!hasContent) return null;

  return (
    <div className="hw-review-task-note">
      {part === 1 && verdict !== null ? (
        <p className={`hw-review-verdict hw-review-verdict--${
          verdict === true ? "ok" : verdict === false ? "bad" : "empty"
        }`}
        >
          {formatHomeworkVerdict(verdict)}
        </p>
      ) : null}
      {part === 2 && score !== "" && score != null ? (
        <p className="hw-review-task-note__score">
          Баллы: <strong>{score}</strong> из {maxScore}
        </p>
      ) : null}
      {comment ? (
        <p className="hw-review-task-note__comment">
          <span>Комментарий учителя:</span> {comment}
        </p>
      ) : null}
      <FileLinks files={teacherFiles} label="Файлы с разбором" />
    </div>
  );
}

export function buildHomeworkReviewFromVariant(variantTasks, result, level, subject) {
  return buildStudentHomeworkReviewRows(variantTasks, result, level, subject);
}
