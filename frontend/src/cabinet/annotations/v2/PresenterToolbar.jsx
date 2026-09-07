import { useEffect, useRef, useState } from "react";

import CabinetIcon from "../../CabinetIcons";
import { PALETTE, TOOLS, WIDTH_PRESETS } from "../../screenshare/constants";

const PRIMARY_TOOLS = [
  { id: TOOLS.POINTER, icon: "pointer", label: "Указка" },
  { id: TOOLS.LASER, icon: "laser", label: "Лазер" },
  { id: TOOLS.PEN, icon: "pencil", label: "Карандаш" },
  { id: TOOLS.ARROW, icon: "arrow", label: "Стрелка" },
];

const OPTIONAL_TOOLS = [
  { id: TOOLS.LINE, icon: "minus", label: "Линия" },
  { id: TOOLS.RECT, icon: "rect", label: "Прямоугольник" },
  { id: TOOLS.ERASER, icon: "eraser", label: "Ластик" },
];

function ToolButton({ item, tool, canAnnotate, onToolChange, className = "" }) {
  return (
    <button
      type="button"
      className={[tool === item.id ? "is-active" : "", className].filter(Boolean).join(" ")}
      disabled={!canAnnotate && item.id !== TOOLS.POINTER}
      onClick={() => onToolChange?.(item.id)}
      title={item.label}
      aria-label={item.label}
      aria-pressed={tool === item.id}
    >
      <CabinetIcon name={item.icon} />
    </button>
  );
}

