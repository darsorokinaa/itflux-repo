import { AlignCenter, AlignLeft, AlignRight, ArrowRight, Circle, Download, File, Lock, LockOpen, Minus } from "lucide-react";
import { useState } from "react";
import { useEditor, useValue } from "tldraw";

import {
  alignSelection,
  applyCustomColor,
  lessonInkChoices,
  savedCustomColors,
  applyStyle,
  cropSelection,
  deleteSelection,
  downloadLessonFile,
  distributeSelection,
  duplicateSelection,
  editSelection,
  groupSelection,
  lockSelection,
  replaceSelectedImage,
  setImageMat,
  toggleMark,
  ArrowShapeArrowheadEndStyle,
  DefaultColorStyle,
  DefaultDashStyle,
  DefaultFillStyle,
  DefaultFontStyle,
  DefaultSizeStyle,
  DefaultTextAlignStyle,
} from "./lessonBoardActions";
import { BrushStroke, ColorDot, OpacityMark, OpacitySlider, StrokeSizePicker, ThicknessSlider } from "./LessonMenus";
import {
  LESSON_ALIGN_STEPS,
  LESSON_FONT_STEPS,
  LESSON_INK_COLORS,
  LESSON_MARKER_COLORS,
  LESSON_SIZE_STEPS,
  LESSON_TEXT_SIZE_STEPS,
  lessonTextSizeLabel,
  lessonContextBar,
  lessonContextPosition,
  lessonFontFamily,
  lessonSelectionKind,
} from "./lessonShell";

export default function LessonContextBar() {
  const editor = useEditor();
  const readonly = useValue("lesson-context-readonly", () => editor.getIsReadonly(), [editor]);
  const selection = useValue(
    "lesson-context-selection",
    () => {
      const shapes = editor.getSelectedShapes();
      return {
        types: shapes.map((shape) => shape.type),
        lessonKind: shapes.length === 1 ? shapes[0].meta?.lessonKind || "" : "",
        bounds: shapes.length ? editor.getSelectionScreenBounds() : null,
      };
    },
    [editor],
  );
  const editing = useValue("lesson-context-editing", () => Boolean(editor.getEditingShapeId()), [editor]);
  const [menu, setMenu] = useState(null);
  const kind = readonly || editing ? null : lessonSelectionKind(selection.types, selection.lessonKind);
  const controls = lessonContextBar(kind);
  if (!controls.length || !selection.bounds) return null;
  const placed = lessonContextPosition(selection.bounds, {
    width: window.innerWidth,
    height: window.innerHeight,
  });
  const top = placed.top;
  const left = placed.left;
  function toggle(id) {
    setMenu((current) => (current === id ? null : id));
  }
  return (
    <div
      className={`lesson-context${placed.above ? " lesson-context--above" : ""}`}
      data-testid="lesson-context"
      role="toolbar"
      aria-label="Настройки объекта"
      style={{ top, left }}
      onPointerDown={(event) => editor.markEventAsHandled(event)}
    >
      {controls.map((control) => (
        <ContextControl key={control} control={control} menu={menu} onToggle={toggle} />
      ))}
    </div>
  );
}

function ContextControl({ control, menu, onToggle }) {
  if (control === "file") return <FileControl />;
  if (control === "color") return <ColorSwatch menu={menu} onToggle={onToggle} />;
  if (control === "fill") return <FillControl />;
  if (control === "border") return <BorderControl />;
  if (control === "arrowhead") return <ArrowheadControl />;
  if (control === "size") return <SizeLabel menu={menu} onToggle={onToggle} />;
  if (control === "font") return <FontSelect menu={menu} onToggle={onToggle} />;
  if (control === "bold") return <MarkButton operation="toggleBold" label="Жирный" />;
  if (control === "italic") return <MarkButton operation="toggleItalic" label="Курсив" />;
  if (control === "align") return <AlignText />;
  if (control === "edit") return <TextButton />;
  if (control === "crop") return <ActionButton label="Обрезать" onClick={(editor) => cropSelection(editor)} />;
  if (control === "replace") return <ReplaceButton />;
  if (control === "background") return <MatColors menu={menu} onToggle={onToggle} />;
  if (control === "opacity") return <OpacityButton menu={menu} onToggle={onToggle} />;
  if (control === "lock") return <LockButton />;
  if (control === "duplicate") return <ActionButton label="Дублировать" onClick={(editor) => duplicateSelection(editor)} />;
  if (control === "delete") return <ActionButton label="Удалить" onClick={(editor) => deleteSelection(editor)} />;
  if (control === "alignShapes") return <ActionButton label="Выровнять" onClick={(editor) => alignSelection(editor, "left")} />;
  if (control === "distribute") return <ActionButton label="Распределить" onClick={(editor) => distributeSelection(editor, "horizontal")} />;
  if (control === "group") return <ActionButton label="Группировать" onClick={(editor) => groupSelection(editor)} />;
  if (control === "more") return <MoreMenu menu={menu} onToggle={onToggle} />;
  return null;
}

