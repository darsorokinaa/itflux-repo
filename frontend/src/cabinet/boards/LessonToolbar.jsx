import { useEffect, useRef, useState } from "react";
import {
  AppWindow,
  ArrowUpRight,
  Crosshair,
  Eraser,
  File,
  Hand,
  Highlighter,
  ImagePlus,
  Minus,
  MousePointer2,
  Pencil,
  Shapes,
  Square,
  StickyNote,
  Type,
} from "lucide-react";
import { useEditor, useTools, useValue } from "tldraw";

import { LessonFlyout, useInkColor } from "./LessonMenus";
import { chooseTool } from "./lessonBoardActions";
import { LESSON_RAIL, lessonAdaptiveRail, lessonPhoneRail, lessonRailButton, lessonToolActive } from "./lessonShell";

const ICONS = {
  select: MousePointer2,
  hand: Hand,
  draw: Pencil,
  eraser: Eraser,
  highlight: Highlighter,
  laser: Crosshair,
  text: Type,
  note: StickyNote,
  shapes: Shapes,
  arrow: ArrowUpRight,
  frame: Square,
  line: Minus,
  insert: ImagePlus,
  files: File,
  embed: AppWindow,
};

const MENUS = new Set(["draw", "shapes", "insert", "files", "more", "note"]);
const TOOL_ON_OPEN = new Set(["draw", "note"]);

export default function LessonRail() {
  const editor = useEditor();
  const tools = useTools();
  const railRef = useRef(null);
  const [menu, setMenu] = useState(null);
  const [menuTop, setMenuTop] = useState(0);
  const [hint, setHint] = useState(null);
  const [available, setAvailable] = useState(640);
  const [layout, setLayout] = useState("side");
  const toolId = useValue("lesson-rail-tool", () => editor.getCurrentToolId(), [editor]);
  const adapted = layout === "bottom" ? lessonPhoneRail() : lessonAdaptiveRail(available, 40);

  useEffect(() => {
    const node = railRef.current;
    if (!node) return undefined;
    const measure = () => {
      const phone = window.matchMedia("(max-width: 720px)").matches;
      const portrait = window.matchMedia("(max-width: 1024px) and (orientation: portrait)").matches;
      setLayout(phone || portrait ? "bottom" : "side");
      setAvailable(node.clientHeight || window.innerHeight - 160);
    };
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(node);
    window.addEventListener("resize", measure);
    return () => {
      observer.disconnect();
      window.removeEventListener("resize", measure);
    };
  }, []);

  useEffect(() => {
    if (!menu) return undefined;
    const close = (event) => {
      if (event.key === "Escape") {
        setMenu(null);
        return;
      }
      if (event.type === "pointerdown" && !event.target.closest?.(".lesson-rail")) setMenu(null);
    };
    document.addEventListener("pointerdown", close);
    document.addEventListener("keydown", close);
    return () => {
      document.removeEventListener("pointerdown", close);
      document.removeEventListener("keydown", close);
    };
  }, [menu]);

  return (
    <div
      ref={railRef}
      className={`lesson-rail${layout === "bottom" ? " lesson-rail--bottom" : ""}`}
      data-testid="lesson-rail"
      data-layout={layout}
      onPointerDown={(event) => editor.markEventAsHandled(event)}
    >
      <div className="lesson-rail__scroll" role="toolbar" aria-label="Инструменты доски">
        {adapted.items.map((item) => (
          lessonRailButton(item) ? (
            <RailButton
              key={item.id}
              item={item}
              pressed={lessonToolActive(item.id, toolId)}
              onHint={(label, top) => setHint(label ? { label, top } : null)}
              onClick={(event) => {
                if (item.tool === "embed") {
                  tools.embed?.onSelect("toolbar");
                  setMenu(null);
                  return;
                }
                if (!MENUS.has(item.id)) {
                  chooseTool(editor, item.tool);
                  setMenu(null);
                  return;
                }
                if (TOOL_ON_OPEN.has(item.id)) chooseTool(editor, item.tool);
                const next = menu === item.id ? null : item.id;
                setMenu(next);
                setMenuTop(event.currentTarget.offsetTop);
              }}
            />
          ) : <span key={item.id} className="lesson-rail__divider" />
        ))}
      </div>
      {hint && !menu ? (
        <span className="lesson-rail__hint" style={{ top: hint.top }}>{hint.label}</span>
      ) : null}
      {menu ? (
        <div className="lesson-flyout" style={{ top: menuTop }} role="dialog" aria-label={LESSON_RAIL.find((item) => item.id === menu)?.label}>
          <LessonFlyout menu={menu} overflow={adapted.overflow} onClose={() => setMenu(null)} />
        </div>
      ) : null}
    </div>
  );
}

function RailButton({ item, pressed, onClick, onHint }) {
  const ink = useInkColor();
  const Icon = ICONS[item.id];
  const tint = pressed && (item.id === "draw" || item.id === "highlight") ? ink : undefined;
  const hintTimer = useRef(null);
  function queueHint(event, delay) {
    const target = event.currentTarget;
    window.clearTimeout(hintTimer.current);
    hintTimer.current = window.setTimeout(() => {
      const rail = target.closest(".lesson-rail");
      if (!rail) return;
      const top = target.getBoundingClientRect().top - rail.getBoundingClientRect().top;
      onHint(item.kbd ? `${item.label}  ${item.kbd}` : item.label, top);
    }, delay);
  }
  return (
    <button
      type="button"
      className="lesson-rail__item"
      aria-label={item.label}
      aria-pressed={pressed}
      onClick={onClick}
      onMouseEnter={(event) => queueHint(event, 480)}
      onMouseLeave={() => {
        window.clearTimeout(hintTimer.current);
        onHint(null, 0);
      }}
      onFocus={(event) => queueHint(event, 0)}
      onBlur={() => {
        window.clearTimeout(hintTimer.current);
        onHint(null, 0);
      }}
    >
      <Icon size={18} strokeWidth={1.75} color={tint || "currentColor"} aria-hidden="true" />
    </button>
  );
}
