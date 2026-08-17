import CabinetIcon from "../../CabinetIcons";
import { PALETTE, TOOLS, WIDTHS } from "../../screenshare/constants";

const TOOLS_ROW = [
  { id: TOOLS.POINTER, icon: "pointer", label: "Указка" },
  { id: TOOLS.PEN, icon: "pencil", label: "Перо" },
  { id: TOOLS.HIGHLIGHTER, icon: "highlighter", label: "Маркер" },
  { id: TOOLS.ERASER, icon: "eraser", label: "Ластик" },
  { id: TOOLS.LASER, icon: "laser", label: "Лазер" },
];

export default function PresenterToolbar({
  tool,
  color,
  width,
  canAnnotate = false,
  canManage = false,
  canUndo = false,
  participantsCanAnnotate = true,
  pipAvailable = false,
  pipOpen = false,
  hint = "",
  onToolChange,
  onColorChange,
  onWidthChange,
  onUndo,
  onClearMine,
  onClearAll,
  onSetParticipantsCanAnnotate,
  onClose,
  onOpenPip,
  onPointerDownDrag,
}) {
  return (
    <div
      className="ss-ann-v2-toolbar ann-toolbar ann-toolbar--compact"
      role="toolbar"
      aria-label="Аннотации демонстрации экрана"
      onPointerDown={onPointerDownDrag}
    >
      <span className="ss-ann-v2-toolbar__grip" title="Переместить" aria-hidden="true" />
      {TOOLS_ROW.map((item) => (
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
      <span className="ss-ann-v2-toolbar__sep" />
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
      <span className="ss-ann-v2-toolbar__sep" />
      <button type="button" disabled={!canAnnotate || !canUndo} onClick={() => onUndo?.()} title="Отменить" aria-label="Отменить">
        <CabinetIcon name="undo" />
      </button>
      <button type="button" disabled={!canAnnotate} onClick={() => onClearMine?.()} title="Очистить свои" aria-label="Очистить свои">
        <CabinetIcon name="eraser" />
      </button>
      {canManage ? (
        <button type="button" onClick={() => onClearAll?.()} title="Очистить все" aria-label="Очистить все">
          <CabinetIcon name="trash" />
        </button>
      ) : null}
      {canManage ? (
        <button
          type="button"
          className={participantsCanAnnotate ? "is-active" : ""}
          onClick={() => onSetParticipantsCanAnnotate?.(!participantsCanAnnotate)}
          title={participantsCanAnnotate ? "Запретить участникам рисовать" : "Разрешить рисовать всем"}
          aria-label={participantsCanAnnotate ? "Запретить участникам" : "Разрешить всем"}
        >
          <CabinetIcon name={participantsCanAnnotate ? "users" : "user"} />
        </button>
      ) : null}
      {pipAvailable && !pipOpen ? (
        <button type="button" onClick={() => onOpenPip?.()} title="Панель поверх окон" aria-label="Панель поверх окон">
          <CabinetIcon name="expand" />
        </button>
      ) : null}
      <button type="button" onClick={() => onClose?.()} title="Закрыть аннотации" aria-label="Закрыть аннотации">
        <CabinetIcon name="close" />
      </button>
      {hint ? <p className="ann-toolbar__hint">{hint}</p> : null}
    </div>
  );
}
