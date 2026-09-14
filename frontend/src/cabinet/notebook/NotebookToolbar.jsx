import { useEffect, useRef, useState } from "react";
import {
  ArrowUpRight,
  Circle,
  Eraser,
  Hand,
  Highlighter,
  Minus,
  MousePointer2,
  Pencil,
  Redo2,
  Square,
  Type,
  Undo2,
} from "lucide-react";
import { ERASER_MODE, QUICK_COLORS, TOOL } from "./notebookModel";
import { isMacPlatform, shortcutLabel } from "./useEditorShortcuts";

const TOOL_META = [
  { id: TOOL.HAND, icon: Hand, label: "Рука", shortcut: "H" },
  { id: TOOL.SELECT, icon: MousePointer2, label: "Выбор", shortcut: "V" },
  { id: TOOL.PEN, icon: Pencil, label: "Ручка", shortcut: "P" },
  { id: TOOL.MARKER, icon: Highlighter, label: "Маркер", shortcut: "M" },
  { id: TOOL.ERASER, icon: Eraser, label: "Ластик", shortcut: "E" },
  { id: TOOL.TEXT, icon: Type, label: "Текст", shortcut: "T" },
];

const SHAPE_META = [
  { id: TOOL.LINE, icon: Minus, label: "Линия", shortcut: "L" },
  { id: TOOL.ARROW, icon: ArrowUpRight, label: "Стрелка", shortcut: "A" },
  { id: TOOL.RECT, icon: Square, label: "Прямоугольник", shortcut: "R" },
  { id: TOOL.ELLIPSE, icon: Circle, label: "Эллипс", shortcut: "O" },
];

const WIDTHS = [2, 4, 6, 10];
const RECENT_KEY = "itflux.notebook.recent-colors";

