import { useEffect, useState } from "react";
import {
  ArrowLeftRight,
  ArrowRight,
  ArrowUpRight,
  AppWindow,
  BarChart3,
  Baseline,
  BookOpen,
  Braces,
  Calculator,
  Camera,
  Circle,
  CircleDot,
  ClipboardCheck,
  ClipboardPaste,
  Cloud,
  Code,
  Crosshair,
  Columns3,
  Diamond,
  Equal,
  File,
  FileText,
  GalleryHorizontal,
  Grid3x3,
  Hand,
  Heading1,
  House,
  Image,
  Languages,
  Lightbulb,
  Link2,
  List,
  Merge,
  MessageCircle,
  Minus,
  Network,
  Pencil,
  Play,
  Plus,
  Presentation,
  QrCode,
  Rows3,
  Search,
  Smile,
  Sparkles,
  Spline,
  Square,
  SquareDashed,
  StickyNote,
  Tag,
  Timer,
  Triangle,
  Type,
  Video,
  Workflow,
} from "lucide-react";
import { useEditor, useTools, useValue } from "tldraw";

import { setPendingFormula, setPendingGraph, setPendingTask } from "./lessonShapes";
import {
  addTableColumn,
  addTableRow,
  applyCustomColor,
  lessonInkChoices,
  savedCustomColors,
  applyOpacity,
  applyStyle,
  applyThickness,
  chooseGeo,
  chooseLink,
  chooseSticker,
  chooseTextKind,
  chooseTool,
  fileToImage,
  insertBoardFile,
  insertPdfFile,
  insertTable,
  insertTemplate,
  mergeTableCells,
  placeBracket,
  readClipboardImage,
  setPenMode,
  writeCellFormula,
  DefaultColorStyle,
  DefaultDashStyle,
  DefaultSizeStyle,
} from "./lessonBoardActions";
import {
  LESSON_EMOJIS,
  LESSON_FORMULAS,
  LESSON_INK_COLORS,
  LESSON_LINKS,
  LESSON_SIZE_STEPS,
  LESSON_STROKE_BASE,
  LESSON_THICKNESS_MAX,
  LESSON_THICKNESS_MIN,
  clampLessonThickness,
  getLessonThickness,
  subscribeLessonThickness,
  LESSON_MORE,
  LESSON_SHAPES,
  LESSON_STICKER_COLORS,
  LESSON_TASKS,
  LESSON_TEMPLATES,
  LESSON_TEXT_KINDS,
} from "./lessonShell";

const FORMULA_FACE = {
  pi: "π",
  sum: "∑",
  sqrt: "√",
  inf: "∞",
  pm: "±",
  times: "×",
  le: "≤",
  neq: "≠",
  frac: "½",
  power: "xⁿ",
  root: "√x",
  index: "xᵢ",
  system: "{ }",
  integral: "∫",
  log: "log",
};

const GRAPH_FLAGS = [
  { id: "grid", label: "Сетка", icon: Grid3x3 },
  { id: "axes", label: "Оси", icon: Plus },
  { id: "labels", label: "Подписи", icon: Tag },
];

const TASK_ICONS = {
  bank: Search,
  insert: Plus,
  empty: Square,
  ai: Sparkles,
  homework: House,
};

const TEMPLATE_ICONS = {
  explain: BookOpen,
  solve: Calculator,
  brainstorm: Lightbulb,
  lesson: Presentation,
  plan: List,
  reflect: MessageCircle,
  vocab: Languages,
  cards: GalleryHorizontal,
  test: ClipboardCheck,
  timeline: Minus,
  mindmap: Network,
};

const MORE_ICONS = {
  frame: Square,
  line: Minus,
  embed: AppWindow,
};

export function LessonFlyout({ menu, overflow = [], onClose }) {
  if (menu === "pen" || menu === "draw") return <PenMenu />;
  if (menu === "text") return <TextMenu onClose={onClose} />;
  if (menu === "sticker" || menu === "note") return <StickerMenu onClose={onClose} />;
  if (menu === "shapes") return <ShapeMenu onClose={onClose} />;
  if (menu === "link") return <LinkMenu onClose={onClose} />;
  if (menu === "formula") return <FormulaMenu />;
  if (menu === "graph") return <GraphMenu />;
  if (menu === "table") return <TableMenu />;
  if (menu === "insert" || menu === "files") return <InsertMenu />;
  if (menu === "task" || menu === "tasks" || menu === "homework") return <TaskMenu homework={menu === "homework"} />;
  if (menu === "templates") return <TemplateMenu onClose={onClose} />;
  if (menu === "more") return <MoreMenu overflow={overflow} onClose={onClose} />;
  return null;
}

