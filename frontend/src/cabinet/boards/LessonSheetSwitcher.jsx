import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { DefaultToasts, useEditor, useToasts, useValue } from "tldraw";

import {
  bindSheetToasts,
  dropStockMaxShapesToasts,
  isStockMaxShapesToast,
  renameSheet,
  requestDeleteSheet,
  deleteSheet,
  moveSheet,
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
  const listRef = useRef(null);
  const skipCommit = useRef(false);
  const [editingId, setEditingId] = useState(null);
  const [draft, setDraft] = useState("");
  const [deletePrompt, setDeletePrompt] = useState(null);
  const promptOpenedAt = useRef(0);
  const gestureRef = useRef(null);
  const suppressClick = useRef("");
  const [drag, setDrag] = useState(null);
  const pages = useValue("lesson-sheets", () => editor.getPages(), [editor]);
  const currentId = useValue("lesson-sheet", () => editor.getCurrentPageId(), [editor]);
  const readonly = useValue("lesson-sheet-readonly", () => editor.getIsReadonly(), [editor]);

  useLayoutEffect(() => bindSheetToasts(toasts), [toasts]);

  useEffect(() => {
    const list = listRef.current;
    const tab = list?.querySelector('[aria-selected="true"]');
    if (!list || !tab) return;
    const left = tab.offsetLeft;
    const right = left + tab.offsetWidth;
    if (left < list.scrollLeft) list.scrollLeft = left;
    else if (right > list.scrollLeft + list.clientWidth) list.scrollLeft = right - list.clientWidth;
  }, [currentId, pages.length]);

  useEffect(() => {
    if (!editingId) return undefined;
    const commitOnOutside = (event) => {
      if (event.target?.closest?.(".lesson-sheets__rename")) return;
      commitRename();
    };
    document.addEventListener("pointerdown", commitOnOutside, true);
    return () => document.removeEventListener("pointerdown", commitOnOutside, true);
  }, [editingId, draft]);

  function openSheet(pageId) {
    if (suppressClick.current === pageId) {
      suppressClick.current = "";
      return;
    }
    if (!pageId || pageId === editor.getCurrentPageId()) return;
    editor.setCurrentPage(pageId);
  }

  function startDrag(event, page, index) {
    if (event.button !== 0 || readonly || pages.length < 2 || editingId) return;
    if (event.target.closest(".lesson-sheets__delete")) return;
    const list = listRef.current;
    if (!list) return;
    const tabs = [...list.querySelectorAll(".lesson-sheets__tab")];
    const gesture = {
      id: page.id,
      pointerId: event.pointerId,
      originX: event.clientX,
      from: index,
      over: index,
      active: false,
      scroll: list.scrollLeft,
      width: tabs[index]?.offsetWidth || 0,
      slots: tabs.map((tab) => {
        const rect = tab.getBoundingClientRect();
        return { left: rect.left, width: rect.width };
      }),
    };
    gestureRef.current = gesture;

    const finish = () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", end);
      window.removeEventListener("pointercancel", end);
      if (gestureRef.current === gesture) gestureRef.current = null;
    };
    const move = (ev) => {
      if (ev.pointerId !== gesture.pointerId) return;
      const dx = ev.clientX - gesture.originX;
      if (!gesture.active) {
        if (Math.abs(dx) < 5) return;
        gesture.active = true;
      }
      ev.preventDefault();
      const listEl = listRef.current;
      if (!listEl) return;
      const x = ev.clientX + (listEl.scrollLeft - gesture.scroll);
      let to = 0;
      for (let slot = 0; slot < gesture.slots.length; slot += 1) {
        const item = gesture.slots[slot];
        if (x > item.left + item.width / 2) to = slot + 1;
      }
      if (to > gesture.from) to -= 1;
      gesture.over = Math.max(0, Math.min(gesture.slots.length - 1, to));
      const bounds = listEl.getBoundingClientRect();
      if (ev.clientX < bounds.left + 28) listEl.scrollLeft -= 14;
      else if (ev.clientX > bounds.right - 28) listEl.scrollLeft += 14;
      setDrag({ id: gesture.id, from: gesture.from, over: gesture.over, dx, width: gesture.width });
    };
    const end = (ev) => {
      if (ev.pointerId !== gesture.pointerId) return;
      finish();
      if (gesture.active) {
        suppressClick.current = gesture.id;
        moveSheet(editor, gesture.id, gesture.over);
      }
      setDrag(null);
    };
    gesture.finish = finish;
    gestureRef.current = gesture;
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", end);
    window.addEventListener("pointercancel", end);
  }

  useEffect(() => () => {
    gestureRef.current?.finish?.();
  }, []);

  function startRename(page) {
    if (readonly) return;
    skipCommit.current = false;
    setEditingId(page.id);
    setDraft(sheetLabel(page.name));
  }

  function cancelRename() {
    skipCommit.current = true;
    setEditingId(null);
  }

  function commitRename() {
    if (skipCommit.current) {
      skipCommit.current = false;
      return;
    }
    const pageId = editingId;
    setEditingId(null);
    if (!pageId) return;
    renameSheet(editor, pageId, draft);
  }

  function askDelete(pageId) {
    const result = requestDeleteSheet(editor, pageId);
    if (result.reason !== "confirm") return;
    promptOpenedAt.current = performance.now();
    setDeletePrompt(result);
  }

  function dismissDelete() {
    if (performance.now() - promptOpenedAt.current < 250) return;
    setDeletePrompt(null);
  }

  function confirmDelete() {
    if (!deletePrompt) return;
    deleteSheet(editor, deletePrompt.pageId);
    setDeletePrompt(null);
  }

  useEffect(() => {
    if (!deletePrompt) return undefined;
    const onKey = (event) => {
      if (event.key === "Escape") setDeletePrompt(null);
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [deletePrompt]);

  function tabShift(index) {
    if (!drag) return 0;
    if (index === drag.from) return drag.dx;
    if (drag.from < drag.over && index > drag.from && index <= drag.over) return -drag.width;
    if (drag.over < drag.from && index >= drag.over && index < drag.from) return drag.width;
    return 0;
  }

  return (
    <div className="lesson-sheets" onPointerDown={(event) => editor.markEventAsHandled(event)}>
      <div
        className={`lesson-sheets__list${readonly || pages.length < 2 ? "" : " lesson-sheets__list--sortable"}${drag ? " lesson-sheets__list--dragging" : ""}`}
        ref={listRef}
        role="tablist"
        aria-label="Листы доски"
      >
        {pages.map((page, index) => (
          editingId === page.id ? (
            <input
              key={page.id}
              className="lesson-sheets__rename"
              aria-label="Название листа"
              value={draft}
              autoFocus
              maxLength={80}
              onFocus={(event) => event.target.select()}
              onChange={(event) => setDraft(event.target.value)}
              onBlur={commitRename}
              onKeyDown={(event) => {
                if (event.key === "Enter") {
                  event.preventDefault();
                  commitRename();
                } else if (event.key === "Escape") {
                  event.preventDefault();
                  cancelRename();
                }
              }}
            />
          ) : (
            <div
              key={page.id}
              className={`lesson-sheets__tab${drag?.id === page.id ? " lesson-sheets__tab--dragging" : ""}`}
              role="tab"
              aria-selected={page.id === currentId}
              style={drag ? { transform: `translateX(${tabShift(index)}px)` } : undefined}
              onPointerDown={(event) => startDrag(event, page, index)}
            >
              <button
                type="button"
                className="lesson-sheets__label"
                title={readonly ? sheetLabel(page.name) : `${sheetLabel(page.name)}. Перетащите, чтобы переместить. Дважды щёлкните, чтобы переименовать`}
                onClick={() => openSheet(page.id)}
                onDoubleClick={() => startRename(page)}
              >
                <span className="lesson-sheets__name">{sheetLabel(page.name)}</span>
              </button>
              {readonly || pages.length <= 1 ? null : (
                <button
                  type="button"
                  className="lesson-sheets__delete"
                  aria-label={`Удалить лист ${sheetLabel(page.name)}`}
                  title="Удалить лист"
                  onClick={() => askDelete(page.id)}
                >
                  ×
                </button>
              )}
            </div>
          )
        ))}
      </div>
      <button
        type="button"
        className="lesson-sheets__add"
        aria-label="Новый лист"
        disabled={readonly}
        title={readonly ? "Редактирование недоступно" : "Новый лист"}
        onClick={() => requestNewSheet(editor)}
      >
        +
      </button>
      {deletePrompt
        ? createPortal(
            <div
              className="lesson-sheet-confirm"
              role="dialog"
              aria-modal="true"
              aria-labelledby="lesson-sheet-confirm-title"
              onPointerDown={(event) => event.stopPropagation()}
              onClick={dismissDelete}
            >
              <div
                className="lesson-sheet-confirm__card"
                onPointerDown={(event) => event.stopPropagation()}
                onClick={(event) => event.stopPropagation()}
              >
                <p id="lesson-sheet-confirm-title" className="lesson-sheet-confirm__title">
                  {deletePrompt.title}
                </p>
                <div className="lesson-sheet-confirm__actions">
                  <button type="button" className="lesson-sheet-confirm__cancel" onClick={() => setDeletePrompt(null)}>
                    Отмена
                  </button>
                  <button type="button" className="lesson-sheet-confirm__ok" onClick={confirmDelete}>
                    Удалить
                  </button>
                </div>
              </div>
            </div>,
            document.body,
          )
        : null}
    </div>
  );
}