function readRecentColors() {
  try {
    const raw = JSON.parse(localStorage.getItem(RECENT_KEY) || "[]");
    return Array.isArray(raw) ? raw.filter((item) => /^#/.test(item)).slice(0, 6) : [];
  } catch {
    return [];
  }
}

function rememberColor(color) {
  const next = [color, ...readRecentColors().filter((item) => item !== color)].slice(0, 6);
  localStorage.setItem(RECENT_KEY, JSON.stringify(next));
  return next;
}

function ToolButton({ icon: Icon, label, shortcut, active, disabled, onClick, onRepeatClick }) {
  const [tip, setTip] = useState(false);
  const timer = useRef(0);
  return (
    <button
      type="button"
      className={`hw-nb-tool${active ? " is-active" : ""}`}
      aria-label={`${label}${shortcut ? ` (${shortcut})` : ""}`}
      title=""
      disabled={disabled}
      onClick={() => (active && onRepeatClick ? onRepeatClick() : onClick?.())}
      onMouseEnter={() => {
        timer.current = window.setTimeout(() => setTip(true), 480);
      }}
      onMouseLeave={() => {
        window.clearTimeout(timer.current);
        setTip(false);
      }}
    >
      <Icon size={18} strokeWidth={1.75} />
      {tip ? (
        <span className="hw-nb-tooltip" role="tooltip">
          <strong>{label}</strong>
          {shortcut ? <kbd>{shortcut}</kbd> : null}
        </span>
      ) : null}
    </button>
  );
}

export default function NotebookToolbar({
  tool,
  onTool,
  color,
  onColor,
  strokeWidth,
  onStrokeWidth,
  opacity,
  onOpacity,
  fontSize,
  onFontSize,
  smoothing,
  onSmoothing,
  eraserMode,
  onEraserMode,
  canUndo,
  canRedo,
  onUndo,
  onRedo,
  readOnly,
  selected,
}) {
  const [open, setOpen] = useState(null);
  const [recent, setRecent] = useState(readRecentColors);
  const rootRef = useRef(null);
  const shapeActive = SHAPE_META.some((item) => item.id === tool);
  const ShapeIcon = SHAPE_META.find((item) => item.id === tool)?.icon || Minus;
  const showColor = tool !== TOOL.HAND && tool !== TOOL.ERASER;
  const showWidth = [TOOL.PEN, TOOL.MARKER, TOOL.LINE, TOOL.ARROW, TOOL.RECT, TOOL.ELLIPSE].includes(tool)
    || (tool === TOOL.SELECT && selected && selected.type !== "text");
  const showOpacity = tool === TOOL.MARKER;
  const showFont = tool === TOOL.TEXT || (tool === TOOL.SELECT && selected?.type === "text");
  const showEraser = tool === TOOL.ERASER;
  const mod = isMacPlatform() ? "⌘" : "Ctrl";

  useEffect(() => {
    const onDoc = (event) => {
      if (!rootRef.current?.contains(event.target)) setOpen(null);
    };
    document.addEventListener("pointerdown", onDoc);
    return () => document.removeEventListener("pointerdown", onDoc);
  }, []);

  return (
    <div className="hw-nb-toolbar" ref={rootRef} role="toolbar" aria-label="Инструменты тетради">
      {TOOL_META.map((item) => (
        <ToolButton
          key={item.id}
          icon={item.icon}
          label={item.label}
          shortcut={item.shortcut}
          active={tool === item.id}
          disabled={readOnly && item.id !== TOOL.SELECT && item.id !== TOOL.HAND}
          onClick={() => onTool(item.id)}
          onRepeatClick={() => {
            if (item.id === TOOL.PEN) setOpen(open === "pen" ? null : "pen");
            if (item.id === TOOL.MARKER) setOpen(open === "marker" ? null : "marker");
            if (item.id === TOOL.ERASER) setOpen(open === "eraser" ? null : "eraser");
          }}
        />
      ))}
      <div className="hw-nb-tool-wrap">
        <ToolButton
          icon={ShapeIcon}
          label="Фигура"
          shortcut="L"
          active={shapeActive}
          disabled={readOnly}
          onClick={() => setOpen(open === "shape" ? null : "shape")}
        />
        {open === "shape" ? (
          <div className="hw-nb-popover" role="menu">
            {SHAPE_META.map((item) => (
              <button
                key={item.id}
                type="button"
                className={tool === item.id ? "is-active" : ""}
                onClick={() => { onTool(item.id); setOpen(null); }}
              >
                <item.icon size={16} />
                <span>{item.label}</span>
                <kbd>{item.shortcut}</kbd>
              </button>
            ))}
          </div>
        ) : null}
      </div>
      <span className="hw-nb-divider" />
      {showColor ? (
        <div className="hw-nb-tool-wrap">
          <button
            type="button"
            className="hw-nb-color"
            aria-label="Цвет"
            onClick={() => setOpen(open === "color" ? null : "color")}
          >
            <span style={{ background: color }} />
          </button>
          {open === "color" ? (
            <div className="hw-nb-popover hw-nb-popover--color">
              <div className="hw-nb-swatches">
                {QUICK_COLORS.map((value) => (
                  <button
                    key={value}
                    type="button"
                    className={`hw-nb-swatch${color === value ? " is-active" : ""}`}
                    style={{ background: value }}
                    aria-label={value}
                    onClick={() => {
                      onColor(value);
                      setRecent(rememberColor(value));
                    }}
                  />
                ))}
              </div>
              {recent.length ? (
                <div className="hw-nb-swatches">
                  {recent.map((value) => (
                    <button
                      key={`r-${value}`}
                      type="button"
                      className="hw-nb-swatch"
                      style={{ background: value }}
                      aria-label={value}
                      onClick={() => onColor(value)}
                    />
                  ))}
                </div>
              ) : null}
              <label className="hw-nb-custom-color">
                Свой цвет
                <input
                  type="color"
                  value={color}
                  onChange={(event) => {
                    onColor(event.target.value);
                    setRecent(rememberColor(event.target.value));
                  }}
                />
              </label>
            </div>
          ) : null}
        </div>
      ) : null}
      {showWidth ? (
        <div className="hw-nb-tool-wrap">
          <button
            type="button"
            className="hw-nb-width"
            aria-label={`Толщина ${strokeWidth}px`}
            onClick={() => setOpen(open === "width" ? null : "width")}
          >
            <span style={{ height: Math.min(12, strokeWidth) }} />
            <em>{strokeWidth}</em>
          </button>
          {open === "width" ? (
            <div className="hw-nb-popover">
              {WIDTHS.map((value) => (
                <button
                  key={value}
                  type="button"
                  className={strokeWidth === value ? "is-active" : ""}
                  onClick={() => { onStrokeWidth(value); setOpen(null); }}
                >
                  <span className="hw-nb-width-line" style={{ height: Math.min(10, value) }} />
                  {value} px
                </button>
              ))}
            </div>
          ) : null}
        </div>
      ) : null}
      {showFont ? (
        <label className="hw-nb-font">
          <span className="sr-only">Размер текста</span>
          <select value={fontSize} onChange={(event) => onFontSize(Number(event.target.value))}>
            {[16, 20, 24, 32, 40].map((value) => (
              <option key={value} value={value}>{value}</option>
            ))}
          </select>
        </label>
      ) : null}
      {showEraser ? (
        <div className="hw-nb-segment" role="group" aria-label="Режим ластика">
          <button type="button" className={eraserMode === ERASER_MODE.STROKE ? "is-active" : ""} onClick={() => onEraserMode(ERASER_MODE.STROKE)}>Stroke</button>
          <button type="button" className={eraserMode === ERASER_MODE.OBJECT ? "is-active" : ""} onClick={() => onEraserMode(ERASER_MODE.OBJECT)}>Object</button>
        </div>
      ) : null}
      <span className="hw-nb-divider" />
      <ToolButton icon={Undo2} label="Отмена" shortcut={shortcutLabel("Mod+Z")} active={false} disabled={!canUndo || readOnly} onClick={onUndo} />
      <ToolButton icon={Redo2} label="Повтор" shortcut={`${mod}${isMacPlatform() ? "⇧" : "+Shift+"}Z`} active={false} disabled={!canRedo || readOnly} onClick={onRedo} />
      {open === "pen" ? (
        <div className="hw-nb-popover hw-nb-popover--dock">
          <label>Размер <input type="range" min="1" max="16" value={strokeWidth} onChange={(e) => onStrokeWidth(Number(e.target.value))} /></label>
          <label>Сглаживание <input type="range" min="0" max="3" value={smoothing} onChange={(e) => onSmoothing(Number(e.target.value))} /></label>
          <label>Прозрачность <input type="range" min="0.2" max="1" step="0.05" value={opacity} onChange={(e) => onOpacity(Number(e.target.value))} /></label>
        </div>
      ) : null}
      {open === "marker" ? (
        <div className="hw-nb-popover hw-nb-popover--dock">
          <label>Размер <input type="range" min="6" max="36" value={strokeWidth} onChange={(e) => onStrokeWidth(Number(e.target.value))} /></label>
          <label>Прозрачность <input type="range" min="0.2" max="0.35" step="0.01" value={opacity} onChange={(e) => onOpacity(Number(e.target.value))} /></label>
        </div>
      ) : null}
      {open === "eraser" ? (
        <div className="hw-nb-popover hw-nb-popover--dock">
          <button type="button" className={eraserMode === ERASER_MODE.STROKE ? "is-active" : ""} onClick={() => onEraserMode(ERASER_MODE.STROKE)}>Удалить штрих</button>
          <button type="button" className={eraserMode === ERASER_MODE.OBJECT ? "is-active" : ""} onClick={() => onEraserMode(ERASER_MODE.OBJECT)}>Удалить объект</button>
        </div>
      ) : null}
      {showOpacity && open !== "marker" ? (
        <span className="hw-nb-opacity">{Math.round((opacity || 0.28) * 100)}%</span>
      ) : null}
    </div>
  );
}