function useMarkerSelection() {
  const editor = useEditor();
  return useValue("lesson-selection-marker", () => {
    const shapes = editor.getSelectedShapes();
    return shapes.length > 0 && shapes.every((shape) => shape.type === "highlight");
  }, [editor]);
}

function themeInk(palette, id, marker) {
  const entry = palette?.[id];
  if (!entry) return "#111";
  if (marker) return entry.highlightSrgb || entry.solid || "#111";
  return entry.solid || "#111";
}

function ColorSwatch({ menu, onToggle }) {
  const editor = useEditor();
  const open = menu === "color";
  const marker = useMarkerSelection();
  const palette = marker ? LESSON_MARKER_COLORS : LESSON_INK_COLORS;
  const colorId = useValue("lesson-context-color-id", () => {
    const shared = editor.getSharedStyles().get(DefaultColorStyle);
    return shared?.type === "shared" ? shared.value : "black";
  }, [editor]);
  const colors = useValue(
    "lesson-context-colors",
    () => editor.getCurrentTheme().colors[editor.getColorMode()],
    [editor],
  );
  const solid = themeInk(colors, colorId, marker);
  return (
    <span className="lesson-context__pop">
      <button type="button" className="lesson-context__icon" aria-label="Цвет" aria-expanded={open} onClick={() => onToggle("color")}>
        <ColorDot color={solid} />
      </button>
      {open ? (
        <span className="lesson-context__colors lesson-context__drop">
          {lessonInkChoices(palette, colorId).map((item) => (
            <button
              key={item.id}
              type="button"
              className="lesson-swatch"
              aria-label={item.label}
              aria-pressed={colorId === item.id}
              onClick={() => {
                applyStyle(editor, DefaultColorStyle, item.id);
                onToggle("color");
              }}
            >
              <ColorDot color={themeInk(colors, item.id, marker)} />
            </button>
          ))}
          {marker ? null : (
            <label className="lesson-swatch lesson-swatch--custom" aria-label="Другой цвет">
              <span className="lesson-brush-rainbow" />
              <input
                type="color"
                value={savedCustomColors()[0]?.hex || "#e11d48"}
                onChange={(event) => applyCustomColor(editor, event.target.value)}
              />
            </label>
          )}
        </span>
      ) : null}
    </span>
  );
}

function ShapeIconButton({ label, pressed, onClick, children }) {
  return (
    <button
      type="button"
      className="lesson-context__text lesson-context__align"
      aria-label={label}
      aria-pressed={pressed}
      onClick={onClick}
    >
      {children}
    </button>
  );
}

function FillMark({ fill }) {
  const paint = fill === "none" ? "none" : "currentColor";
  return (
    <svg width="16" height="16" viewBox="0 0 16 16" aria-hidden="true">
      <rect x="1.75" y="1.75" width="12.5" height="12.5" rx="2" fill={paint} fillOpacity={fill === "semi" ? 0.35 : 1} stroke="currentColor" strokeWidth="1.5" />
    </svg>
  );
}

function DashMark({ dash }) {
  const array = dash === "dashed" ? "3.2 2.4" : dash === "dotted" ? "0.1 3" : undefined;
  return (
    <svg width="18" height="16" viewBox="0 0 18 16" aria-hidden="true">
      <line x1="1" y1="8" x2="17" y2="8" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeDasharray={array} />
    </svg>
  );
}