function PenMenu() {
  const editor = useEditor();
  const toolId = useValue("lesson-pen-tool", () => editor.getCurrentToolId(), [editor]);
  const stylusOnly = useValue("lesson-pen-mode", () => editor.getInstanceState().isPenMode, [editor]);
  return (
    <div className="lesson-flyout__body lesson-flyout__body--pen">
      <div className="lesson-icon-row" role="toolbar" aria-label="Перо">
        <IconButton label="Карандаш" pressed={toolId === "draw"} onClick={() => chooseTool(editor, "draw")}><InkToolIcon icon={Pencil} active={toolId === "draw"} /></IconButton>
        <IconButton label="Рисовать пальцем" pressed={!stylusOnly} onClick={() => setPenMode(editor, !stylusOnly)}><Hand size={18} strokeWidth={1.75} /></IconButton>
      </div>
      <div className="lesson-pen-grid">
        <ColorRow allowCustom colors={LESSON_INK_COLORS} />
        <ThicknessSlider />
      </div>
      <OpacitySlider />
    </div>
  );
}

function TextMenu({ onClose }) {
  const editor = useEditor();
  const icons = { body: Type, heading: Heading1, caption: Baseline };
  return (
    <div className="lesson-flyout__body">
      <div className="lesson-icon-row" role="toolbar" aria-label="Текст">
        {LESSON_TEXT_KINDS.map((item) => {
          const Icon = icons[item.id];
          return (
            <IconButton
              key={item.id}
              label={item.label}
              onClick={() => {
                chooseTextKind(editor, item.size);
                onClose();
              }}
            >
              <Icon size={18} strokeWidth={1.75} />
            </IconButton>
          );
        })}
      </div>
    </div>
  );
}

function StickerMenu({ onClose }) {
  const editor = useEditor();
  return (
    <div className="lesson-flyout__body">
      <ColorRow colors={LESSON_STICKER_COLORS} onPick={(color) => { chooseSticker(editor, color); onClose(); }} />
    </div>
  );
}

const SHAPE_ICONS = {
  rectangle: Square,
  rounded: Square,
  ellipse: Circle,
  triangle: Triangle,
  diamond: Diamond,
  line: Minus,
  arrow: ArrowUpRight,
  cloud: Cloud,
  bracket: Braces,
};

function ShapeMenu({ onClose }) {
  const editor = useEditor();
  return (
    <div className="lesson-flyout__body">
      <div className="lesson-icon-row" role="toolbar" aria-label="Фигуры">
        {LESSON_SHAPES.map((item) => {
          const Icon = SHAPE_ICONS[item.id] || Square;
          return (
            <IconButton
              key={item.id}
              label={item.label}
              onClick={() => {
                if (item.tool === "bracket") placeBracket(editor);
                else if (item.geo) chooseGeo(editor, item.geo);
                else chooseTool(editor, item.tool);
                onClose();
              }}
            >
              <Icon size={18} strokeWidth={1.75} />
            </IconButton>
          );
        })}
      </div>
    </div>
  );
}

const LINK_ICONS = {
  plain: Minus,
  arrow: ArrowRight,
  both: ArrowLeftRight,
  dashed: Spline,
  bind: Link2,
};

function LinkMenu({ onClose }) {
  const editor = useEditor();
  return (
    <div className="lesson-flyout__body">
      <div className="lesson-icon-row" role="toolbar" aria-label="Связь">
        {LESSON_LINKS.map((item) => {
          const Icon = LINK_ICONS[item.id] || Minus;
          return (
            <IconButton
              key={item.id}
              label={item.label}
              onClick={() => {
                chooseLink(editor, item.id === "bind" ? "arrow" : item.id);
                onClose();
              }}
            >
              <Icon size={18} strokeWidth={1.75} />
            </IconButton>
          );
        })}
      </div>
    </div>
  );
}

