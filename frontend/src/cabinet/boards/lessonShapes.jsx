/* Shape utils stay beside their views so TldrawBoard does not export the editor map. */
/* eslint-disable react-refresh/only-export-components */
import { useEffect, useRef, useState } from "react";
import {
  BaseBoxShapeTool,
  BaseBoxShapeUtil,
  HTMLContainer,
  HighlightShapeUtil,
  NoteShapeUtil,
  T,
  createShapePropsMigrationIds,
  createShapePropsMigrationSequence,
  stopEventPropagation,
  useEditor,
  useValue,
} from "tldraw";

import { lessonGraphPoints, lessonStickerResize } from "./lessonShell";

const formulaVersions = createShapePropsMigrationIds("formula", { Init: 1, Defaults: 2 });
const graphVersions = createShapePropsMigrationIds("graph", { Init: 1, Defaults: 2 });
const taskVersions = createShapePropsMigrationIds("task", { Init: 1, Defaults: 2 });

function applyLessonShapeDefaults(type, props) {
  if (!props || typeof props !== "object") return props;
  if (typeof props.w !== "number") props.w = type === "graph" ? 360 : type === "task" ? 320 : 280;
  if (typeof props.h !== "number") props.h = type === "graph" ? 240 : type === "task" ? 180 : 96;
  if (type === "formula") {
    if (typeof props.latex !== "string") props.latex = "x";
    if (typeof props.fontSize !== "number") props.fontSize = 22;
  } else if (type === "graph") {
    if (!Array.isArray(props.functions)) props.functions = ["x"];
    if (typeof props.xMin !== "number") props.xMin = -4;
    if (typeof props.xMax !== "number") props.xMax = 4;
    if (typeof props.yMin !== "number") props.yMin = -4;
    if (typeof props.yMax !== "number") props.yMax = 4;
    if (typeof props.showGrid !== "boolean") props.showGrid = true;
    if (typeof props.showAxes !== "boolean") props.showAxes = true;
    if (typeof props.showLabels !== "boolean") props.showLabels = true;
  } else if (type === "task") {
    if (typeof props.taskId !== "string") props.taskId = "";
    if (typeof props.title !== "string") props.title = "Задание";
    if (typeof props.condition !== "string") props.condition = "";
  }
  return props;
}

const formulaMigrations = createShapePropsMigrationSequence({
  sequence: [
    { id: formulaVersions.Init, up: (props) => props },
    { id: formulaVersions.Defaults, up: (props) => applyLessonShapeDefaults("formula", props) },
  ],
});
const graphMigrations = createShapePropsMigrationSequence({
  sequence: [
    { id: graphVersions.Init, up: (props) => props },
    { id: graphVersions.Defaults, up: (props) => applyLessonShapeDefaults("graph", props) },
  ],
});
const taskMigrations = createShapePropsMigrationSequence({
  sequence: [
    { id: taskVersions.Init, up: (props) => props },
    { id: taskVersions.Defaults, up: (props) => applyLessonShapeDefaults("task", props) },
  ],
});

let pendingFormula = "x^{2}";
let pendingGraph = {
  functions: ["x^2"],
  xMin: -4,
  xMax: 4,
  yMin: -4,
  yMax: 4,
  showGrid: true,
  showAxes: true,
  showLabels: true,
};
let pendingTask = { taskId: "", title: "Задание", condition: "" };

export function setPendingFormula(latex) {
  pendingFormula = String(latex || "").trim() || "x";
  return pendingFormula;
}

export function setPendingGraph(next) {
  const expression = String(next?.functions?.[0] || next?.expression || "").trim();
  const xMin = Number(next?.xMin);
  const xMax = Number(next?.xMax);
  const yMin = Number(next?.yMin);
  const yMax = Number(next?.yMax);
  if (!lessonGraphPoints(expression, xMin, xMax, 4)) return false;
  pendingGraph = {
    functions: [expression],
    xMin,
    xMax,
    yMin: Number.isFinite(yMin) ? yMin : xMin,
    yMax: Number.isFinite(yMax) ? yMax : xMax,
    showGrid: next?.showGrid !== false,
    showAxes: next?.showAxes !== false,
    showLabels: next?.showLabels !== false,
  };
  return true;
}

export function setPendingTask(next) {
  pendingTask = {
    taskId: String(next?.taskId || ""),
    title: String(next?.title || "Задание"),
    condition: String(next?.condition || ""),
  };
  return pendingTask;
}

