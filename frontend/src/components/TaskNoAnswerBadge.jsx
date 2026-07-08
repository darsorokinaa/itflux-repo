import { useCallback, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";

const DEFAULT_HINT = "Ответ к заданию пока не добавлен в базу";

function WarningTriangleIcon() {
  return (
    <svg viewBox="0 0 24 24" className="task-no-answer-badge__icon" aria-hidden="true">
      <path
        d="M12 3.4 L21.6 20.2 H2.4 Z"
        fill="#FEF3C7"
        stroke="#F5A524"
        strokeWidth="1.6"
        strokeLinejoin="round"
      />
      <path d="M12 9.6 V14" stroke="#B45309" strokeWidth="1.7" strokeLinecap="round" />
      <circle cx="12" cy="16.9" r="1.05" fill="#B45309" />
    </svg>
  );
}

/**
 * Подсказка рендерится через портал в document.body с position:fixed,
 * чтобы она всегда была поверх остального интерфейса и не зависела от
 * z-index/overflow родительских контейнеров (карточек, списков и т.д.).
 */
export default function TaskNoAnswerBadge({ hint = DEFAULT_HINT }) {
  const anchorRef = useRef(null);
  const [visible, setVisible] = useState(false);
  const [coords, setCoords] = useState(null);

  const updatePosition = useCallback(() => {
    const el = anchorRef.current;
    if (!el) return;
    const rect = el.getBoundingClientRect();
    setCoords({ top: rect.top - 7, left: rect.left + rect.width / 2 });
  }, []);

  const show = useCallback(() => {
    updatePosition();
    setVisible(true);
  }, [updatePosition]);

  const hide = useCallback(() => setVisible(false), []);

  useLayoutEffect(() => {
    if (!visible) return undefined;
    updatePosition();
    const onReposition = () => updatePosition();
    window.addEventListener("scroll", onReposition, true);
    window.addEventListener("resize", onReposition);
    return () => {
      window.removeEventListener("scroll", onReposition, true);
      window.removeEventListener("resize", onReposition);
    };
  }, [visible, updatePosition]);

  return (
    <span
      ref={anchorRef}
      className="task-no-answer-hint"
      tabIndex={0}
      aria-label={hint}
      onMouseEnter={show}
      onMouseLeave={hide}
      onFocus={show}
      onBlur={hide}
    >
      <span className="task-no-answer-badge" aria-hidden="true">
        <WarningTriangleIcon />
      </span>
      {visible && coords && typeof document !== "undefined"
        ? createPortal(
            <span
              className="task-no-answer-hint__tooltip"
              role="tooltip"
              style={{ top: coords.top, left: coords.left }}
            >
              {hint}
            </span>,
            document.body
          )
        : null}
    </span>
  );
}
