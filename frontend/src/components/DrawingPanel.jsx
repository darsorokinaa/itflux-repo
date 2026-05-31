import { useCallback, useEffect, useRef, useState } from "react";

const STROKE_PALETTE = [
  { label: "Тёмный", color: "#1e293b" },
  { label: "Индиго", color: "#4f46e5" },
  { label: "Бирюза", color: "#0d9488" },
  { label: "Красный", color: "#dc2626" },
  { label: "Янтарь", color: "#ca8a04" },
];

const WIDTH_PRESETS = [2.5, 4.5, 7.5];

/** Единый вес линии для иконок вне `.toolbar-row1`. */
const SW = 1.65;

const R1_SW = 1.5;
const R1 = { cap: "round", join: "round" };

export const ERASER_CURSOR_CSS =
  'url("data:image/svg+xml,' +
  encodeURIComponent(
    `<svg xmlns="http://www.w3.org/2000/svg" width="32" height="32" viewBox="0 0 32 32">` +
      `<circle cx="16" cy="16" r="11" fill="none" stroke="%23334155" stroke-width="2"/>` +
      `<circle cx="16" cy="16" r="2.25" fill="%23334155"/>` +
      `<path d="M16 5v22M5 16h22" stroke="%2364748b" stroke-width="1.25" stroke-linecap="round" opacity="0.85"/>` +
    `</svg>`
  ) +
  '") 16 16, crosshair';

/** `.toolbar-row1`: viewBox 16×16, stroke 1.5, stroke-only (delete-all uses #EF4444). */

function Row1IconCursor() {
  return (
    <svg width="18" height="18" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <path d="M3.5 2 L3.5 11.5 L6.2 9.2 L8 13.5 L9.8 12.7 L8 8.5 L11.5 8.5 Z" />
    </svg>
  );
}

function Row1IconPencil() {
  return (
    <svg width="18" height="18" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <path d="M11 2.5 L13.5 5 L5.5 13 L2.5 13.5 L3 10.5 Z" />
      <line x1="9" y1="4.5" x2="11.5" y2="7" />
    </svg>
  );
}

function Row1IconEraser() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.25" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <path d="m7 21-4.3-4.3c-1-1-1-2.5 0-3.4l9.6-9.6c1-1 2.5-1 3.4 0l5.6 5.6c1 1 1 2.5 0 3.4L13 21" />
      <path d="M22 21H7" />
      <path d="m5 11 9 9" />
    </svg>
  );
}

function Row1IconShapes() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.25" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <path d="M8.3 10a.7.7 0 0 1-.626-1.079L11.4 3a.7.7 0 0 1 1.198-.043L16.3 8.9a.7.7 0 0 1-.572 1.1Z" />
      <rect x="3" y="14" width="7" height="7" rx="1" />
      <circle cx="17.5" cy="17.5" r="3.5" />
    </svg>
  );
}

function Row1IconUndo() {
  return (
    <svg width="18" height="18" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <path d="M2.5 7 C2.5 4 5 2 8 2 C11.5 2 14 4.5 14 8 C14 11.5 11.5 14 8 14" />
      <polyline points="2.5 3.5 2.5 7 6 7" />
    </svg>
  );
}

function Row1IconRedo() {
  return (
    <svg width="18" height="18" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <path d="M13.5 7 C13.5 4 11 2 8 2 C4.5 2 2 4.5 2 8 C2 11.5 4.5 14 8 14" />
      <polyline points="13.5 3.5 13.5 7 10 7" />
    </svg>
  );
}

function Row1IconGrid() {
  return (
    <svg width="18" height="18" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <rect x="2" y="2" width="12" height="12" rx="1.5" />
      <line x1="8" y1="2" x2="8" y2="14" />
      <line x1="2" y1="8" x2="14" y2="8" />
    </svg>
  );
}

function Row1IconDeleteAll() {
  return (
    <svg width="18" height="18" viewBox="0 0 16 16" fill="none" stroke="#EF4444" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <line x1="2" y1="4.5" x2="14" y2="4.5" />
      <path d="M5.5 4.5 V3 C5.5 2.4 6 2 6.5 2 H9.5 C10 2 10.5 2.4 10.5 3 V4.5" />
      <path d="M4 4.5 L4.5 13 C4.5 13.6 5 14 5.5 14 H10.5 C11 14 11.5 13.6 11.5 13 L12 4.5" />
      <line x1="7" y1="7" x2="7" y2="11.5" />
      <line x1="9.5" y1="7" x2="9.5" y2="11.5" />
    </svg>
  );
}

