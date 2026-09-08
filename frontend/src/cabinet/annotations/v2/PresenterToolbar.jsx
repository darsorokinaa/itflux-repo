import { useEffect, useRef, useState } from "react";

import CabinetIcon from "../../CabinetIcons";
import {
  PALETTE,
  STAMP_KINDS,
  TEXT_SIZES,
  TEXT_WEIGHTS,
  TOOLS,
  WIDTH_PRESETS,
} from "../../screenshare/constants";

const CORE_TOOLS = [
  { id: TOOLS.POINTER, icon: "pointer", label: "Мышь" },
  { id: TOOLS.PEN, icon: "pencil", label: "Перо" },
  { id: TOOLS.HIGHLIGHTER, icon: "highlighter", label: "Маркер" },
  { id: TOOLS.TEXT, icon: "text", label: "Текст" },
];

const SHAPE_ITEMS = [
  { id: TOOLS.ARROW, icon: "arrow", label: "Стрелка" },
  { id: TOOLS.LINE, icon: "minus", label: "Линия" },
  { id: TOOLS.RECT, icon: "rect", label: "Прямоугольник" },
  { id: TOOLS.ELLIPSE, icon: "ellipse", label: "Эллипс" },
];

const PRESENTER_TOOLS = [
  { id: TOOLS.SELECT, icon: "select", label: "Выбор" },
  { id: TOOLS.SPOTLIGHT, icon: "laser", label: "Spotlight" },
  { id: TOOLS.VANISHING, icon: "vanishing", label: "Исчезающее перо" },
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
  opacity = 0.38,
  fontSize = 18,
  fontWeight = 650,
  stampKind = "star",
  canAnnotate = false,
  canManage = false,
  isPresenter = false,
  participantsCanAnnotate = false,
  showAuthorNames = false,
  syncUnavailable = false,
  onToolChange,
  onColorChange,
  onWidthChange,
  onOpacityChange,
  onFontSizeChange,
  onFontWeightChange,
  onStampKindChange,
  onUndo,
  onRedo,
  onClearMine,
  onClearViewers,
  onClearAll,
  onSetParticipantsCanAnnotate,
  onSetShowAuthorNames,
  onDock,
  onClose,
  onPointerDownDrag,
  geometryStatus = "",
}) {
  const rootRef = useRef(null);
  const [menu, setMenu] = useState(null);
  const hostControls = Boolean(canManage || isPresenter);
  const presenterTools = Boolean(isPresenter);

  useEffect(() => {
    if (!menu) return undefined;
    const doc = rootRef.current?.ownerDocument || document;
    const onDoc = (event) => {
      if (!rootRef.current?.contains(event.target)) setMenu(null);
    };
    const onKey = (event) => {
      if (event.key === "Escape") setMenu(null);
    };
    doc.addEventListener("pointerdown", onDoc);
    doc.addEventListener("keydown", onKey);
    return () => {
      doc.removeEventListener("pointerdown", onDoc);
      doc.removeEventListener("keydown", onKey);
    };
  }, [menu]);

  const toggleMenu = (id) => {
    setMenu((prev) => (prev === id ? null : id));
  };

  const formatControl = (
    <div className="ss-ann-v2-popwrap">
      <button
        type="button"
        className={menu === "format" ? "is-open" : ""}
        disabled={!canAnnotate}
        title="Формат"
        aria-label="Формат"
        aria-expanded={menu === "format"}
        onClick={() => toggleMenu("format")}
      >
        <span className="ss-ann-v2-colorbtn__chip" style={{ background: color }} />
      </button>
      {menu === "format" ? (
        <div className="ss-ann-v2-pop ss-ann-v2-pop--format" role="dialog" aria-label="Формат">
          <p className="ss-ann-v2-pop__label">Цвет</p>
          <div className="ss-ann-v2-pop__row">
            {PALETTE.map((c) => (
              <button
                key={c}
                type="button"
                className={`ann-toolbar__swatch${color === c ? " is-active" : ""}`}
                style={{ background: c }}
                aria-label={`Цвет ${c}`}
                onClick={() => onColorChange?.(c)}
              />
            ))}
          </div>
          <p className="ss-ann-v2-pop__label">Толщина</p>
          <div className="ss-ann-v2-pop__row ss-ann-v2-pop__row--stack">
            {WIDTH_PRESETS.map((preset) => (
              <button
                key={preset.value}
                type="button"
                className={Number(width) === preset.value ? "is-active" : ""}
                title={preset.label}
                aria-label={preset.label}
                onClick={() => onWidthChange?.(preset.value)}
              >
                <span className="ss-ann-v2-widthopt" style={{ height: Math.max(1, preset.value) }} />
                <span className="ss-ann-v2-widthopt__label">{preset.label}</span>
              </button>
            ))}
          </div>
          <label className="ss-ann-v2-pop__label" htmlFor="ss-ann-width-range">Тонкая линия</label>
          <input
            id="ss-ann-width-range"
            type="range"
            min="0.75"
            max="12"
            step="0.25"
            value={width}
            aria-label="Толщина пера"
            onChange={(event) => onWidthChange?.(Number(event.target.value))}
          />
          <label className="ss-ann-v2-pop__label" htmlFor="ss-ann-opacity-range">Прозрачность маркера</label>
          <input
            id="ss-ann-opacity-range"
            type="range"
            min="0.12"
            max="0.7"
            step="0.02"
            value={opacity}
            aria-label="Прозрачность маркера"
            onChange={(event) => onOpacityChange?.(Number(event.target.value))}
          />
          <p className="ss-ann-v2-pop__label">Размер текста</p>
          <div className="ss-ann-v2-pop__row">
            {TEXT_SIZES.map((item) => (
              <button
                key={item.value}
                type="button"
                className={Number(fontSize) === item.value ? "is-active" : ""}
                aria-label={`Размер текста ${item.label}`}
                onClick={() => onFontSizeChange?.(item.value)}
              >
                {item.label}
              </button>
            ))}
          </div>
          <p className="ss-ann-v2-pop__label">Начертание</p>
          <div className="ss-ann-v2-pop__row">
            {TEXT_WEIGHTS.map((item) => (
              <button
                key={item.value}
                type="button"
                className={Number(fontWeight) === item.value ? "is-active" : ""}
                aria-label={item.label}
                onClick={() => onFontWeightChange?.(item.value)}
              >
                {item.label}
              </button>
            ))}
          </div>
        </div>
      ) : null}
    </div>
  );

  const shapesControl = (
    <div className="ss-ann-v2-popwrap ss-ann-v2-tool--optional">
      <button
        type="button"
        className={[SHAPE_ITEMS.some((item) => item.id === tool) ? "is-active" : "", menu === "shapes" ? "is-open" : ""].filter(Boolean).join(" ")}
        disabled={!canAnnotate}
        title="Рисование / Фигуры"
        aria-label="Рисование / Фигуры"
        aria-expanded={menu === "shapes"}
        onClick={() => toggleMenu("shapes")}
      >
        <CabinetIcon name="rect" />
      </button>
      {menu === "shapes" ? (
        <div className="ss-ann-v2-pop" role="menu" aria-label="Фигуры">
          {SHAPE_ITEMS.map((item) => (
            <ToolButton
              key={item.id}
              item={item}
              tool={tool}
              canAnnotate={canAnnotate}
              onToolChange={(id) => {
                onToolChange?.(id);
                setMenu(null);
              }}
            />
          ))}
        </div>
      ) : null}
    </div>
  );

  const stampControl = (
    <div className="ss-ann-v2-popwrap ss-ann-v2-tool--optional">
      <button
        type="button"
        className={[tool === TOOLS.STAMP ? "is-active" : "", menu === "stamp" ? "is-open" : ""].filter(Boolean).join(" ")}
        disabled={!canAnnotate}
        title="Штамп"
        aria-label="Штамп"
        aria-expanded={menu === "stamp"}
        onClick={() => {
          onToolChange?.(TOOLS.STAMP);
          toggleMenu("stamp");
        }}
      >
        <CabinetIcon name="stamp" />
      </button>
      {menu === "stamp" ? (
        <div className="ss-ann-v2-pop" role="menu" aria-label="Штамп">
          {STAMP_KINDS.map((item) => (
            <button
              key={item.id}
              type="button"
              className={stampKind === item.id ? "is-active" : ""}
              aria-label={item.label}
              title={item.label}
              onClick={() => {
                onStampKindChange?.(item.id);
                onToolChange?.(TOOLS.STAMP);
                setMenu(null);
              }}
            >
              {item.label}
            </button>
          ))}
        </div>
      ) : null}
    </div>
  );

  const clearControl = (
    <div className="ss-ann-v2-popwrap">
      <button
        type="button"
        className={menu === "clear" ? "is-open" : ""}
        disabled={!canAnnotate}
        title="Очистить"
        aria-label="Очистить"
        aria-expanded={menu === "clear"}
        onClick={() => toggleMenu("clear")}
      >
        <CabinetIcon name="trash" />
      </button>
      {menu === "clear" ? (
        <div className="ss-ann-v2-pop ss-ann-v2-pop--confirm" role="menu" aria-label="Очистить">
          {hostControls ? (
            <>
              <button
                type="button"
                className="is-danger"
                onClick={() => {
                  onClearAll?.();
                  setMenu(null);
                }}
              >
                Все рисунки
              </button>
              <button
                type="button"
                onClick={() => {
                  onClearMine?.();
                  setMenu(null);
                }}
              >
                Мои рисунки
              </button>
              <button
                type="button"
                onClick={() => {
                  onClearViewers?.();
                  setMenu(null);
                }}
              >
                Рисунки участников
              </button>
            </>
          ) : (
            <button
              type="button"
              onClick={() => {
                onClearMine?.();
                setMenu(null);
              }}
            >
              Мои рисунки
            </button>
          )}
        </div>
      ) : null}
    </div>
  );

  const moreItems = [
    ...SHAPE_ITEMS,
    { id: TOOLS.STAMP, icon: "stamp", label: "Штамп" },
    { id: TOOLS.ARROW_POINTER, icon: "arrowPointer", label: "Указатель" },
    { id: TOOLS.ERASER, icon: "eraser", label: "Ластик" },
    ...(presenterTools ? PRESENTER_TOOLS : []),
  ];

  return (
    <div
      ref={rootRef}
      className="ss-ann-v2-toolbar ann-toolbar ann-toolbar--compact"
      role="toolbar"
      aria-label="Аннотации демонстрации экрана"
      onPointerDown={onPointerDownDrag}
    >
      <span className="ss-ann-v2-toolbar__grip" title="Переместить" aria-hidden="true" />
      {CORE_TOOLS.map((item) => (
        <ToolButton
          key={item.id}
          item={item}
          tool={tool}
          canAnnotate={canAnnotate}
          onToolChange={onToolChange}
        />
      ))}
      {shapesControl}
      {stampControl}
      <ToolButton
        item={{ id: TOOLS.ARROW_POINTER, icon: "arrowPointer", label: "Указатель" }}
        tool={tool}
        canAnnotate={canAnnotate}
        onToolChange={onToolChange}
        className="ss-ann-v2-tool--optional"
      />
      <ToolButton
        item={{ id: TOOLS.ERASER, icon: "eraser", label: "Ластик" }}
        tool={tool}
        canAnnotate={canAnnotate}
        onToolChange={onToolChange}
      />
      {presenterTools ? PRESENTER_TOOLS.map((item) => (
        <ToolButton
          key={item.id}
          item={item}
          tool={tool}
          canAnnotate={canAnnotate}
          onToolChange={onToolChange}
          className="ss-ann-v2-tool--presenter"
        />
      )) : null}
      <span className="ss-ann-v2-toolbar__sep" />
      {formatControl}
      {hostControls ? (
        <>
          <button
            type="button"
            className={`ss-ann-v2-allow${participantsCanAnnotate ? " is-on" : ""}`}
            onClick={() => onSetParticipantsCanAnnotate?.(!participantsCanAnnotate)}
            title={participantsCanAnnotate ? "Запретить аннотации участникам" : "Разрешить аннотации участникам"}
            aria-label={participantsCanAnnotate ? "Запретить аннотации участникам" : "Разрешить аннотации участникам"}
            aria-pressed={participantsCanAnnotate}
          >
            <CabinetIcon name="users" />
            <span>{participantsCanAnnotate ? "Участники рисуют" : "Разрешить аннотации участникам"}</span>
          </button>
          <button
            type="button"
            className={`ss-ann-v2-allow${showAuthorNames ? " is-on" : ""}`}
            onClick={() => onSetShowAuthorNames?.(!showAuthorNames)}
            title="Показывать имена авторов"
            aria-label="Показывать имена авторов"
            aria-pressed={showAuthorNames}
          >
            <CabinetIcon name="user" />
          </button>
        </>
      ) : null}
      <span className="ss-ann-v2-toolbar__sep" />
      <button type="button" disabled={!canAnnotate} title="Отменить" aria-label="Отменить" onClick={() => onUndo?.()}>
        <CabinetIcon name="undo" />
      </button>
      <button type="button" disabled={!canAnnotate} title="Повторить" aria-label="Повторить" onClick={() => onRedo?.()}>
        <CabinetIcon name="redo" />
      </button>
      {clearControl}
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
            {moreItems.map((item) => (
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
          </div>
        ) : null}
      </div>
      {onDock ? (
        <button type="button" title="Вернуть к краю" aria-label="Вернуть к краю" onClick={() => onDock?.()}>
          <CabinetIcon name="expand" />
        </button>
      ) : null}
      <button type="button" onClick={() => onClose?.()} title="Свернуть" aria-label="Свернуть">
        <CabinetIcon name="close" />
      </button>
      {syncUnavailable ? (
        <span className="ss-ann-v2-toolbar__status" title="Совместные пометки временно недоступны">!</span>
      ) : null}
      {geometryStatus && geometryStatus !== "exact" ? (
        <span
          className="ss-ann-v2-toolbar__status"
          title={geometryStatus === "waiting"
            ? "Ожидание точной геометрии демонстрации"
            : "Геометрия Jitsi приблизительная — линии могут чуть смещаться"}
        >
          {geometryStatus === "waiting" ? "…" : "✕"}
        </span>
      ) : null}
    </div>
  );
}