function FormulaMenu() {
  const editor = useEditor();
  const [tex, setTex] = useState("");
  const [status, setStatus] = useState("");
  function place(value) {
    setPendingFormula(value || tex);
    chooseTool(editor, "formula");
    setStatus("");
  }
  return (
    <div className="lesson-flyout__body">
      <div className="lesson-formula">
        {LESSON_FORMULAS.map((item) => (
          <IconButton key={item.id} label={item.label} onClick={() => setTex((value) => (value ? `${value} ${item.tex}` : item.tex))}>
            <span className="lesson-flyout__glyph">{FORMULA_FACE[item.id] || item.label}</span>
          </IconButton>
        ))}
      </div>
      <label className="lesson-field">
        <input value={tex} aria-label="LaTeX" onChange={(event) => setTex(event.target.value)} placeholder="y = x^2" />
      </label>
      <IconButton label="Вставить формулу" onClick={() => place(tex)}><Play size={18} strokeWidth={1.75} /></IconButton>
      {status ? <p className="lesson-flyout__note">{status}</p> : null}
    </div>
  );
}

function GraphMenu() {
  const editor = useEditor();
  const [expression, setExpression] = useState("x^2");
  const [min, setMin] = useState("-4");
  const [max, setMax] = useState("4");
  const [flags, setFlags] = useState({ grid: true, axes: true, labels: true });
  const [error, setError] = useState("");
  function toggle(key) {
    setFlags((current) => ({ ...current, [key]: !current[key] }));
  }
  return (
    <div className="lesson-flyout__body">
      <label className="lesson-field">
        <input aria-label="Функция" value={expression} onChange={(event) => setExpression(event.target.value)} placeholder="y = x^2" />
      </label>
      <div className="lesson-field-row">
        <label className="lesson-field">
          <input aria-label="Начало диапазона" value={min} onChange={(event) => setMin(event.target.value)} />
        </label>
        <label className="lesson-field">
          <input aria-label="Конец диапазона" value={max} onChange={(event) => setMax(event.target.value)} />
        </label>
      </div>
      <div className="lesson-icon-row" role="toolbar" aria-label="Вид графика">
        {GRAPH_FLAGS.map((item) => (
          <IconButton key={item.id} label={item.label} pressed={flags[item.id]} onClick={() => toggle(item.id)}>
            <item.icon size={18} strokeWidth={1.75} />
          </IconButton>
        ))}
      </div>
      <IconButton
        label="Построить"
        onClick={() => {
          const ok = setPendingGraph({
            expression,
            xMin: Number(min),
            xMax: Number(max),
            yMin: Number(min),
            yMax: Number(max),
            showGrid: flags.grid,
            showAxes: flags.axes,
            showLabels: flags.labels,
          });
          if (!ok) {
            setError("Формула не разобралась. Пример: x^2 или sin(x).");
            return;
          }
          chooseTool(editor, "graph");
          setError("");
        }}
      >
        <Play size={18} strokeWidth={1.75} />
      </IconButton>
      {error ? <p className="lesson-flyout__note">{error}</p> : null}
    </div>
  );
}

function TableMenu() {
  const editor = useEditor();
  const [hover, setHover] = useState({ rows: 3, cols: 4 });
  const [formula, setFormula] = useState("");
  return (
    <div className="lesson-flyout__body">
      <div className="lesson-table-pick" role="grid" aria-label="Размер таблицы">
        {Array.from({ length: 5 }, (_, row) => (
          <span key={row}>
            {Array.from({ length: 6 }, (_, col) => (
              <button
                key={col}
                type="button"
                className={row < hover.rows && col < hover.cols ? "is-on" : ""}
                aria-label={`${col + 1} на ${row + 1}`}
                onMouseEnter={() => setHover({ rows: row + 1, cols: col + 1 })}
                onClick={() => insertTable(editor, row + 1, col + 1)}
              />
            ))}
          </span>
        ))}
      </div>
      <p className="lesson-flyout__note">{hover.cols} × {hover.rows}</p>
      <div className="lesson-icon-row" role="toolbar" aria-label="Таблица">
        <IconButton label="Добавить строку" onClick={() => addTableRow(editor)}><Rows3 size={18} strokeWidth={1.75} /></IconButton>
        <IconButton label="Добавить столбец" onClick={() => addTableColumn(editor)}><Columns3 size={18} strokeWidth={1.75} /></IconButton>
        <IconButton label="Объединить ячейки" onClick={() => mergeTableCells(editor)}><Merge size={18} strokeWidth={1.75} /></IconButton>
        <IconButton label="Границы" onClick={() => applyStyle(editor, DefaultDashStyle, "dashed")}><SquareDashed size={18} strokeWidth={1.75} /></IconButton>
      </div>
      <label className="lesson-field">
        <input aria-label="Формула ячейки" value={formula} onChange={(event) => setFormula(event.target.value)} placeholder="2+2" />
      </label>
      <IconButton label="Посчитать" onClick={() => writeCellFormula(editor, formula)}><Equal size={18} strokeWidth={1.75} /></IconButton>
    </div>
  );
}