function boxPath(shape) {
  const path = new Path2D();
  path.rect(0, 0, shape.props.w, shape.props.h);
  return path;
}

function saveProps(editor, shape, props) {
  editor.updateShape({ id: shape.id, type: shape.type, props });
  editor.setEditingShape(null);
}

export class FormulaShapeUtil extends BaseBoxShapeUtil {
  static type = "formula";
  static props = {
    w: T.number,
    h: T.number,
    latex: T.string,
    fontSize: T.number,
  };
  static migrations = formulaMigrations;

  getDefaultProps() {
    return { w: 280, h: 96, latex: pendingFormula, fontSize: 22 };
  }

  onResize(shape, info) {
    const next = super.onResize(shape, info);
    const width = Math.max(1, shape.props.w);
    const height = Math.max(1, shape.props.h);
    const factor = Math.sqrt(Math.abs((next.props.w / width) * (next.props.h / height))) || 1;
    return {
      ...next,
      props: {
        ...next.props,
        fontSize: Math.max(14, Math.min(72, Math.round(shape.props.fontSize * factor))),
      },
    };
  }

  component(shape) {
    return <FormulaBody shape={shape} />;
  }

  getIndicatorPath(shape) {
    return boxPath(shape);
  }

  canEdit() {
    return true;
  }

  canBind() {
    return true;
  }

  toSvg(shape) {
    return (
      <svg width={shape.props.w} height={shape.props.h}>
        <rect width={shape.props.w} height={shape.props.h} rx="12" fill="#ffffff" stroke="#d7dde6" />
        <text x="16" y={shape.props.h / 2} fontSize={shape.props.fontSize} fontFamily="serif">
          {shape.props.latex}
        </text>
      </svg>
    );
  }
}

const FORMULA_SNIPPETS = [
  { label: "Дробь", tex: "\\frac{a}{b}" },
  { label: "Корень", tex: "\\sqrt{x}" },
  { label: "Степень", tex: "x^{n}" },
  { label: "Индекс", tex: "x_{n}" },
];

function FormulaBody({ shape }) {
  const editor = useEditor();
  const editing = useValue("lesson-formula-edit", () => editor.getEditingShapeId() === shape.id, [editor, shape.id]);
  const [draft, setDraft] = useState(shape.props.latex);
  const [error, setError] = useState("");
  const wasEditing = useRef(false);
  useEffect(() => {
    if (editing && !wasEditing.current) {
      setDraft(shape.props.latex);
      setError("");
    }
    wasEditing.current = editing;
  }, [editing, shape.props.latex]);
  function close(save) {
    if (!save) {
      editor.setEditingShape(null);
      if (!String(shape.props.latex || "").trim()) editor.deleteShapes([shape.id]);
      return;
    }
    const latex = draft.trim();
    if (!latex) {
      editor.deleteShapes([shape.id]);
      return;
    }
    if (/[{}]/.test(latex) && (latex.split("{").length !== latex.split("}").length)) {
      setError("В формуле не закрыта скобка.");
      return;
    }
    const minW = Math.max(160, Math.min(720, latex.length * shape.props.fontSize * 0.5 + 32));
    saveProps(editor, shape, { latex, w: Math.max(shape.props.w, minW) });
  }
  return (
    <HTMLContainer className={`lesson-card${editing ? " lesson-card--editing" : ""}`} style={editing ? { pointerEvents: "auto" } : undefined}>
      {editing ? (
        <div className="lesson-card__form" onPointerDown={stopEventPropagation}>
          <input
            className="lesson-card__input"
            aria-label="Формула"
            value={draft}
            autoFocus
            onChange={(event) => {
              setDraft(event.target.value);
              setError("");
            }}
            onKeyDown={(event) => {
              event.stopPropagation();
              if (event.key === "Escape") close(false);
              if (event.key === "Enter" && (event.metaKey || event.ctrlKey)) close(true);
            }}
          />
          <span className="lesson-card__snippets">
            {FORMULA_SNIPPETS.map((item) => (
              <button key={item.label} type="button" onClick={() => setDraft((value) => (value ? `${value} ${item.tex}` : item.tex))}>
                {item.label}
              </button>
            ))}
          </span>
          {error ? <span className="lesson-card__error">{error}</span> : null}
          <button type="button" onClick={() => close(true)}>Сохранить</button>
        </div>
      ) : (
        <span className="lesson-card__formula" style={{ fontSize: shape.props.fontSize }}>{shape.props.latex || "Формула"}</span>
      )}
    </HTMLContainer>
  );
}