function BorderControl() {
  const editor = useEditor();
  const value = useShared(DefaultDashStyle) || "solid";
  const steps = [
    ["solid", "Сплошная"],
    ["dashed", "Пунктир"],
    ["dotted", "Точки"],
  ];
  return (
    <span className="lesson-context__group" role="group" aria-label="Граница">
      {steps.map(([id, label]) => (
        <ShapeIconButton key={id} label={label} pressed={value === id} onClick={() => applyStyle(editor, DefaultDashStyle, id)}>
          <DashMark dash={id} />
        </ShapeIconButton>
      ))}
    </span>
  );
}

function SizeLabel({ menu, onToggle }) {
  const editor = useEditor();
  const mode = useValue("lesson-context-size-mode", () => {
    const shapes = editor.getSelectedShapes();
    if (shapes.length > 0 && shapes.every((shape) => shape.type === "text" || shape.type === "note")) return "text";
    if (shapes.length > 0 && shapes.every((shape) => shape.type === "draw" || shape.type === "highlight" || shape.type === "line")) return "stroke";
    return "shape";
  }, [editor]);
  if (mode === "text") return <FontSizeSelect menu={menu} onToggle={onToggle} />;
  if (mode === "stroke") return <ThicknessSlider />;
  return <StrokeSizeLabel menu={menu} onToggle={onToggle} />;
}

function StrokeSizeLabel({ menu, onToggle }) {
  const editor = useEditor();
  const open = menu === "size";
  const value = useValue("lesson-context-size", () => {
    const shared = editor.getSharedStyles().get(DefaultSizeStyle);
    return shared?.type === "shared" ? shared.value : "m";
  }, [editor]);
  const step = LESSON_SIZE_STEPS.find((item) => item.id === value) || LESSON_SIZE_STEPS[1];
  const color = useValue("lesson-context-size-color", () => {
    const shared = editor.getSharedStyles().get(DefaultColorStyle);
    const id = shared?.type === "shared" ? shared.value : "black";
    return editor.getCurrentTheme().colors[editor.getColorMode()]?.[id]?.solid || "#1a1d23";
  }, [editor]);
  return (
    <span className="lesson-context__pop">
      <button type="button" className="lesson-context__icon" aria-label={step.label} aria-expanded={open} onClick={() => onToggle("size")}>
        <BrushStroke color={color} thickness={Math.max(1.6, step.dot / 5)} />
      </button>
      {open ? (
        <span className="lesson-context__drop lesson-context__drop--slider">
          <StrokeSizePicker />
        </span>
      ) : null}
    </span>
  );
}

function FillControl() {
  const editor = useEditor();
  const value = useShared(DefaultFillStyle) || "none";
  const steps = [
    ["none", "Без заливки"],
    ["semi", "Полузаливка"],
    ["solid", "Заливка"],
  ];
  return (
    <span className="lesson-context__group" role="group" aria-label="Заливка">
      {steps.map(([id, label]) => (
        <ShapeIconButton key={id} label={label} pressed={value === id} onClick={() => applyStyle(editor, DefaultFillStyle, id)}>
          <FillMark fill={id} />
        </ShapeIconButton>
      ))}
    </span>
  );
}

function ArrowheadControl() {
  const editor = useEditor();
  const value = useShared(ArrowShapeArrowheadEndStyle) || "arrow";
  const steps = [
    ["arrow", "Стрелка", ArrowRight],
    ["none", "Без наконечника", Minus],
    ["dot", "Точка", Circle],
  ];
  return (
    <span className="lesson-context__group" role="group" aria-label="Наконечник">
      {steps.map(([id, label, Icon]) => (
        <ShapeIconButton key={id} label={label} pressed={value === id} onClick={() => applyStyle(editor, ArrowShapeArrowheadEndStyle, id)}>
          <Icon size={16} strokeWidth={1.75} />
        </ShapeIconButton>
      ))}
    </span>
  );
}

