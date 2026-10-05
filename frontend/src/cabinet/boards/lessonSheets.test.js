/** @vitest-environment jsdom */
import { afterEach, describe, expect, it } from "vitest";

import {
  APPROACHING_MESSAGE,
  APPROACHING_TOAST_ID,
  FULL_MESSAGE,
  FULL_TOAST_ID,
  MAX_PAGES_MESSAGE,
  STOCK_MAX_SHAPES_TITLE,
  bindLessonSheetSession,
  bindSheetToasts,
  createNextSheet,
  initialSheetNotice,
  installLessonSheets,
  nextSheetName,
  noticeKind,
  pageToRestore,
  reduceSheetNotice,
  requestNewSheet,
  sheetStorageKey,
} from "./lessonSheets";

afterEach(() => {
  bindSheetToasts(null);
  bindLessonSheetSession(null);
});

function memoryStorage(seed = {}) {
  const data = { ...seed };
  return {
    data,
    getItem(key) {
      return Object.prototype.hasOwnProperty.call(data, key) ? data[key] : null;
    },
    setItem(key, value) {
      data[key] = String(value);
    },
  };
}

function sheetEditor({
  pages,
  current,
  following = "",
  maxShapes = 10,
  maxPages = 40,
  readonly = false,
}) {
  const storeListeners = [];
  const maxListeners = new Set();
  let pageId = current || pages[0]?.id || "";
  const editor = {
    options: { maxShapesPerPage: maxShapes, maxPages },
    pages: pages.map((page) => ({ ...page })),
    shapes: 0,
    getIsReadonly: () => readonly,
    getPages: () => editor.pages,
    getCurrentPageId: () => pageId,
    getCurrentPageShapeIds: () => ({ size: editor.shapes }),
    getInstanceState: () => ({ followingUserId: following }),
    setCurrentPage(id) {
      pageId = typeof id === "string" ? id : id.id;
      for (const listener of storeListeners) {
        if (listener.scope === "session") listener.cb();
      }
    },
    updatePage({ id, name }) {
      const page = editor.pages.find((item) => item.id === id);
      if (page) page.name = name;
    },
    createPage({ name }) {
      if (readonly || editor.pages.length >= maxPages) return editor;
      editor.pages.push({ id: `page:created-${editor.pages.length + 1}`, name });
      return editor;
    },
    store: {
      listen(cb, filters = {}) {
        const row = { cb, scope: filters.scope, source: filters.source };
        storeListeners.push(row);
        return () => {
          const index = storeListeners.indexOf(row);
          if (index >= 0) storeListeners.splice(index, 1);
        };
      },
    },
    addListener(_event, cb) {
      maxListeners.add(cb);
    },
    removeListener(_event, cb) {
      maxListeners.delete(cb);
    },
    emitMax() {
      for (const cb of [...maxListeners]) cb();
    },
    emitDocument(source) {
      for (const listener of [...storeListeners]) {
        if (listener.scope !== "document") continue;
        if (source && listener.source && listener.source !== "all" && listener.source !== source) continue;
        listener.cb();
      }
    },
    storeListeners,
    maxListeners,
  };
  return editor;
}

function toastHarness() {
  const items = [];
  const api = {
    toasts: {
      get: () => items,
    },
    addToast(toast) {
      const id = toast.id;
      const index = items.findIndex((item) => item.id === id);
      const next = { ...toast, id };
      if (index >= 0) items[index] = next;
      else items.push(next);
      return id;
    },
    removeToast(id) {
      const index = items.findIndex((item) => item.id === id);
      if (index >= 0) items.splice(index, 1);
    },
    items,
  };
  bindSheetToasts(api);
  return api;
}

