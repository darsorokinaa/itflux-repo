import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { DefaultToasts, useEditor, useToasts, useValue } from "tldraw";

import {
  bindSheetToasts,
  dropStockMaxShapesToasts,
  isStockMaxShapesToast,
  requestNewSheet,
  sheetLabel,
} from "./lessonSheets";

export function LessonBoardToasts() {
  const { toasts, removeToast } = useToasts();
  const items = useValue("lesson-board-toasts", () => toasts.get(), [toasts]);
  useLayoutEffect(() => {
    if (items.some(isStockMaxShapesToast)) dropStockMaxShapesToasts({ toasts, removeToast });
  }, [items, removeToast, toasts]);
  return <DefaultToasts />;
}

export default function LessonSheetSwitcher() {
  const editor = useEditor();
  const toasts = useToasts();
  const rootRef = useRef(null);
  const [open, setOpen] = useState(false);
  const pages = useValue("lesson-sheets", () => editor.getPages(), [editor]);
  const currentId = useValue("lesson-sheet", () => editor.getCurrentPageId(), [editor]);
  const readonly = useValue("lesson-sheet-readonly", () => editor.getIsReadonly(), [editor]);
  const current = pages.find((page) => page.id === currentId) || pages[0];

  useLayoutEffect(() => bindSheetToasts(toasts), [toasts]);

  useEffect(() => {
    if (!open) return undefined;
    const close = (event) => {
      if (rootRef.current?.contains(event.target)) return;
      setOpen(false);
    };
    document.addEventListener("pointerdown", close);
    return () => document.removeEventListener("pointerdown", close);
  }, [open]);

  function openSheet(pageId) {
    setOpen(false);
    if (!pageId || pageId === editor.getCurrentPageId()) return;
    editor.setCurrentPage(pageId);
  }

  function addSheet() {
    setOpen(false);
    requestNewSheet(editor);
  }

  return (
    <div className="lesson-sheets" ref={rootRef} onPointerDown={(event) => editor.markEventAsHandled(event)}>
      <button
        type="button"
        className="lesson-sheets__current"
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label={current ? `Лист: ${sheetLabel(current.name)}` : "Листы"}
        onClick={() => setOpen((value) => !value)}
      >
        <span className="lesson-sheets__name">{sheetLabel(current?.name)}</span>
      </button>
      {open ? (
        <div className="lesson-sheets__menu" role="menu" aria-label="Листы доски">
          {pages.map((page) => (
            <button
              key={page.id}
              type="button"
              role="menuitemradio"
              className="lesson-menu__item"
              aria-checked={page.id === currentId}
              onClick={() => openSheet(page.id)}
            >
              {sheetLabel(page.name)}
            </button>
          ))}
        </div>
      ) : null}
      <button
        type="button"
        className="lesson-sheets__add"
        disabled={readonly}
        title={readonly ? "Редактирование недоступно" : "Новый лист"}
        onClick={addSheet}
      >
        + Новый лист
      </button>
    </div>
  );
}
