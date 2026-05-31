import { useSyncExternalStore } from "react";

/** Только цифры таймера — перерисовка раз в секунду, не весь ExamPage. */
export function ExamVariantTimerReadout({ store, formatTimer, className, as = "span" }) {
  const seconds = useSyncExternalStore(store.subscribe, store.getSeconds, store.getSeconds);
  const Tag = as;
  return <Tag className={className}>{formatTimer(seconds)}</Tag>;
}

/** Фиксированный уголок: таймер + кнопки, без ре-рендера ExamPage каждую секунду. */
export function ExamVariantFixedTimer({ store, formatTimer }) {
  const timerStatus = useSyncExternalStore(store.subscribe, store.getStatus, store.getStatus);
  const seconds = useSyncExternalStore(store.subscribe, store.getSeconds, store.getSeconds);

  return (
    <div className="variant-timer exam-fixed-timer">
      <div className="variant-timer-display">{formatTimer(seconds)}</div>
      <div className="variant-timer-actions">
        {(timerStatus === "idle" || timerStatus === "paused") && (
          <button
            type="button"
            className="variant-timer-btn variant-timer-btn-start"
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
            className="variant-timer-btn variant-timer-btn-pause"
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
          className="variant-timer-btn variant-timer-btn-stop"
          onClick={() => {
            store.setStatus("idle");
            store.reset();
          }}
          title="Стоп"
          disabled={timerStatus === "idle" && seconds === 0}
        >
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
            <rect x="6" y="6" width="12" height="12" />
          </svg>
        </button>
      </div>
    </div>
  );
}

export default ExamVariantTimerReadout;