describe("sheet names and restore", () => {
  it("names new sheets sequentially", () => {
    expect(nextSheetName([{ name: "Page 1" }])).toBe("Лист 2");
    expect(nextSheetName([{ name: "Лист 1" }, { name: "Лист 2" }])).toBe("Лист 3");
    expect(nextSheetName([{ name: "Лист 4" }, { name: "Черновик" }])).toBe("Лист 5");
  });

  it("restores the saved sheet, otherwise the last sheet in page order", () => {
    const pages = [
      { id: "page:1", name: "Лист 1" },
      { id: "page:2", name: "Лист 2" },
    ];
    expect(pageToRestore(pages, "page:2")).toBe("page:2");
    expect(pageToRestore(pages, "page:deleted")).toBe("page:2");
    expect(pageToRestore(pages, "")).toBe("page:2");
  });

  it("keeps the last opened sheet per user and board in this browser", () => {
    const storage = memoryStorage();
    const editor = sheetEditor({
      pages: [
        { id: "page:1", name: "Лист 1" },
        { id: "page:2", name: "Лист 2" },
      ],
      current: "page:1",
    });
    const key = sheetStorageKey(7, "board-a");
    storage.setItem(key, "page:2");
    const writes = [];
    const tracking = {
      getItem: (itemKey) => storage.getItem(itemKey),
      setItem: (itemKey, value) => {
        writes.push(value);
        storage.setItem(itemKey, value);
      },
    };
    const dispose = installLessonSheets(editor, { userId: 7, boardId: "board-a", storage: tracking });
    expect(editor.getCurrentPageId()).toBe("page:2");
    expect(writes).toEqual(["page:2"]);
    editor.setCurrentPage("page:1");
    expect(storage.getItem(key)).toBe("page:1");
    editor.setCurrentPage("page:1");
    expect(writes.filter((value) => value === "page:1")).toHaveLength(1);

    dispose();
    editor.setCurrentPage("page:2");
    expect(storage.getItem(key)).toBe("page:1");

    editor.setCurrentPage("page:1");
    installLessonSheets(editor, { userId: 7, boardId: "board-a", storage });
    expect(editor.getCurrentPageId()).toBe("page:1");

    const other = memoryStorage();
    installLessonSheets(sheetEditor({ pages: [{ id: "page:9", name: "Лист 9" }] }), {
      userId: 8,
      boardId: "board-a",
      storage: other,
    });
    expect(other.getItem(sheetStorageKey(8, "board-a"))).toBe("page:9");
    expect(storage.getItem(key)).toBe("page:1");
    expect(sheetStorageKey(7, "board-a")).not.toBe(sheetStorageKey(8, "board-a"));
    expect(sheetStorageKey(7, "board-a")).not.toBe(sheetStorageKey(7, "board-b"));
  });

  it("opens the last remaining sheet when the saved one was deleted", () => {
    const storage = memoryStorage({ [sheetStorageKey(1, "board")]: "page:gone" });
    const editor = sheetEditor({
      pages: [
        { id: "page:1", name: "Лист 1" },
        { id: "page:3", name: "Лист 3" },
      ],
      current: "page:1",
    });
    installLessonSheets(editor, { userId: 1, boardId: "board", storage });
    expect(editor.getCurrentPageId()).toBe("page:3");
    expect(storage.getItem(sheetStorageKey(1, "board"))).toBe("page:3");
  });

  it("does not move a user who is following the teacher", () => {
    const storage = memoryStorage({ [sheetStorageKey(1, "board")]: "page:2" });
    const editor = sheetEditor({
      pages: [
        { id: "page:1", name: "Лист 1" },
        { id: "page:2", name: "Лист 2" },
      ],
      current: "page:1",
      following: "teacher",
    });
    installLessonSheets(editor, { userId: 1, boardId: "board", storage });
    expect(editor.getCurrentPageId()).toBe("page:1");
    expect(storage.getItem(sheetStorageKey(1, "board"))).toBe("page:2");
  });
});

