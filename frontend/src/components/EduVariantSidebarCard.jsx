/**
 * Карточка сайдбара варианта (таймер, прогресс, номера, инструменты, завершение).
 * Используется в десктопном aside и в мобильном bottom-sheet.
 */
import { useEffect, useMemo, useState, useSyncExternalStore } from "react";
function SidebarTimerControls({ store, formatTimer }) {
  const timerStatus = useSyncExternalStore(store.subscribe, store.getStatus, store.getStatus);
  const seconds = useSyncExternalStore(store.subscribe, store.getSeconds, store.getSeconds);

  return (
    <>
      <strong className="exam-edu-timer-card__value">{formatTimer(seconds)}</strong>
      <div className="exam-edu-timer-card__actions">
        {(timerStatus === "idle" || timerStatus === "paused") && (
          <button
            type="button"
            className="exam-edu-timer-btn exam-edu-timer-btn--start"
            onClick={() => store.setStatus("running")}
            title="Старт"
          >
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
              <polygon points="5 3 19 12 5 21 5 3" />
            </svg>
          </button>
        )}
        {timerStatus === "running" && (
          <button
            type="button"
            className="exam-edu-timer-btn exam-edu-timer-btn--pause"
            onClick={() => store.setStatus("paused")}
            title="Пауза"
          >
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
              <rect x="6" y="4" width="4" height="16" />
              <rect x="14" y="4" width="4" height="16" />
            </svg>
          </button>
        )}
        <button
          type="button"
          className="exam-edu-timer-btn exam-edu-timer-btn--reset"
          onClick={() => {
            store.setStatus("idle");
            store.reset();
          }}
          title="Сброс"
          disabled={timerStatus === "idle" && seconds === 0}
        >
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
            <rect x="6" y="6" width="12" height="12" />
          </svg>
        </button>
      </div>
    </>
  );
}

const TASK_NAV_PAGE_SIZE = 25;

