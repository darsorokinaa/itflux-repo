import { PlaneIcon } from "./TravelMarks";
import { useVariantThemeLabels } from "./VariantThemeRoot";

function chunkRows(tasks, columns) {
  const rows = [];
  for (let i = 0; i < tasks.length; i += columns) {
    rows.push({
      items: tasks.slice(i, i + columns),
      rtl: Math.floor(i / columns) % 2 === 1,
    });
  }
  return rows;
}

function stopState({ task, index, activeIndex, activeId, checkedTasks, userAnswers }) {
  const done = checkedTasks[task.id] !== undefined
    || (userAnswers[task.id] != null && String(userAnswers[task.id]).trim() !== "");
  const current = String(task.id) === String(activeId);
  if (current) return "current";
  if (done || index < activeIndex) return "done";
  return "todo";
}

export default function ThemeNavigation({
  tasks = [],
  canGoPrev,
  canGoNext,
  onPrev,
  onNext,
  onFinish,
  hideFinish = false,
  finishLabel,
}) {
  const labels = useVariantThemeLabels();
  if (!tasks.length) return null;

  return (
    <div className="variant-theme-nav">
      <div className="variant-theme-nav__row">
        <button type="button" className="variant-theme-nav__btn" onClick={onPrev} disabled={!canGoPrev}>
          {labels.previous}
        </button>
        <button
          type="button"
          className="variant-theme-nav__btn variant-theme-nav__btn--primary"
          onClick={onNext}
          disabled={!canGoNext}
        >
          {labels.next}
        </button>
      </div>
      {!hideFinish && onFinish ? (
        <button type="button" className="variant-theme-nav__finish" onClick={onFinish}>
          {finishLabel || labels.finish}
        </button>
      ) : null}
    </div>
  );
}

export function ThemeRouteProgress({
  tasks = [],
  activeId,
  onSelect,
  checkedTasks = {},
  userAnswers = {},
  columns = 4,
}) {
  if (!tasks.length) return null;
  const activeIndex = Math.max(0, tasks.findIndex((task) => String(task.id) === String(activeId)));
  const rows = chunkRows(tasks, columns);
  const indexById = new Map(tasks.map((task, index) => [String(task.id), index]));

  return (
    <nav className="variant-theme-route" aria-label="Маршрут">
      {rows.map((row, rowIndex) => (
        <ol
          key={`route-row-${rowIndex}`}
          className={`variant-theme-route__row${row.rtl ? " is-rtl" : ""}`}
        >
          {row.items.map((task, stopIndex) => {
            const index = indexById.get(String(task.id)) ?? 0;
            const state = stopState({
              task,
              index,
              activeIndex,
              activeId,
              checkedTasks,
              userAnswers,
            });
            const number = task.displayNumber ?? task.number ?? index + 1;
            return (
              <li key={task.id} className={`variant-theme-route__stop variant-theme-route__stop--${state}`}>
                {stopIndex > 0 ? <span className="variant-theme-route__rail" aria-hidden="true" /> : null}
                <button
                  type="button"
                  className="variant-theme-route__dot"
                  onClick={() => onSelect?.(task.id)}
                  aria-current={state === "current" ? "step" : undefined}
                  aria-label={`Остановка ${number}`}
                >
                  {number}
                </button>
                {state === "current" ? (
                  <span className="variant-theme-route__plane" aria-hidden="true">
                    <PlaneIcon />
                  </span>
                ) : null}
              </li>
            );
          })}
        </ol>
      ))}
    </nav>
  );
}