export class FormulaShapeTool extends BaseBoxShapeTool {
  static id = "formula";
  static initial = "idle";
  shapeType = "formula";

  onEnter() {
    this.createdId = null;
    this.dispose = this.editor.sideEffects.registerAfterCreateHandler("shape", (shape, source) => {
      if (source === "user" && shape.type === "formula") this.createdId = shape.id;
    });
  }

  onExit() {
    this.dispose?.();
    const id = this.createdId;
    this.createdId = null;
    if (!id) return;
    const shape = this.editor.getShape(id);
    if (!shape || shape.props.w < 8 || shape.props.h < 8) return;
    this.editor.setEditingShape(id);
  }
}

export class GraphShapeUtil extends BaseBoxShapeUtil {
  static type = "graph";
  static props = {
    w: T.number,
    h: T.number,
    functions: T.arrayOf(T.string),
    xMin: T.number,
    xMax: T.number,
    yMin: T.number,
    yMax: T.number,
    showGrid: T.boolean,
    showAxes: T.boolean,
    showLabels: T.boolean,
  };
  static migrations = graphMigrations;

  getDefaultProps() {
    return { w: 360, h: 240, ...pendingGraph, functions: [...pendingGraph.functions] };
  }

  component(shape) {
    return <GraphBody shape={shape} />;
  }

  getIndicatorPath(shape) {
    return boxPath(shape);
  }

  canEdit() {
    return true;
  }

  canBind() {
    return true;
  }

  toSvg(shape) {
    return <GraphSvg shape={shape} />;
  }
}

function graphPolyline(shape) {
  const { w, h, functions, xMin, xMax, yMin, yMax } = shape.props;
  const raw = lessonGraphPoints(functions[0] || "", xMin, xMax, 48);
  if (!raw) return "";
  const xSpan = xMax - xMin || 1;
  const ySpan = yMax - yMin || 1;
  return raw
    .map((point) => {
      const mathY = -point.y;
      const x = ((point.x - xMin) / xSpan) * w;
      const y = h - ((mathY - yMin) / ySpan) * h;
      return `${x},${y}`;
    })
    .join(" ");
}

function GraphSvg({ shape }) {
  const { w, h, showGrid, showAxes, showLabels, xMin, xMax, yMin, yMax, functions } = shape.props;
  const xSpan = xMax - xMin || 1;
  const ySpan = yMax - yMin || 1;
  const originX = ((0 - xMin) / xSpan) * w;
  const originY = h - ((0 - yMin) / ySpan) * h;
  const lines = [];
  if (showGrid) {
    for (let step = 1; step < 4; step += 1) {
      const x = (w * step) / 4;
      const y = (h * step) / 4;
      lines.push(<line key={`vx${step}`} x1={x} y1={0} x2={x} y2={h} stroke="#e6e8ec" />);
      lines.push(<line key={`hy${step}`} x1={0} y1={y} x2={w} y2={y} stroke="#e6e8ec" />);
    }
  }
  return (
    <svg width={w} height={h} className="lesson-card__graph">
      <rect width={w} height={h} rx="12" fill="#ffffff" stroke="#d7dde6" />
      {lines}
      {showAxes ? <line x1={originX} y1={0} x2={originX} y2={h} stroke="#94a3b8" /> : null}
      {showAxes ? <line x1={0} y1={originY} x2={w} y2={originY} stroke="#94a3b8" /> : null}
      <polyline points={graphPolyline(shape)} fill="none" stroke="#2563eb" strokeWidth="2" />
      {showLabels ? <text x="12" y="20" fontSize="12" fill="#64748b">{functions[0]}</text> : null}
    </svg>
  );
}