function IconPencil({ size = 18 }) {
  return (
    <svg viewBox="0 0 24 24" width={size} height={size} fill="none" stroke="currentColor" strokeWidth={SW} aria-hidden="true">
      <path d="M12 19h9" strokeLinecap="round" />
      <path d="M14.83 4.17 19 8.34 8.34 19H4v-4.34L14.83 4.17z" strokeLinejoin="round" />
      <path d="M16.5 2.5l5 5" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

function IconCollapse({ size = 18 }) {
  return (
    <svg viewBox="0 0 24 24" width={size} height={size} fill="none" stroke="currentColor" strokeWidth={SW} aria-hidden="true">
      <path d="M18 15l-6-6-6 6" strokeLinecap="round" strokeLinejoin="round" />
      <path d="M12 9v12" strokeLinecap="round" />
    </svg>
  );
}

/**
 * Кнопка-карандаш в шапке карточки задания (только иконка).
 */
export function ExamTaskDrawingHeaderButton({ onClick, title = "Черновик" }) {
  return (
    <button
      type="button"
      className="exam-task-draw-header-pencil"
      onClick={(e) => {
        e.stopPropagation();
        onClick?.();
      }}
      title={title}
      aria-label={title}
    >
      <IconPencil />
    </button>
  );
}

/**
 * Панель инструментов черновика в карточке (фон #F8F7FF, граница #EDE9FE).
 */
export default function DrawingPanel({
  tool,
  shapeKind,
  onToolChange,
  onShapeKindChange,
  strokeColor,
  onStrokeColor,
  strokeWidth,
  onStrokeWidth,
  onUndo,
  onRedo,
  redoDisabled = true,
  onClearAll,
  onClosePanel,
  extraDrawingPad,
  onExtraDrawingPadChange,
}) {
  const [shapesOpen, setShapesOpen] = useState(false);
  const popRef = useRef(null);

  useEffect(() => {
    if (!shapesOpen) return undefined;
    const onDoc = (e) => {
      if (popRef.current && !popRef.current.contains(e.target)) setShapesOpen(false);
    };
    document.addEventListener("pointerdown", onDoc, true);
    return () => document.removeEventListener("pointerdown", onDoc, true);
  }, [shapesOpen]);

  const pickShape = useCallback(
    (kind) => {
      onShapeKindChange?.(kind);
      onToolChange?.("shape");
      setShapesOpen(false);
    },
    [onShapeKindChange, onToolChange]
  );

  const dotSizeForWidth = (w) => `${Math.max(4, Math.round((6 + w) / 2))}px`;

  return (
    <div
      className="exam-drawing-panel"
      onClick={(e) => e.stopPropagation()}
      role="toolbar"
      aria-label="Черновик к заданию"
    >
      <div className="exam-drawing-panel__row">
        <div className="exam-drawing-panel__tools-main">
          <div className="toolbar-row1">
            <button
              type="button"
              className={`toolbar-row1__btn${tool === "cursor" ? " is-active" : ""}`}
              onClick={() => onToolChange?.("cursor")}
              title="Курсор — прокрутка и выделение текста"
              aria-label="Курсор"
            >
              <Row1IconCursor />
            </button>

            <button
              type="button"
              className={`toolbar-row1__btn${tool === "pencil" ? " is-active" : ""}`}
              onClick={() => onToolChange?.("pencil")}
              title="Карандаш"
              aria-label="Карандаш"
            >
              <Row1IconPencil />
            </button>

            <button
              type="button"
              className={`toolbar-row1__btn${tool === "eraser" ? " is-active" : ""}`}
              onClick={() => onToolChange?.("eraser")}
              title="Ластик"
              aria-label="Ластик"
            >
              <Row1IconEraser />
            </button>

            <div className="exam-drawing-panel__shapes-wrap" ref={popRef}>
              <button
                type="button"
                className={`toolbar-row1__btn${tool === "shape" ? " is-active" : ""}`}
                onClick={() => {
                  onToolChange?.("shape");
                  setShapesOpen((v) => !v);
                }}
                title="Фигуры"
                aria-expanded={shapesOpen}
                aria-haspopup="true"
                aria-label="Фигуры"
              >
                <Row1IconShapes />
              </button>
              {shapesOpen && (
                <div className="exam-drawing-panel__popover" role="menu">
                  <div className="exam-drawing-panel__popover-title">Фигуры</div>
                  <button
                    type="button"
                    className={`exam-drawing-panel__shape-pick${shapeKind === "line" ? " is-active" : ""}`}
                    onClick={() => pickShape("line")}
                  >
                    Линия
                  </button>
                  <button
                    type="button"
                    className={`exam-drawing-panel__shape-pick${shapeKind === "rect" ? " is-active" : ""}`}
                    onClick={() => pickShape("rect")}
                  >
                    Прямоугольник
                  </button>
                  <button
                    type="button"
                    className={`exam-drawing-panel__shape-pick${shapeKind === "circle" ? " is-active" : ""}`}
                    onClick={() => pickShape("circle")}
                  >
                    Окружность
                  </button>
                  <button
                    type="button"
                    className={`exam-drawing-panel__shape-pick${shapeKind === "arrow" ? " is-active" : ""}`}
                    onClick={() => pickShape("arrow")}
                  >
                    Стрелка
                  </button>
                </div>
              )}
            </div>

            <div className="toolbar-row1__sep" aria-hidden="true" />

            <button type="button" className="toolbar-row1__btn" onClick={onUndo} title="Отменить" aria-label="Отменить последнее действие">
              <Row1IconUndo />
            </button>

            <button
              type="button"
              className="toolbar-row1__btn"
              onClick={onRedo}
              disabled={redoDisabled}
              title="Вернуть"
              aria-label="Вернуть отменённое действие"
            >
              <Row1IconRedo />
            </button>

            <div className="toolbar-row1__sep" aria-hidden="true" />

            <button
              type="button"
              className={`toolbar-row1__btn${extraDrawingPad ? " is-active" : ""}`}
              onClick={() => onExtraDrawingPadChange?.(!extraDrawingPad)}
              title={extraDrawingPad ? "Скрыть дополнительное место для записей" : "Дополнительное место — поле в клетку ниже"}
              aria-label={extraDrawingPad ? "Скрыть дополнительное место" : "Дополнительное место"}
              aria-pressed={extraDrawingPad}
            >
              <Row1IconGrid />
            </button>

            <div className="toolbar-row1__sep" aria-hidden="true" />

            <button
              type="button"
              className="toolbar-row1__btn toolbar-row1__btn--danger"
              onClick={onClearAll}
              title="Стереть всё"
              aria-label="Стереть всё"
            >
              <Row1IconDeleteAll />
            </button>
          </div>
        </div>

        <button
          type="button"
          className="exam-drawing-panel__icon-btn exam-drawing-panel__icon-btn--close"
          onClick={onClosePanel}
          title="Свернуть панель (рисунок сохраняется)"
          aria-label="Свернуть панель"
        >
          <IconCollapse />
        </button>
      </div>

      <div className="exam-drawing-panel__row exam-drawing-panel__row--secondary">
        <span className="exam-drawing-panel__label">Толщина</span>
        <div className="exam-drawing-panel__widths">
          {WIDTH_PRESETS.map((w) => (
            <button
              key={w}
              type="button"
              className={`exam-drawing-panel__width-dot${strokeWidth === w ? " is-active" : ""}`}
              style={{ "--dot-size": dotSizeForWidth(w) }}
              onClick={() => onStrokeWidth?.(w)}
              title={`Толщина ${w}`}
              aria-label={`Толщина линии ${w}`}
            />
          ))}
        </div>
        <span className="exam-drawing-panel__label">Цвет</span>
        <div className="exam-drawing-panel__colors">
          {STROKE_PALETTE.map((p) => (
            <button
              key={p.color}
              type="button"
              className={`exam-drawing-panel__swatch${strokeColor === p.color ? " is-active" : ""}`}
              style={{ "--swatch": p.color }}
              title={p.label}
              aria-label={p.label}
              onClick={() => {
                onStrokeColor?.(p.color);
                onToolChange?.("pencil");
              }}
            />
          ))}
        </div>
      </div>
    </div>
  );
}