function InsertMenu() {
  const editor = useEditor();
  const tools = useTools();
  const [status, setStatus] = useState("");
  async function onFile(event, kind) {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file) return;
    setStatus("");
    if (kind === "pdf" || file.type === "application/pdf") {
      setStatus(await insertPdfFile(editor, file));
      return;
    }
    if (file.type.startsWith("image/")) {
      try {
        await fileToImage(editor, file);
      } catch (error) {
        setStatus(error?.message || "Изображение не удалось добавить");
      }
      return;
    }
    setStatus(await insertBoardFile(editor, file));
  }
  return (
    <div className="lesson-flyout__body">
      <div className="lesson-icon-row" role="toolbar" aria-label="Вставить">
        <FileIcon label="Изображение" accept="image/*" onFile={(event) => onFile(event, "image")}><Image size={18} strokeWidth={1.75} /></FileIcon>
        <FileIcon label="PDF" accept="application/pdf" onFile={(event) => onFile(event, "pdf")}><FileText size={18} strokeWidth={1.75} /></FileIcon>
        <FileIcon label="Файл" onFile={(event) => onFile(event, "file")}><File size={18} strokeWidth={1.75} /></FileIcon>
        <FileIcon label="Скриншот" accept="image/*" onFile={(event) => onFile(event, "image")}><Camera size={18} strokeWidth={1.75} /></FileIcon>
        <IconButton
          label="Вставка из буфера"
          onClick={async () => {
            const ok = await readClipboardImage(editor).catch(() => false);
            setStatus(ok ? "" : "В буфере нет картинки или текста");
          }}
        >
          <ClipboardPaste size={18} strokeWidth={1.75} />
        </IconButton>
        <IconButton label="Встроить" onClick={() => tools.embed?.onSelect("toolbar")}><AppWindow size={18} strokeWidth={1.75} /></IconButton>
      </div>
      {status ? <p className="lesson-flyout__note">{status}</p> : null}
    </div>
  );
}

function TaskMenu({ homework }) {
  const editor = useEditor();
  const [title, setTitle] = useState("");
  const [hint, setHint] = useState("");
  return (
    <div className="lesson-flyout__body">
      <p className="lesson-flyout__note">Выберите задание, затем кликните по доске.</p>
      <label className="lesson-field">
        <input aria-label="Название задания" value={title} placeholder="Название" onChange={(event) => setTitle(event.target.value)} />
      </label>
      <div className="lesson-icon-row" role="toolbar" aria-label="Задание">
        {LESSON_TASKS.map((item) => {
          const Icon = TASK_ICONS[item.id];
          return (
            <IconButton
              key={item.id}
              label={item.label}
              onClick={() => {
                const typed = title.trim();
                if ((item.id === "bank" || item.id === "insert") && !typed) {
                  setHint("Сначала введите название.");
                  return;
                }
                const name = typed || (item.id === "homework" || homework ? "Домашнее задание" : "Задание");
                const body = item.id === "ai"
                  ? "1. Сформулируй правило\n2. Разбери пример\n3. Реши похожее"
                  : "";
                setPendingTask({
                  taskId: item.id === "bank" ? `bank:${name}` : "",
                  title: item.id === "bank" ? `Банк: ${name}` : name,
                  condition: body,
                });
                chooseTool(editor, "task");
                setHint("Кликните по доске, чтобы поставить карточку.");
              }}
            >
              <Icon size={18} strokeWidth={1.75} />
            </IconButton>
          );
        })}
      </div>
      {hint ? <p className="lesson-flyout__note">{hint}</p> : null}
    </div>
  );
}

function TemplateMenu({ onClose }) {
  const editor = useEditor();
  return (
    <div className="lesson-flyout__body">
      <div className="lesson-icon-row" role="toolbar" aria-label="Шаблоны">
        {LESSON_TEMPLATES.map((item) => {
          const Icon = TEMPLATE_ICONS[item.id] || Square;
          return (
            <IconButton
              key={item.id}
              label={item.label}
              onClick={() => {
                insertTemplate(editor, item);
                onClose();
              }}
            >
              <Icon size={18} strokeWidth={1.75} />
            </IconButton>
          );
        })}
      </div>
    </div>
  );
}