function GraphBody({ shape }) {
  const editor = useEditor();
  const editing = useValue("lesson-graph-edit", () => editor.getEditingShapeId() === shape.id, [editor, shape.id]);
  const [expression, setExpression] = useState(shape.props.functions[0] || "");
  const [xMin, setXMin] = useState(String(shape.props.xMin));
  const [xMax, setXMax] = useState(String(shape.props.xMax));
  const [yMin, setYMin] = useState(String(shape.props.yMin));
  const [yMax, setYMax] = useState(String(shape.props.yMax));
  const [flags, setFlags] = useState({
    grid: shape.props.showGrid,
    axes: shape.props.showAxes,
    labels: shape.props.showLabels,
  });
  const [error, setError] = useState("");
  const wasEditing = useRef(false);
  useEffect(() => {
    if (editing && !wasEditing.current) {
      setExpression(shape.props.functions[0] || "");
      setXMin(String(shape.props.xMin));
      setXMax(String(shape.props.xMax));
      setYMin(String(shape.props.yMin));
      setYMax(String(shape.props.yMax));
      setFlags({
        grid: shape.props.showGrid,
        axes: shape.props.showAxes,
        labels: shape.props.showLabels,
      });
      setError("");
    }
    wasEditing.current = editing;
  }, [editing, shape]);
  function commit() {
    const next = {
      functions: [expression.trim()],
      xMin: Number(xMin),
      xMax: Number(xMax),
      yMin: Number(yMin),
      yMax: Number(yMax),
      showGrid: flags.grid,
      showAxes: flags.axes,
      showLabels: flags.labels,
    };
    if (!Number.isFinite(next.xMin) || !Number.isFinite(next.xMax) || next.xMin >= next.xMax) {
      setError("X от должен быть меньше X до.");
      return;
    }
    if (!Number.isFinite(next.yMin) || !Number.isFinite(next.yMax) || next.yMin >= next.yMax) {
      setError("Y от должен быть меньше Y до.");
      return;
    }
    if (!lessonGraphPoints(next.functions[0], next.xMin, next.xMax, 4)) {
      setError("Функция не разобралась. Пример: x^2 или sin(x).");
      return;
    }
    saveProps(editor, shape, next);
  }
  function cancel() {
    editor.setEditingShape(null);
  }
  return (
    <HTMLContainer className={`lesson-card${editing ? " lesson-card--editing" : ""}`} style={editing ? { pointerEvents: "auto" } : undefined}>
      {editing ? (
        <form
          className="lesson-card__form"
          onPointerDown={stopEventPropagation}
          onKeyDown={(event) => {
            event.stopPropagation();
            if (event.key === "Escape") cancel();
          }}
          onSubmit={(event) => {
            event.preventDefault();
            commit();
          }}
        >
          <input aria-label="Функция" value={expression} onChange={(event) => setExpression(event.target.value)} />
          <input aria-label="X от" value={xMin} onChange={(event) => setXMin(event.target.value)} />
          <input aria-label="X до" value={xMax} onChange={(event) => setXMax(event.target.value)} />
          <input aria-label="Y от" value={yMin} onChange={(event) => setYMin(event.target.value)} />
          <input aria-label="Y до" value={yMax} onChange={(event) => setYMax(event.target.value)} />
          <label><input type="checkbox" checked={flags.grid} onChange={(event) => setFlags((value) => ({ ...value, grid: event.target.checked }))} /> Сетка</label>
          <label><input type="checkbox" checked={flags.axes} onChange={(event) => setFlags((value) => ({ ...value, axes: event.target.checked }))} /> Оси</label>
          <label><input type="checkbox" checked={flags.labels} onChange={(event) => setFlags((value) => ({ ...value, labels: event.target.checked }))} /> Подписи</label>
          {error ? <span className="lesson-card__error">{error}</span> : null}
          <button type="button" onClick={cancel}>Отмена</button>
          <button type="submit">Сохранить</button>
        </form>
      ) : (
        <GraphSvg shape={shape} />
      )}
    </HTMLContainer>
  );
}

export class GraphShapeTool extends BaseBoxShapeTool {
  static id = "graph";
  static initial = "idle";
  shapeType = "graph";

  onEnter() {
    this.createdId = null;
    this.dispose = this.editor.sideEffects.registerAfterCreateHandler("shape", (shape, source) => {
      if (source === "user" && shape.type === "graph") this.createdId = shape.id;
    });
  }

  onExit() {
    this.dispose?.();
    const id = this.createdId;
    this.createdId = null;
    if (!id) return;
    const shape = this.editor.getShape(id);
    if (!shape || shape.props.w < 8 || shape.props.h < 8) return;
    this.editor.setEditingShape(id);
  }
}

export class TaskShapeUtil extends BaseBoxShapeUtil {
  static type = "task";
  static props = {
    w: T.number,
    h: T.number,
    taskId: T.string,
    title: T.string,
    condition: T.string,
  };
  static migrations = taskMigrations;

  getDefaultProps() {
    return { w: 320, h: 180, ...pendingTask };
  }