export default function EduVariantSidebarCard({
  formatTimer,
  timerStore,
  mode,
  fullyCorrectTaskCount,
  taskCountTotal,
  totalScore,
  maxScore,
  part2Tasks,
  sidebarProgressPct,
  navTasksOrdered,
  activeNavTaskId,
  examNavBtnClass,
  goToExamTask,
  onAfterNavTask,
  supportItems,
  onOpenSupport,
  hideFinish,
  onFinish,
  progressPart1Only = false,
  finishLabel,
  finishDisabled = false,
  finishBusy = false,
  submittedMessage = "",
}) {
  const taskTotal = navTasksOrdered.length;
  const needTaskPaging = taskTotal > TASK_NAV_PAGE_SIZE;
  const pageCount = needTaskPaging ? Math.ceil(taskTotal / TASK_NAV_PAGE_SIZE) : 1;

  const [taskNavPage, setTaskNavPage] = useState(0);

  useEffect(() => {
    if (!needTaskPaging || activeNavTaskId == null) return;
    const idx = navTasksOrdered.findIndex((t) => t.id === activeNavTaskId);
    if (idx < 0) return;
    const page = Math.floor(idx / TASK_NAV_PAGE_SIZE);
    setTaskNavPage(page);
  }, [activeNavTaskId, needTaskPaging, navTasksOrdered]);

  const pagedNavTasks = useMemo(() => {
    if (!needTaskPaging) return navTasksOrdered;
    const start = taskNavPage * TASK_NAV_PAGE_SIZE;
    return navTasksOrdered.slice(start, start + TASK_NAV_PAGE_SIZE);
  }, [navTasksOrdered, needTaskPaging, taskNavPage]);

  const rangeLabel = useMemo(() => {
    if (!needTaskPaging) return null;
    const from = taskNavPage * TASK_NAV_PAGE_SIZE + 1;
    const to = Math.min((taskNavPage + 1) * TASK_NAV_PAGE_SIZE, taskTotal);
    return `${from}–${to} из ${taskTotal}`;
  }, [needTaskPaging, taskNavPage, taskTotal]);

  return (
    <div className="exam-edu-side-card">
      <div className="exam-edu-side-section exam-edu-side-section--timer">
        <span className="exam-edu-side-section__eyebrow">Время выполнения</span>
        <SidebarTimerControls store={timerStore} formatTimer={formatTimer} />
      </div>

      <div className="exam-edu-side-section exam-edu-side-section--progress">
        <span className="exam-edu-side-section__eyebrow">Прогресс</span>
        <strong className="exam-edu-progress-head">
          {mode === "test" ? (
            <>
              {fullyCorrectTaskCount} / {taskCountTotal}
            </>
          ) : (
            <>
              {totalScore} / {maxScore}
            </>
          )}
        </strong>
        <span className="exam-edu-progress-caption">
          {mode === "test"
            ? "правильных ответов"
            : progressPart1Only
              ? "дано ответов"
              : part2Tasks.length === 0
                ? "правильных ответов"
                : "баллов из максимума"}
        </span>
        <div className="exam-edu-progress-track" aria-hidden="true">
          <div className="exam-edu-progress-fill" style={{ width: `${sidebarProgressPct}%` }} />
        </div>
      </div>

      <div className="exam-edu-side-section exam-edu-side-section--tasks">
        <span className="exam-edu-side-section__eyebrow">Задания</span>
        <div className="exam-edu-task-nav-wrap">
          <div className="exam-edu-task-nav" role="navigation" aria-label="Номера заданий">
            {pagedNavTasks.map((t) => (
              <button
                key={t.id}
                type="button"
                className={examNavBtnClass(t)}
                onClick={(e) => {
                  e.stopPropagation();
                  goToExamTask(t.id);
                  onAfterNavTask?.();
                }}
              >
                {t.number}
              </button>
            ))}
          </div>
        </div>
      </div>

      {supportItems?.length > 0 ? (
        <div className="exam-edu-side-section exam-edu-side-section--tools">
          <span className="exam-edu-side-section__eyebrow">Инструменты</span>
          <div className="exam-edu-tools-list">
            <button
              type="button"
              className="exam-edu-tool-btn exam-edu-tool-btn--support"
              onClick={onOpenSupport}
              title="Справочная информация"
            >
              <span className="exam-edu-tool-btn__icon exam-edu-tool-btn__icon--help" aria-hidden="true">
                ?
              </span>
              <span className="exam-edu-tool-btn__text">Справочная информация</span>
            </button>
          </div>
        </div>
      ) : null}

      {needTaskPaging ? (
        <div className="exam-edu-side-section exam-edu-side-section--task-pager">
          <div className="exam-edu-task-nav-pager" aria-label="Страницы списка заданий">
            <button
              type="button"
              className="exam-edu-task-nav-pager__btn"
              disabled={taskNavPage <= 0}
              onClick={() => setTaskNavPage((p) => Math.max(0, p - 1))}
              aria-label="Предыдущие задания"
            >
              ‹
            </button>
            <span className="exam-edu-task-nav-pager__label">{rangeLabel}</span>
            <button
              type="button"
              className="exam-edu-task-nav-pager__btn"
              disabled={taskNavPage >= pageCount - 1}
              onClick={() => setTaskNavPage((p) => Math.min(pageCount - 1, p + 1))}
              aria-label="Следующие задания"
            >
              ›
            </button>
          </div>
        </div>
      ) : null}

      {!hideFinish && (
        submittedMessage ? (
          <p className="exam-edu-sidebar-finish-note">{submittedMessage}</p>
        ) : (
          <button
            type="button"
            className="exam-edu-btn exam-edu-btn--finish exam-edu-sidebar-finish"
            onClick={onFinish}
            disabled={finishDisabled || finishBusy}
          >
            {finishBusy ? "Отправка…" : (finishLabel || "Завершить вариант")}
          </button>
        )
      )}
    </div>
  );
}
