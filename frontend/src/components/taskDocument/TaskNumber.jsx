import { resolveTaskPosition } from "../../utils/taskDocument";
import { useVariantThemeLabels } from "../../variantThemes/VariantThemeRoot";

/**
 * Единое отображение позиции задания в наборе и номера по экзамену/банку.
 *
 * mode:
 *   card    — список/карточка: крупная позиция, мелко «ЕГЭ №15»
 *   viewer  — одно открытое задание: «Задание 4 из 12» и ниже экзамен
 *   review  — проверка ДЗ: как viewer
 *   compact — таблицы/навигация: «4 · ЕГЭ №15»
 *   result  — результаты: позиция + вторичный экзамен столбиком
 *   print   — печать/PDF: «4.» + «ЕГЭ №15»
 */
export function TaskPosition({
  position,
  displayNumber,
  index,
  total,
  examNumber,
  task = null,
  level,
  topic,
  mode = "card",
  id,
  showMeta = false,
  metaExtra = null,
  className = "",
  children,
}) {
  const labels = useVariantThemeLabels();
  const model = resolveTaskPosition({
    position,
    displayNumber,
    index,
    total,
    examNumber,
    task,
    level,
    topic,
    taskLabel: labels.task,
  });
  const shown = model.position;
  const examText = model.examLabel;
  const topicText = !examText ? model.topic : "";
  const safeMode = ["compact", "card", "viewer", "review", "print", "result"].includes(mode)
    ? mode
    : "card";

  if (shown == null && !examText && !topicText && !model.progressLabel) {
    return null;
  }

  const rootClass = `tdoc-pos tdoc-pos--${safeMode} ${className}`.trim();

  if (safeMode === "viewer" || safeMode === "review") {
    return (
      <div className={rootClass} aria-label={model.ariaLabel || undefined}>
        <div className="tdoc-pos__text">
          {model.progressLabel ? (
            <strong className="tdoc-pos__progress">{model.progressLabel}</strong>
          ) : shown != null ? (
            <strong className="tdoc-pos__progress">{labels.task} {shown}</strong>
          ) : null}
          {examText ? <span className="tdoc-pos__exam">{examText}</span> : null}
          {topicText ? <span className="tdoc-pos__exam">{topicText}</span> : null}
        </div>
        {children}
      </div>
    );
  }

  if (safeMode === "compact") {
    return (
      <span className={rootClass} aria-label={model.ariaLabel || undefined}>
        {shown != null ? <span className="tdoc-pos__num">{shown}</span> : null}
        {shown != null && examText ? <span className="tdoc-pos__dot" aria-hidden="true"> · </span> : null}
        {examText ? <span className="tdoc-pos__exam">{examText}</span> : null}
        {!examText && topicText ? <span className="tdoc-pos__exam">{topicText}</span> : null}
        {children}
      </span>
    );
  }

  if (safeMode === "result") {
    return (
      <div className={rootClass} aria-label={model.ariaLabel || undefined}>
        {shown != null ? <span className="tdoc-pos__num">{shown}</span> : null}
        {examText ? <span className="tdoc-pos__exam">{examText}</span> : null}
        {children}
      </div>
    );
  }

  if (safeMode === "print") {
    return (
      <div className={rootClass} aria-label={model.ariaLabel || undefined}>
        {shown != null ? <div className="tdoc-pos__num">{shown}.</div> : null}
        <div className="tdoc-pos__text">
          {examText ? <span className="tdoc-pos__exam">{examText}</span> : null}
          {topicText ? <span className="tdoc-pos__exam">{topicText}</span> : null}
        </div>
        {children}
      </div>
    );
  }

  return (
    <div className={`exam-task-card__title-block tdoc-task__heading ${rootClass}`.trim()} aria-label={model.ariaLabel || undefined}>
      {shown != null ? (
        <div className="exam-task-card__num tdoc-task__num tdoc-pos__num" aria-hidden="true">
          {shown}
        </div>
      ) : null}
      <div className="exam-task-card__title-text tdoc-pos__text">
        {examText ? <strong className="tdoc-pos__exam">{examText}</strong> : null}
        {!examText && topicText ? <strong className="tdoc-pos__exam">{topicText}</strong> : null}
        {!examText && !topicText && shown != null ? (
          <strong className="tdoc-pos__fallback">{labels.task} {shown}</strong>
        ) : null}
        {showMeta ? (
          <span className="exam-task-card__meta tdoc-pos__meta">
            ID {id}
            {metaExtra}
          </span>
        ) : null}
      </div>
      {children}
    </div>
  );
}

export default function TaskNumber(props) {
  return <TaskPosition mode={props.mode || "card"} {...props} />;
}
