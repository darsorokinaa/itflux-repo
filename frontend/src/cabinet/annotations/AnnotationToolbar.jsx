import CabinetIcon from "../CabinetIcons";
import { PALETTE, TOOLS, WIDTHS } from "../screenshare/constants";
import { useAnnotationSession } from "./AnnotationContext";

const DRAW_TOOLS = [
  { id: TOOLS.POINTER, icon: "pointer", label: "Указка / выход" },
  { id: TOOLS.PEN, icon: "pencil", label: "Карандаш" },
  { id: TOOLS.HIGHLIGHTER, icon: "highlighter", label: "Маркер" },
  { id: TOOLS.ERASER, icon: "eraser", label: "Ластик" },
];

const SHAPE_TOOLS = [
  { id: TOOLS.LASER, icon: "laser", label: "Лазер" },
  { id: TOOLS.LINE, icon: "minus", label: "Линия" },
  { id: TOOLS.ARROW, icon: "arrow", label: "Стрелка" },
  { id: TOOLS.RECT, icon: "rect", label: "Прямоугольник" },
  { id: TOOLS.ELLIPSE, icon: "ellipse", label: "Овал" },
  { id: TOOLS.TEXT, icon: "text", label: "Текст" },
];

export function AnnotationHeaderButton({ onEnable }) {
  const session = useAnnotationSession();
  if (!session?.available) return null;
  return (
    <button
      type="button"
      className={`video-lesson-btn video-lesson-btn--ghost${session.enabled ? " is-active" : ""}`}
      onClick={() => {
        onEnable?.();
        session.toggle();
      }}
      aria-pressed={session.enabled}
      title={session.enabled ? "Выключить аннотацию" : "Аннотация"}
    >
      <CabinetIcon name="pencil" />
      <span className="video-lesson-btn__label">Аннотация</span>
    </button>
  );
}

export default function AnnotationToolbar({
  tool,
  color,
  width,
  canAnnotate = false,
  canManage = false,
  canUndo = false,
  canRedo = false,
  participantsCanAnnotate = true,
  compact = false,
  hint = "",
  onToolChange,
  onColorChange,
  onWidthChange,
  onUndo,
  onRedo,
  onClearMine,
  onClearAll,
  onSetParticipantsCanAnnotate,
  extra = null,
  showShapes = true,
}) {
  return (
    <div
      className={`ann-toolbar${compact ? " ann-toolbar--compact" : ""}`}
      role="toolbar"
      aria-label="Инструменты аннотаций"
    >
      <div className="ann-toolbar__group">
        {DRAW_TOOLS.map((item) => (
          <button
            key={item.id}
            type="button"
            className={tool === item.id ? "is-active" : ""}
            disabled={!canAnnotate && item.id !== TOOLS.POINTER}
            onClick={() => onToolChange?.(item.id)}
            title={item.label}
            aria-label={item.label}
          >
            <CabinetIcon name={item.icon} />
          </button>
        ))}
      </div>
      {showShapes ? (
        <div className="ann-toolbar__group ann-toolbar__group--shapes">
          {SHAPE_TOOLS.map((item) => (
            <button
              key={item.id}
              type="button"
              className={tool === item.id ? "is-active" : ""}
              disabled={!canAnnotate && item.id !== TOOLS.POINTER}
              onClick={() => onToolChange?.(item.id)}
              title={item.label}
              aria-label={item.label}
            >
              <CabinetIcon name={item.icon} />
            </button>
          ))}
        </div>
      ) : null}
      <div className="ann-toolbar__group">
        {PALETTE.map((c) => (
          <button
            key={c}
            type="button"
            className={`ann-toolbar__swatch${color === c ? " is-active" : ""}`}
            style={{ background: c }}
            aria-label={`Цвет ${c}`}
            disabled={!canAnnotate}
            onClick={() => onColorChange?.(c)}
            title={c}
          />
        ))}
        <label className="ann-toolbar__width" title="Толщина">
          <span className="ann-toolbar__width-mark" aria-hidden="true">—</span>
          <select
            value={width}
            disabled={!canAnnotate}
            onChange={(e) => onWidthChange?.(Number(e.target.value))}
            aria-label="Толщина"
          >
            {WIDTHS.map((w) => (
              <option key={w} value={w}>{w}</option>
            ))}
          </select>
        </label>
      </div>
      <div className="ann-toolbar__group">
        <button type="button" disabled={!canAnnotate || !canUndo} onClick={() => onUndo?.()} title="Отменить" aria-label="Отменить">
          <CabinetIcon name="undo" />
        </button>
        <button type="button" disabled={!canAnnotate || !canRedo} onClick={() => onRedo?.()} title="Повторить" aria-label="Повторить">
          <CabinetIcon name="redo" />
        </button>
        <button type="button" disabled={!canAnnotate} onClick={() => onClearMine?.()} title="Очистить свои" aria-label="Очистить свои">
          <CabinetIcon name="eraser" />
          <span className="ann-toolbar__text">Свои</span>
        </button>
        {canManage ? (
          <button type="button" onClick={() => onClearAll?.()} title="Очистить все" aria-label="Очистить все">
            <CabinetIcon name="trash" />
            <span className="ann-toolbar__text">Все</span>
          </button>
        ) : null}
        {canManage ? (
          <button
            type="button"
            className={participantsCanAnnotate ? "is-active" : ""}
            onClick={() => onSetParticipantsCanAnnotate?.(!participantsCanAnnotate)}
            title={participantsCanAnnotate ? "Запретить участникам рисовать" : "Разрешить участникам рисовать"}
            aria-label={participantsCanAnnotate ? "Запретить участникам" : "Разрешить участникам"}
          >
            <CabinetIcon name={participantsCanAnnotate ? "users" : "user"} />
          </button>
        ) : null}
        {extra}
      </div>
      {hint ? <p className="ann-toolbar__hint">{hint}</p> : null}
      {!canAnnotate ? (
        <p className="ann-toolbar__hint">Преподаватель запретил рисовать. Аннотации остаются видны.</p>
      ) : null}
    </div>
  );
}