export default function PresenterToolbar({
  tool,
  color,
  width,
  canAnnotate = false,
  canManage = false,
  participantsCanAnnotate = false,
  syncUnavailable = false,
  onToolChange,
  onColorChange,
  onWidthChange,
  onUndo,
  onClearMine,
  onClearAll,
  onSetParticipantsCanAnnotate,
  onClose,
  onPointerDownDrag,
}) {
  const rootRef = useRef(null);
  const [menu, setMenu] = useState(null);

  useEffect(() => {
    if (!menu) return undefined;
    const onDoc = (event) => {
      if (!rootRef.current?.contains(event.target)) setMenu(null);
    };
    const onKey = (event) => {
      if (event.key === "Escape") setMenu(null);
    };
    document.addEventListener("pointerdown", onDoc);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("pointerdown", onDoc);
      document.removeEventListener("keydown", onKey);
    };
  }, [menu]);

  const toggleMenu = (id) => {
    setMenu((prev) => (prev === id ? null : id));
  };

  const colorControl = (
    <div className="ss-ann-v2-popwrap">
      <button
        type="button"
        className={`ss-ann-v2-colorbtn${menu === "color" ? " is-open" : ""}`}
        disabled={!canAnnotate}
        title="Цвет"
        aria-label="Цвет"
        aria-expanded={menu === "color"}
        onClick={() => toggleMenu("color")}
      >
        <span className="ss-ann-v2-colorbtn__chip" style={{ background: color }} />
      </button>
      {menu === "color" ? (
        <div className="ss-ann-v2-pop" role="menu" aria-label="Цвет">
          {PALETTE.map((c) => (
            <button
              key={c}
              type="button"
              className={`ann-toolbar__swatch${color === c ? " is-active" : ""}`}
              style={{ background: c }}
              aria-label={`Цвет ${c}`}
              onClick={() => {
                onColorChange?.(c);
                setMenu(null);
              }}
            />
          ))}
        </div>
      ) : null}
    </div>
  );

  const widthControl = (
    <div className="ss-ann-v2-popwrap ss-ann-v2-tool--optional">
      <button
        type="button"
        className={`ss-ann-v2-widthbtn${menu === "width" ? " is-open" : ""}`}
        disabled={!canAnnotate}
        title="Толщина"
        aria-label="Толщина"
        aria-expanded={menu === "width"}
        onClick={() => toggleMenu("width")}
      >
        <span className="ss-ann-v2-widthbtn__mark" style={{ height: Math.max(2, Number(width) || 4) }} />
      </button>
      {menu === "width" ? (
        <div className="ss-ann-v2-pop ss-ann-v2-pop--width" role="menu" aria-label="Толщина">
          {WIDTH_PRESETS.map((preset) => (
            <button
              key={preset.value}
              type="button"
              className={Number(width) === preset.value ? "is-active" : ""}
              title={preset.label}
              aria-label={preset.label}
              onClick={() => {
                onWidthChange?.(preset.value);
                setMenu(null);
              }}
            >
              <span className="ss-ann-v2-widthopt" style={{ height: preset.value }} />
              <span className="ss-ann-v2-widthopt__label">{preset.label}</span>
            </button>
          ))}
        </div>
      ) : null}
    </div>
  );

  const allowControl = canManage ? (
    <button
      type="button"
      className={`ss-ann-v2-allow${participantsCanAnnotate ? " is-on" : ""}`}
      onClick={() => onSetParticipantsCanAnnotate?.(!participantsCanAnnotate)}
      title={participantsCanAnnotate ? "Запретить пометки ученику" : "Разрешить пометки ученику"}
      aria-label={participantsCanAnnotate ? "Запретить пометки ученику" : "Разрешить пометки ученику"}
      aria-pressed={participantsCanAnnotate}
    >
      <CabinetIcon name="users" />
      <span>{participantsCanAnnotate ? "Ученик рисует" : "Разрешить пометки ученику"}</span>
    </button>
  ) : null;

  return (
    <div
      ref={rootRef}
      className="ss-ann-v2-toolbar ann-toolbar ann-toolbar--compact"
      role="toolbar"
      aria-label="Аннотации демонстрации экрана"
      onPointerDown={onPointerDownDrag}
    >
      <span className="ss-ann-v2-toolbar__grip" title="Переместить" aria-hidden="true" />
      {PRIMARY_TOOLS.map((item) => (
        <ToolButton
          key={item.id}
          item={item}
          tool={tool}
          canAnnotate={canAnnotate}
          onToolChange={onToolChange}
        />
      ))}
      {OPTIONAL_TOOLS.map((item) => (
        <ToolButton
          key={item.id}
          item={item}
          tool={tool}
          canAnnotate={canAnnotate}
          onToolChange={onToolChange}
          className={item.id === TOOLS.ERASER ? undefined : "ss-ann-v2-tool--optional"}
        />
      ))}
      <span className="ss-ann-v2-toolbar__sep" />
      {colorControl}
      {widthControl}
      {allowControl}
      <span className="ss-ann-v2-toolbar__sep" />
      <button
        type="button"
        disabled={!canAnnotate}
        title="Отменить своё"
        aria-label="Отменить своё"
        onClick={() => onUndo?.()}
      >
        <CabinetIcon name="undo" />
      </button>
      {canManage ? (
        <div className="ss-ann-v2-popwrap">
          <button
            type="button"
            className={menu === "clear" ? "is-open" : ""}
            title="Очистить все"
            aria-label="Очистить все"
            aria-expanded={menu === "clear"}
            onClick={() => toggleMenu("clear")}
          >
            <CabinetIcon name="trash" />
          </button>
          {menu === "clear" ? (
            <div className="ss-ann-v2-pop ss-ann-v2-pop--confirm" role="dialog" aria-label="Очистить все пометки">
              <p>Очистить все пометки?</p>
              <div className="ss-ann-v2-pop__actions">
                <button type="button" onClick={() => setMenu(null)}>Отмена</button>
                <button
                  type="button"
                  className="is-danger"
                  onClick={() => {
                    onClearAll?.();
                    setMenu(null);
                  }}
                >
                  Очистить
                </button>
              </div>
            </div>
          ) : null}
        </div>
      ) : (
        <button
          type="button"
          disabled={!canAnnotate}
          title="Очистить свои пометки"
          aria-label="Очистить свои пометки"
          onClick={() => onClearMine?.()}
        >
          <CabinetIcon name="trash" />
        </button>
      )}
      <div className="ss-ann-v2-popwrap ss-ann-v2-more">
        <button
          type="button"
          className={menu === "more" ? "is-open" : ""}
          title="Ещё"
          aria-label="Ещё"
          aria-expanded={menu === "more"}
          onClick={() => toggleMenu("more")}
        >
          <CabinetIcon name="more" />
        </button>
        {menu === "more" ? (
          <div className="ss-ann-v2-pop ss-ann-v2-pop--more" role="menu" aria-label="Ещё">
            {OPTIONAL_TOOLS.filter((item) => item.id !== TOOLS.ERASER).map((item) => (
              <ToolButton
                key={`more-${item.id}`}
                item={item}
                tool={tool}
                canAnnotate={canAnnotate}
                onToolChange={(id) => {
                  onToolChange?.(id);
                  setMenu(null);
                }}
              />
            ))}
            {WIDTH_PRESETS.map((preset) => (
              <button
                key={`more-w-${preset.value}`}
                type="button"
                className={Number(width) === preset.value ? "is-active" : ""}
                disabled={!canAnnotate}
                onClick={() => {
                  onWidthChange?.(preset.value);
                  setMenu(null);
                }}
              >
                {preset.label}
              </button>
            ))}
          </div>
        ) : null}
      </div>
      <button type="button" onClick={() => onClose?.()} title="Свернуть" aria-label="Свернуть">
        <CabinetIcon name="close" />
      </button>
      {syncUnavailable ? (
        <span className="ss-ann-v2-toolbar__status" title="Совместные пометки временно недоступны">!</span>
      ) : null}
    </div>
  );
}
