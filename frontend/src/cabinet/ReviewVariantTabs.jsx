import {
  homeworkTaskAnswer,
  homeworkTaskAttachments,
  inferExamTaskPart,
} from "./cabinetReviewUtils";
import { scoreVariantAttempt, tasksForStoredAttempt } from "../utils/variantResult";
import { variantLabel, variantScoringSummary } from "./homeworkVariants";

/** r75: вкладки вариантов ДЗ с итогом каждого — ни один вариант не прячется за первым. */
export default function ReviewVariantTabs({ variantParts, activeId, onSelect, result, scores }) {
  if (!Array.isArray(variantParts) || variantParts.length < 2) return null;
  return (
    <nav className="rv-variant-tabs" aria-label="Варианты в домашнем задании">
      {variantParts.map((parts, index) => {
        const { row } = parts;
        const all = [...parts.part1, ...parts.part2];
        const answered = all.filter((task) => {
          const answer = homeworkTaskAnswer(parts.result, task.id, task.number, all);
          const files = homeworkTaskAttachments(parts.result, task.id, task.number);
          return Boolean(String(answer || "").trim()) || files.length > 0;
        }).length;
        const stored = variantScoringSummary(result, row.variantId);
        const live = all.length
          ? scoreVariantAttempt({
            tasks: tasksForStoredAttempt(all.map((task) => ({
              ...task,
              part: inferExamTaskPart(task, parts.level, parts.subject),
            })), parts.result, parts.level, parts.subject),
            level: parts.level,
            subject: parts.subject,
            answers: Object.fromEntries(all.map((task) => [
              task.id,
              homeworkTaskAnswer(parts.result, task.id, task.number, all),
            ])),
            scores,
          })
          : null;
        const earned = live ? live.earned_points : stored?.earned_points;
        const possible = live ? live.max_points : stored?.max_points;
        const isOn = row.variantId === activeId;
        return (
          <button
            key={row.variantId}
            type="button"
            className={`rv-variant-tab${isOn ? " is-on" : ""}`}
            aria-pressed={isOn}
            onClick={() => onSelect(row.variantId)}
          >
            <b>{variantLabel(row, index)}</b>
            <small>
              {all.length ? `Ответов ${answered} из ${all.length}` : "Загрузка…"}
              {possible != null ? ` · ${earned ?? 0} из ${possible} баллов` : ""}
            </small>
          </button>
        );
      })}
    </nav>
  );
}
