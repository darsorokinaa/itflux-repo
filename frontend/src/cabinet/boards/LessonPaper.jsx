import { useEffect, useId, useRef, useState } from "react";
import { useEditor, useValue } from "tldraw";

import {
  LESSON_PAPER_COLORS,
  LESSON_PAPER_MODES,
  lessonPaperOffset,
  readLessonPaper,
  withLessonPaper,
} from "./lessonPaper";

const INK = "rgba(71, 85, 105, 0.16)";
const LIGHT_INK = "rgba(255, 255, 255, 0.28)";

function paperInk(color) {
  const item = LESSON_PAPER_COLORS.find((entry) => entry.value === color);
  return item?.marks === "light" ? LIGHT_INK : INK;
}

export function LessonPaperBackground() {
  const editor = useEditor();
  const patternId = useId().replace(/:/g, "");
  const paper = useValue(
    "lesson-paper",
    () => readLessonPaper(editor.getDocumentSettings().meta),
    [editor],
  );
  const camera = useValue("lesson-paper-camera", () => editor.getCamera(), [editor]);
  const offset = lessonPaperOffset(camera.x, camera.y, camera.z);

  return (
    <div className="tl-background lesson-paper" style={{ backgroundColor: paper.color }} data-paper-mode={paper.mode}>
      {paper.mode === "blank" ? null : (
        <svg className="lesson-paper__marks" aria-hidden="true">
          <defs>
            <pattern
              id={patternId}
              width={offset.size}
              height={offset.size}
              patternUnits="userSpaceOnUse"
              x={offset.x}
              y={offset.y}
            >
              <PaperMarks mode={paper.mode} size={offset.size} ink={paperInk(paper.color)} />
            </pattern>
          </defs>
          <rect width="100%" height="100%" fill={`url(#${patternId})`} />
        </svg>
      )}
    </div>
  );
}

function PaperMarks({ mode, size, ink }) {
  if (mode === "dots") {
    return <circle cx="1" cy="1" r="1.2" fill={ink} />;
  }
  if (mode === "lines") {
    return <line x1="0" y1="0.5" x2={size} y2="0.5" stroke={ink} strokeWidth="1" />;
  }
  if (mode === "grid") {
    return (
      <>
        <line x1="0" y1="0.5" x2={size} y2="0.5" stroke={ink} strokeWidth="1" />
        <line x1="0.5" y1="0" x2="0.5" y2={size} stroke={ink} strokeWidth="1" />
      </>
    );
  }
  if (mode === "slant") {
    return (
      <>
        <line x1="0" y1="0.5" x2={size} y2="0.5" stroke={ink} strokeWidth="1" />
        <line x1="0" y1={size} x2={size} y2="0" stroke={ink} strokeWidth="1" />
      </>
    );
  }
  return null;
}

export function LessonPaperControl({ inline = false }) {
  const editor = useEditor();
  const rootRef = useRef(null);
  const [open, setOpen] = useState(false);
  const readonly = useValue("lesson-paper-readonly", () => editor.getIsReadonly(), [editor]);
  const paper = useValue(
    "lesson-paper",
    () => readLessonPaper(editor.getDocumentSettings().meta),
    [editor],
  );

  useEffect(() => {
    if (inline || !open) return undefined;
    const close = (event) => {
      if (!rootRef.current?.contains(event.target)) setOpen(false);
    };
    document.addEventListener("pointerdown", close);
    return () => document.removeEventListener("pointerdown", close);
  }, [inline, open]);

  if (readonly) return null;

  const apply = (patch) => {
    const settings = editor.getDocumentSettings();
    editor.updateDocumentSettings({ meta: withLessonPaper(settings.meta, patch) });
  };

  const panel = (
    <div className="lesson-paper-control__panel" role="dialog" aria-label="Фон доски">
      <p className="lesson-paper-control__label">Фон</p>
      <div className="lesson-paper-control__colors">
        {LESSON_PAPER_COLORS.map((item) => (
          <button
            key={item.id}
            type="button"
            className="lesson-paper-control__swatch"
            aria-label={item.label}
            aria-pressed={paper.color === item.value}
            style={{ backgroundColor: item.value }}
            onClick={() => {
              apply({ color: item.value });
              if (!inline) setOpen(false);
            }}
          />
        ))}
      </div>
      <p className="lesson-paper-control__label">Разлиновка</p>
      <div className="lesson-paper-control__modes">
        {LESSON_PAPER_MODES.map((item) => (
          <button
            key={item.id}
            type="button"
            className="lesson-paper-control__mode"
            aria-pressed={paper.mode === item.id}
            onClick={() => {
              apply({ mode: item.id });
              if (!inline) setOpen(false);
            }}
          >
            <PaperGlyph mode={item.id} />
            <span>{item.label}</span>
          </button>
        ))}
      </div>
    </div>
  );

  if (inline) {
    return (
      <div className="lesson-paper-control lesson-paper-control--inline" data-testid="lesson-paper-control" ref={rootRef}>
        {panel}
      </div>
    );
  }

  return (
    <div className="lesson-paper-control" data-testid="lesson-paper-control" ref={rootRef}>
      <button
        type="button"
        className="lesson-icon lesson-paper-control__trigger"
        aria-expanded={open}
        aria-label="Фон"
        data-tooltip="Фон"
        onClick={() => setOpen((value) => !value)}
      >
        <PaperGlyph mode={paper.mode} />
      </button>
      {open ? panel : null}
    </div>
  );
}

function PaperGlyph({ mode }) {
  return (
    <svg className="lesson-paper-glyph" viewBox="0 0 24 24" aria-hidden="true">
      {mode === "dots" ? (
        <>
          <circle cx="6" cy="6" r="1.1" />
          <circle cx="12" cy="6" r="1.1" />
          <circle cx="18" cy="6" r="1.1" />
          <circle cx="6" cy="12" r="1.1" />
          <circle cx="12" cy="12" r="1.1" />
          <circle cx="18" cy="12" r="1.1" />
          <circle cx="6" cy="18" r="1.1" />
          <circle cx="12" cy="18" r="1.1" />
          <circle cx="18" cy="18" r="1.1" />
        </>
      ) : null}
      {mode === "grid" ? (
        <>
          <path d="M5 8h14M5 12h14M5 16h14M8 5v14M12 5v14M16 5v14" />
        </>
      ) : null}
      {mode === "lines" ? <path d="M5 8h14M5 12h14M5 16h14" /> : null}
      {mode === "slant" ? (
        <path d="M5 8h14M5 12h14M5 16h14M8 19 16 5M12 19 20 5M4 19l8-14" />
      ) : null}
      {mode === "blank" ? <rect x="5" y="5" width="14" height="14" rx="2" /> : null}
    </svg>
  );
}