function FontSizeSelect({ menu, onToggle }) {
  const editor = useEditor();
  const open = menu === "size";
  const value = useShared(DefaultSizeStyle) || "m";
  const base = useValue("lesson-text-size-base", () => editor.getCurrentTheme()?.fontSize || 16, [editor]);
  return (
    <span className="lesson-context__pop">
      <button
        type="button"
        className="lesson-context__text lesson-context__size"
        aria-label="Размер шрифта"
        aria-expanded={open}
        onClick={() => onToggle("size")}
      >
        {lessonTextSizeLabel(value, base)}
      </button>
      {open ? (
        <span className="lesson-context__drop lesson-context__menu" role="listbox" aria-label="Размер шрифта">
          {LESSON_TEXT_SIZE_STEPS.map((step) => (
            <button
              key={step.id}
              type="button"
              role="option"
              className="lesson-context__text lesson-context__size"
              aria-pressed={step.id === value}
              onClick={() => {
                applyStyle(editor, DefaultSizeStyle, step.id);
                onToggle("size");
              }}
            >
              {lessonTextSizeLabel(step.id, base)}
            </button>
          ))}
        </span>
      ) : null}
    </span>
  );
}

function FontSelect({ menu, onToggle }) {
  const editor = useEditor();
  const open = menu === "font";
  const value = useShared(DefaultFontStyle) || "draw";
  const current = LESSON_FONT_STEPS.find((step) => step.id === value) || LESSON_FONT_STEPS[2];
  return (
    <span className="lesson-context__pop">
      <button
        type="button"
        className="lesson-context__text lesson-context__font"
        aria-label="Шрифт"
        aria-expanded={open}
        style={{ fontFamily: lessonFontFamily(current.id) }}
        onClick={() => onToggle("font")}
      >
        {current.label}
      </button>
      {open ? (
        <span className="lesson-context__drop lesson-context__menu" role="listbox" aria-label="Шрифт">
          {LESSON_FONT_STEPS.map((step) => (
            <button
              key={step.id}
              type="button"
              role="option"
              className="lesson-context__text lesson-context__font"
              aria-pressed={step.id === current.id}
              style={{ fontFamily: lessonFontFamily(step.id) }}
              onClick={() => {
                applyStyle(editor, DefaultFontStyle, step.id);
                onToggle("font");
              }}
            >
              {step.label}
            </button>
          ))}
        </span>
      ) : null}
    </span>
  );
}

const ALIGN_ICONS = {
  start: AlignLeft,
  middle: AlignCenter,
  end: AlignRight,
};

function FileControl() {
  const editor = useEditor();
  const file = useValue("lesson-context-file", () => {
    const shape = editor.getOnlySelectedShape();
    const meta = shape?.meta || {};
    return {
      name: meta.fileName || "Файл",
      url: meta.fileUrl || "",
    };
  }, [editor]);
  return (
    <span className="lesson-context__file">
      <File size={16} strokeWidth={1.75} aria-hidden="true" />
      <span title={file.name}>{file.name}</span>
      <button
        type="button"
        className="lesson-context__text lesson-context__align"
        aria-label="Скачать"
        disabled={!file.url}
        onClick={() => downloadLessonFile(file.url, file.name)}
      >
        <Download size={16} strokeWidth={1.75} />
      </button>
    </span>
  );
}

function AlignText() {
  const editor = useEditor();
  const value = useShared(DefaultTextAlignStyle) || "start";
  return (
    <span className="lesson-context__group" role="group" aria-label="Выравнивание">
      {LESSON_ALIGN_STEPS.map((step) => {
        const Icon = ALIGN_ICONS[step.id];
        return (
          <button
            key={step.id}
            type="button"
            className="lesson-context__text lesson-context__align"
            aria-label={step.label}
            aria-pressed={value === step.id}
            onClick={() => applyStyle(editor, DefaultTextAlignStyle, step.id)}
          >
            <Icon size={16} strokeWidth={1.75} />
          </button>
        );
      })}
    </span>
  );
}

function MarkButton({ operation, label }) {
  const editor = useEditor();
  return (
    <button type="button" className="lesson-context__text" onClick={() => toggleMark(editor, operation)}>
      {label === "Жирный" ? "B" : "I"}
    </button>
  );
}