function MoreMenu({ overflow = [], onClose }) {
  const editor = useEditor();
  const tools = useTools();
  const [insertOpen, setInsertOpen] = useState(false);
  return (
    <div className="lesson-flyout__body">
      <div className="lesson-icon-row" role="toolbar" aria-label="Ещё">
        {overflow.map((item) => {
          const OverflowIcon = { laser: Crosshair, note: StickyNote, insert: Image }[item.id] || Plus;
          return (
            <IconButton
              key={item.id}
              label={item.kbd ? `${item.label}  ${item.kbd}` : item.label}
              onClick={() => {
                if (item.id === "insert") {
                  setInsertOpen(true);
                  return;
                }
                if (item.tool) chooseTool(editor, item.tool);
                onClose();
              }}
            >
              <OverflowIcon size={18} strokeWidth={1.75} />
            </IconButton>
          );
        })}
        {insertOpen ? <InsertMenu /> : null}
        {LESSON_MORE.map((item) => {
          const Icon = MORE_ICONS[item.id] || Plus;
          return (
            <IconButton
              key={item.id}
              label={item.kbd ? `${item.label}  ${item.kbd}` : item.label}
              onClick={() => {
                if (item.tool === "embed") tools.embed?.onSelect("toolbar");
                else chooseTool(editor, item.tool);
                onClose();
              }}
            >
              <Icon size={18} strokeWidth={1.75} />
            </IconButton>
          );
        })}
      </div>
    </div>
  );
}

export function ColorDot({ color = "#111" }) {
  return <span className="lesson-swatch__dot" style={{ background: color }} />;
}

export function BrushStroke({ color = "#111", width = 18, thickness = 2.6, opacity = 1 }) {
  return (
    <svg className="lesson-brush" width={width} height="10" viewBox="0 0 20 10" aria-hidden="true">
      <path
        d="M1.5 6.4C4.2 3.2 7.2 7.6 10.6 4.4S16.2 6.2 18.6 3.4"
        fill="none"
        stroke={color}
        strokeWidth={thickness}
        strokeLinecap="round"
        strokeLinejoin="round"
        opacity={opacity}
      />
    </svg>
  );
}

function InkToolIcon({ icon: Icon, active }) {
  const color = useInkColor();
  return <Icon size={18} strokeWidth={1.75} color={active ? color : "currentColor"} />;
}

function ColorRow({ colors = LESSON_INK_COLORS, onPick, allowCustom = false, ink = "solid" }) {
  const editor = useEditor();
  const themeColors = useValue(
    "lesson-menu-colors",
    () => editor.getCurrentTheme().colors[editor.getColorMode()],
    [editor],
  );
  const selected = useValue("lesson-menu-color-id", () => {
    const shared = editor.getSharedStyles().get(DefaultColorStyle);
    return shared?.type === "shared" ? shared.value : "black";
  }, [editor]);
  const choices = lessonInkChoices(colors, selected);
  const paletteHex = savedCustomColors()[0]?.hex || "#e11d48";
  return (
    <span className="lesson-context__colors" role="group" aria-label="Цвет">
      {choices.map((item) => (
        <button
          key={item.id}
          type="button"
          className="lesson-swatch"
          aria-label={item.label}
          aria-pressed={onPick ? undefined : selected === item.id}
          onClick={() => (onPick ? onPick(item.id) : applyStyle(editor, DefaultColorStyle, item.id))}
        >
          <ColorDot color={inkColor(themeColors, item.id, ink)} />
        </button>
      ))}
      {allowCustom ? (
        <label className="lesson-swatch lesson-swatch--custom" aria-label="Другой цвет">
          <span className="lesson-brush-rainbow" />
          <input type="color" value={paletteHex} onChange={(event) => applyCustomColor(editor, event.target.value)} />
        </label>
      ) : null}
    </span>
  );
}

function inkColor(palette, id, ink) {
  const entry = palette?.[id];
  if (!entry) return "#111";
  if (ink === "highlight") return entry.highlightSrgb || entry.solid || "#111";
  return entry.solid || "#111";
}

export function useInkColor() {
  const editor = useEditor();
  const marker = useValue("lesson-ink-tool", () => editor.getCurrentToolId() === "highlight", [editor]);
  return useValue(
    "lesson-ink-color",
    () => {
      const shared = editor.getSharedStyles().get(DefaultColorStyle);
      const id = shared?.type === "shared" ? shared.value : "black";
      const theme = editor.getCurrentTheme();
      const palette = theme?.colors?.[editor.getColorMode()];
      return inkColor(palette, id, marker ? "highlight" : "solid");
    },
    [editor, marker],
  );
}