describe("new sheet", () => {
  it("creates one empty page, switches to it, and ignores a double click", () => {
    const editor = sheetEditor({ pages: [{ id: "page:1", name: "Page 1" }] });
    const storage = memoryStorage();
    bindLessonSheetSession({ userId: 3, boardId: "board", storage });
    const created = createNextSheet(editor, 10_000);
    expect(created.ok).toBe(true);
    expect(editor.getPages().map((page) => page.name)).toEqual(["Лист 1", "Лист 2"]);
    expect(editor.getCurrentPageId()).toBe(created.pageId);
    expect(storage.getItem(sheetStorageKey(3, "board"))).toBe(created.pageId);
    expect(createNextSheet(editor, 10_100)).toMatchObject({ ok: false, reason: "busy" });
    expect(editor.getPages()).toHaveLength(2);
    const third = createNextSheet(editor, 10_500);
    expect(third.ok).toBe(true);
    expect(editor.getPages()[2].name).toBe("Лист 3");
  });

  it("explains the page limit instead of creating nothing silently", () => {
    const toasts = toastHarness();
    const editor = sheetEditor({
      pages: [{ id: "page:1", name: "Лист 1" }],
      maxPages: 1,
    });
    expect(requestNewSheet(editor, 20_000)).toMatchObject({ ok: false, reason: "max-pages" });
    expect(editor.getPages()).toHaveLength(1);
    expect(toasts.items.map((toast) => toast.title)).toEqual([MAX_PAGES_MESSAGE]);
  });

  it("does not create a sheet without edit rights", () => {
    const editor = sheetEditor({
      pages: [{ id: "page:1", name: "Лист 1" }],
      readonly: true,
    });
    expect(createNextSheet(editor, 30_000)).toMatchObject({ ok: false, reason: "readonly" });
    expect(editor.getPages()).toHaveLength(1);
  });
});

describe("sheet capacity notices", () => {
  it("shows the approaching notice once, then the filled notice once after Later", () => {
    expect(noticeKind(initialSheetNotice("page:1"))).toBe("none");
    let state = initialSheetNotice("page:1");
    state = reduceSheetNotice(state, { type: "count", count: 8, limit: 10 });
    expect(noticeKind(state)).toBe("none");
    state = reduceSheetNotice(state, { type: "count", count: 9, limit: 10 });
    expect(noticeKind(state)).toBe("approaching");
    const again = reduceSheetNotice(state, { type: "count", count: 9, limit: 10 });
    expect(again).toBe(state);
    state = reduceSheetNotice(state, { type: "later" });
    expect(noticeKind(state)).toBe("none");
    state = reduceSheetNotice(state, { type: "count", count: 9, limit: 10 });
    expect(noticeKind(state)).toBe("none");
    state = reduceSheetNotice(state, { type: "max-shapes" });
    expect(noticeKind(state)).toBe("full");
    const repeat = reduceSheetNotice(state, { type: "max-shapes" });
    expect(noticeKind(repeat)).toBe("full");
    expect(repeat).toBe(state);
    state = reduceSheetNotice(state, { type: "later" });
    state = reduceSheetNotice(state, { type: "max-shapes" });
    expect(noticeKind(state)).toBe("none");
  });

  it("does not stack notices or subscribe twice", async () => {
    const toasts = toastHarness();
    const editor = sheetEditor({ pages: [{ id: "page:1", name: "Лист 1" }], maxShapes: 10 });
    const dispose = installLessonSheets(editor, {
      userId: 1,
      boardId: "board",
      storage: memoryStorage(),
    });
    expect(editor.maxListeners.size).toBe(1);
    expect(editor.storeListeners).toHaveLength(2);
    expect(toasts.items).toHaveLength(0);

    editor.shapes = 9;
    editor.emitDocument("user");
    editor.emitDocument("user");
    expect(toasts.items.map((toast) => toast.id)).toEqual([APPROACHING_TOAST_ID]);
    expect(toasts.items[0].title).toBe(APPROACHING_MESSAGE);

    toasts.items[0].actions[1].onClick();
    expect(toasts.items).toHaveLength(0);

    toasts.addToast({ id: "stock", title: STOCK_MAX_SHAPES_TITLE });
    editor.emitMax();
    editor.emitMax();
    await Promise.resolve();
    expect(toasts.items.map((toast) => toast.title)).toEqual([FULL_MESSAGE]);
    expect(toasts.items.some((toast) => toast.title === STOCK_MAX_SHAPES_TITLE)).toBe(false);

    editor.setCurrentPage("page:1");
    dispose();
    expect(editor.maxListeners.size).toBe(0);
    expect(editor.storeListeners).toHaveLength(0);
    editor.shapes = 9;
    editor.emitDocument("user");
    editor.emitMax();
    expect(toasts.items.map((toast) => toast.id)).toEqual([FULL_TOAST_ID]);
  });
});