function TextButton() {
  return <ActionButton label="Изменить" onClick={(editor) => editSelection(editor)} />;
}

function OpacityButton({ menu, onToggle }) {
  const editor = useEditor();
  const open = menu === "opacity";
  const percent = useValue("lesson-context-opacity", () => {
    const shared = editor.getSharedOpacity();
    const value = shared?.type === "shared" ? shared.value : 1;
    return Math.round((value ?? 1) * 100);
  }, [editor]);
  const marker = useMarkerSelection();
  const color = useValue("lesson-context-opacity-color", () => {
    const shared = editor.getSharedStyles().get(DefaultColorStyle);
    const id = shared?.type === "shared" ? shared.value : "black";
    return themeInk(editor.getCurrentTheme().colors[editor.getColorMode()], id, marker);
  }, [editor, marker]);
  return (
    <span className="lesson-context__pop">
      <button type="button" className="lesson-context__opacity" aria-label={`Прозрачность ${percent}%`} aria-expanded={open} onClick={() => onToggle("opacity")}>
        <OpacityMark split color={color} opacity={percent / 100} />
        <span>{percent}%</span>
      </button>
      {open ? <span className="lesson-context__drop lesson-context__drop--slider"><OpacitySlider /></span> : null}
    </span>
  );
}

function ReplaceButton() {
  const editor = useEditor();
  return (
    <label className="lesson-context__text">
      Заменить
      <input
        className="lesson-sr"
        type="file"
        accept="image/*"
        onChange={(event) => {
          const file = event.target.files?.[0];
          event.target.value = "";
          if (file) replaceSelectedImage(editor, file);
        }}
      />
    </label>
  );
}

function MatColors({ menu, onToggle }) {
  const editor = useEditor();
  const open = menu === "background";
  const colors = useValue("lesson-mat-colors", () => editor.getCurrentTheme().colors[editor.getColorMode()], [editor]);
  return (
    <span className="lesson-context__pop">
      <button type="button" className="lesson-context__text" onClick={() => onToggle("background")}>Фон</button>
      {open ? (
        <span className="lesson-context__colors lesson-context__drop">
          {LESSON_INK_COLORS.map((item) => (
            <button
              key={item.id}
              type="button"
              className="lesson-swatch"
              aria-label={item.label}
              onClick={() => setImageMat(editor, item.id)}
            >
              <ColorDot color={colors?.[item.id]?.solid || "#111"} />
            </button>
          ))}
        </span>
      ) : null}
    </span>
  );
}

function MoreMenu({ menu, onToggle }) {
  const open = menu === "more";
  return (
    <span className="lesson-context__pop">
      <button type="button" className="lesson-context__text" aria-label="Ещё действия" onClick={() => onToggle("more")}>⋯</button>
      {open ? (
        <span className="lesson-context__drop lesson-context__menu">
          <ActionButton label="Дублировать" onClick={(editor) => duplicateSelection(editor)} />
          <ActionButton label="Удалить" onClick={(editor) => deleteSelection(editor)} />
        </span>
      ) : null}
    </span>
  );
}

function LockButton() {
  const editor = useEditor();
  const locked = useValue("lesson-context-locked", () => {
    const shapes = editor.getSelectedShapes();
    return shapes.length > 0 && shapes.every((shape) => shape.isLocked);
  }, [editor]);
  return (
    <ShapeIconButton label={locked ? "Открепить" : "Закрепить"} pressed={locked} onClick={() => lockSelection(editor)}>
      {locked ? <LockOpen size={16} strokeWidth={1.75} /> : <Lock size={16} strokeWidth={1.75} />}
    </ShapeIconButton>
  );
}

function ActionButton({ label, pressed, onClick }) {
  const editor = useEditor();
  return (
    <button type="button" className="lesson-context__text" aria-pressed={pressed || undefined} onClick={() => onClick(editor)}>
      {label}
    </button>
  );
}

function useShared(style) {
  const editor = useEditor();
  return useValue(
    "lesson-context-style",
    () => {
      const shared = editor.getSharedStyles().get(style);
      return shared?.type === "shared" ? shared.value : null;
    },
    [editor, style],
  );
}