export function ThicknessSlider() {
  const editor = useEditor();
  const color = useInkColor();
  const [value, setValue] = useState(getLessonThickness);
  useEffect(() => subscribeLessonThickness(() => setValue(getLessonThickness())), []);
  const selectedScale = useValue("lesson-thickness-selected", () => {
    const shapes = editor.getSelectedShapes().filter((shape) => (
      (shape.type === "draw" || shape.type === "highlight" || shape.type === "line")
      && typeof shape.props?.scale === "number"
    ));
    if (!shapes.length) return null;
    const scale = shapes[0].props.scale;
    return shapes.every((shape) => shape.props.scale === scale) ? scale : null;
  }, [editor]);
  const shown = selectedScale == null ? value : clampLessonThickness(selectedScale * LESSON_STROKE_BASE);
  const percent = ((shown - LESSON_THICKNESS_MIN) / (LESSON_THICKNESS_MAX - LESSON_THICKNESS_MIN)) * 100;
  return (
    <label className="lesson-slider">
      <BrushStroke color={color} thickness={Math.max(1.5, shown / 12)} />
      <input
        type="range"
        min={LESSON_THICKNESS_MIN}
        max={LESSON_THICKNESS_MAX}
        step="1"
        value={shown}
        aria-label="Толщина штриха"
        style={{ "--lesson-slider": `${percent}%` }}
        onChange={(event) => applyThickness(editor, Number(event.target.value))}
      />
      <span className="lesson-slider__value">{shown}</span>
    </label>
  );
}

export function StrokeSizePicker() {
  const editor = useEditor();
  const color = useInkColor();
  const size = useValue("lesson-stroke-size", () => {
    const shared = editor.getSharedStyles().get(DefaultSizeStyle);
    return shared?.type === "shared" ? shared.value : "m";
  }, [editor]);
  return (
    <span className="lesson-size" role="group" aria-label="Размер">
      {LESSON_SIZE_STEPS.map((step) => (
        <button
          key={step.id}
          type="button"
          className="lesson-size__step"
          aria-label={step.label}
          aria-pressed={size === step.id}
          onClick={() => applyStyle(editor, DefaultSizeStyle, step.id)}
        >
          <BrushStroke color={color} thickness={Math.max(1.6, step.dot / 5)} />
        </button>
      ))}
    </span>
  );
}

export function OpacityMark({ color, opacity }) {
  return <BrushStroke color={color} opacity={opacity ?? 1} />;
}

export function OpacitySlider() {
  const editor = useEditor();
  const color = useInkColor();
  const value = useValue("lesson-menu-opacity", () => {
    const shared = editor.getSharedOpacity();
    return shared?.type === "shared" ? shared.value : 1;
  }, [editor]);
  const percent = Math.round((value ?? 1) * 100);
  return (
    <label className="lesson-slider">
      <OpacityMark color={color} opacity={value ?? 1} />
      <input
        type="range"
        min="0"
        max="100"
        step="1"
        value={percent}
        aria-label="Прозрачность"
        style={{ "--lesson-slider": `${percent}%` }}
        onChange={(event) => applyOpacity(editor, Number(event.target.value) / 100)}
      />
      <span className="lesson-slider__value">{percent}%</span>
    </label>
  );
}

function IconButton({ label, pressed, onClick, children }) {
  const [open, setOpen] = useState(false);
  return (
    <span
      className="lesson-flyout__slot"
      onMouseEnter={() => setOpen(true)}
      onMouseLeave={() => setOpen(false)}
      onFocus={() => setOpen(true)}
      onBlur={() => setOpen(false)}
    >
      <button
        type="button"
        className="lesson-flyout__icon"
        aria-label={label}
        aria-pressed={pressed || undefined}
        onClick={onClick}
      >
        {children}
      </button>
      {open ? <span className="lesson-flyout__hint">{label}</span> : null}
    </span>
  );
}

function FileIcon({ label, accept, onFile, children }) {
  const [open, setOpen] = useState(false);
  return (
    <span
      className="lesson-flyout__slot"
      onMouseEnter={() => setOpen(true)}
      onMouseLeave={() => setOpen(false)}
      onFocus={() => setOpen(true)}
      onBlur={() => setOpen(false)}
    >
      <label className="lesson-flyout__icon" aria-label={label}>
        {children}
        <input className="lesson-sr" type="file" accept={accept} onChange={onFile} />
      </label>
      {open ? <span className="lesson-flyout__hint">{label}</span> : null}
    </span>
  );
}