describe("tldraw shape limit", () => {
  it("rejects a whole batch and offers a new sheet inside the same document", async () => {
    const tldraw = await import("tldraw");
    const container = document.createElement("div");
    document.body.append(container);
    const store = tldraw.createTLStore({ shapeUtils: tldraw.defaultShapeUtils });
    const editor = new tldraw.Editor({
      store,
      shapeUtils: tldraw.defaultShapeUtils,
      bindingUtils: tldraw.defaultBindingUtils,
      tools: [],
      getContainer: () => container,
      options: { maxShapesPerPage: 10 },
    });
    const other = new tldraw.Editor({
      store: tldraw.createTLStore({ shapeUtils: tldraw.defaultShapeUtils }),
      shapeUtils: tldraw.defaultShapeUtils,
      bindingUtils: tldraw.defaultBindingUtils,
      tools: [],
      getContainer: () => document.createElement("div"),
      options: { maxShapesPerPage: 10 },
    });
    const toasts = toastHarness();
    const storage = memoryStorage();
    installLessonSheets(editor, { userId: 4, boardId: "board", storage });

    const draw = (count, y) =>
      Array.from({ length: count }, (_, index) => ({
        type: "geo",
        x: index * 24,
        y,
        props: { w: 20, h: 20, geo: "rectangle" },
      }));

    editor.createShapes(draw(8, 0));
    expect(editor.getCurrentPageShapeIds().size).toBe(8);
    expect(toasts.items).toHaveLength(0);

    editor.createShapes(draw(1, 40));
    expect(editor.getCurrentPageShapeIds().size).toBe(9);
    expect(toasts.items.map((toast) => toast.id)).toEqual([APPROACHING_TOAST_ID]);

    const before = [...editor.getCurrentPageShapeIds()];
    editor.createShapes(draw(4, 80));
    expect([...editor.getCurrentPageShapeIds()]).toEqual(before);

    const pasted = editor.getContentFromCurrentPage([...editor.getCurrentPageShapeIds()].slice(0, 3));
    editor.putContentOntoCurrentPage(pasted);
    expect([...editor.getCurrentPageShapeIds()]).toEqual(before);
    await Promise.resolve();
    expect(toasts.items.map((toast) => toast.title)).toEqual([FULL_MESSAGE]);
    expect(toasts.items.some((toast) => toast.title === STOCK_MAX_SHAPES_TITLE)).toBe(false);

    const otherPage = other.getCurrentPageId();
    toasts.items[0].actions[0].onClick();
    expect(toasts.items).toHaveLength(0);
    expect(editor.getPages().map((page) => page.name)).toEqual(["Лист 1", "Лист 2"]);
    expect(editor.getCurrentPageId()).not.toBe(editor.getPages()[0].id);
    expect(editor.getCurrentPageShapeIds().size).toBe(0);
    expect(editor.getPage(editor.getPages()[0].id)).toBeTruthy();
    expect([...editor.getCurrentPageShapeIds()]).toHaveLength(0);
    editor.setCurrentPage(editor.getPages()[0].id);
    expect(editor.getCurrentPageShapeIds().size).toBe(9);

    const created = editor.getPages()[1];
    expect(created.typeName).toBe("page");
    other.store.mergeRemoteChanges(() => {
      other.store.put([created]);
    });
    expect(other.getPage(created.id)?.name).toBe("Лист 2");
    expect(other.getCurrentPageId()).toBe(otherPage);

    editor.dispose();
    other.dispose();
    container.remove();
  });
});