  component(shape) {
    return <TaskBody shape={shape} />;
  }

  getIndicatorPath(shape) {
    return boxPath(shape);
  }

  canEdit() {
    return true;
  }

  canBind() {
    return true;
  }

  toSvg(shape) {
    return (
      <svg width={shape.props.w} height={shape.props.h}>
        <rect width={shape.props.w} height={shape.props.h} rx="12" fill="#ffffff" stroke="#d7dde6" />
        <text x="16" y="32" fontSize="16" fontFamily="sans-serif">{shape.props.title}</text>
        <text x="16" y="58" fontSize="13" fontFamily="sans-serif">{shape.props.condition}</text>
      </svg>
    );
  }
}

function TaskBody({ shape }) {
  const editor = useEditor();
  const editing = useValue("lesson-task-edit", () => editor.getEditingShapeId() === shape.id, [editor, shape.id]);
  const [title, setTitle] = useState(shape.props.title);
  const [condition, setCondition] = useState(shape.props.condition);
  const wasEditing = useRef(false);
  useEffect(() => {
    if (editing && !wasEditing.current) {
      setTitle(shape.props.title);
      setCondition(shape.props.condition);
    }
    wasEditing.current = editing;
  }, [editing, shape.props.title, shape.props.condition]);
  return (
    <HTMLContainer className={`lesson-card lesson-card--task${editing ? " lesson-card--editing" : ""}`} style={editing ? { pointerEvents: "auto" } : undefined}>
      {editing ? (
        <form
          className="lesson-card__form"
          onPointerDown={stopEventPropagation}
          onKeyDown={(event) => event.stopPropagation()}
          onSubmit={(event) => {
            event.preventDefault();
            saveProps(editor, shape, { title: title.trim() || shape.props.title, condition });
          }}
        >
          <input aria-label="Название задания" value={title} onChange={(event) => setTitle(event.target.value)} />
          <textarea aria-label="Условие" value={condition} onChange={(event) => setCondition(event.target.value)} />
          <button type="submit">Сохранить</button>
        </form>
      ) : (
        <>
          <strong>{shape.props.title}</strong>
          {shape.props.condition ? <p>{shape.props.condition}</p> : null}
        </>
      )}
    </HTMLContainer>
  );
}

export class TaskShapeTool extends BaseBoxShapeTool {
  static id = "task";
  static initial = "idle";
  shapeType = "task";

  onCreate(shape) {
    if (shape) this.editor.setCurrentTool("select");
  }
}

export class LessonNoteShapeUtil extends NoteShapeUtil {
  getHandles(shape) {
    const handles = super.getHandles(shape);
    if (!handles?.length) return [];
    return handles.map((handle) => ({ ...handle, index: `size-${handle.id}` }));
  }

  onHandleDrag(_shape, { handle, initial }) {
    const bounds = this.editor.getShapeGeometry(initial).bounds;
    const next = lessonStickerResize(initial, handle, bounds);
    if (!next) return undefined;
    return { x: next.x, y: next.y, props: { scale: next.scale } };
  }
}

const LessonHighlightShapeUtil = HighlightShapeUtil.configure({
  getCustomDisplayValues() {
    return { overlayOpacity: 1, underlayOpacity: 1 };
  },
});

export const lessonShapeUtils = [FormulaShapeUtil, GraphShapeUtil, TaskShapeUtil];
export const lessonCanvasShapeUtils = [LessonHighlightShapeUtil, ...lessonShapeUtils];
export const lessonTools = [FormulaShapeTool, GraphShapeTool, TaskShapeTool];

export const lessonUiOverrides = {
  tools(editor, tools) {
    return {
      ...tools,
      formula: {
        id: "formula",
        label: "tool.formula",
        icon: "tool-text",
        onSelect() {
          editor.setCurrentTool("formula");
        },
      },
      graph: {
        id: "graph",
        label: "tool.graph",
        icon: "tool-line",
        onSelect() {
          editor.setCurrentTool("graph");
        },
      },
      task: {
        id: "task",
        label: "tool.task",
        icon: "tool-note",
        onSelect() {
          editor.setCurrentTool("task");
        },
      },
    };
  },
  translations: {
    ru: {
      "tool.formula": "Формула",
      "tool.graph": "График",
      "tool.task": "Задание",
    },
    en: {
      "tool.formula": "Formula",
      "tool.graph": "Graph",
      "tool.task": "Task",
    },
  },
};
