/** Листы доски: страницы текущего документа tldraw и личный последний лист. */

export const SHEET_APPROACHING_RATIO = 0.9;
export const SHEET_CREATE_LOCK_MS = 400;
export const STOCK_MAX_SHAPES_TITLE = "Maximum shapes reached";
export const APPROACHING_TOAST_ID = "lesson-sheet-approaching";
export const FULL_TOAST_ID = "lesson-sheet-full";
export const PAGES_TOAST_ID = "lesson-sheet-pages";

export const APPROACHING_MESSAGE =
  "На этом листе уже много объектов. Вы можете продолжить на новом листе — всё нарисованное останется на предыдущем.";
export const FULL_MESSAGE = "Лист заполнен. Создайте новый лист, чтобы продолжить работу.";
export const MAX_PAGES_MESSAGE = "Больше листов создать нельзя: на этой доске уже максимум листов.";

const DEFAULT_PAGE_NAME = "Page 1";

let toastApi = null;
let sheetSession = null;
let createLockedUntil = 0;

export function sheetStorageKey(userId, boardId) {
  return `itflux.boardLastPage.${userId}.${boardId}`;
}

export function readLastOpenedPageId(storage, userId, boardId) {
  try {
    return storage?.getItem(sheetStorageKey(userId, boardId)) || "";
  } catch {
    return "";
  }
}

export function writeLastOpenedPageId(storage, userId, boardId, pageId) {
  if (!storage || !pageId) return;
  try {
    storage.setItem(sheetStorageKey(userId, boardId), pageId);
  } catch {
    /* приватный режим браузера */
  }
}

export function sheetLabel(name) {
  return name === "Page 1" ? "Лист 1" : name || "Лист";
}

export function nextSheetName(pages) {
  let max = 0;
  for (const page of pages) {
    const match = /^Лист (\d+)$/.exec(page.name || "");
    if (match) max = Math.max(max, Number(match[1]));
  }
  return `Лист ${max > 0 ? max + 1 : pages.length + 1}`;
}

/** Сохранённый лист, если он ещё есть. Иначе последний лист в порядке страниц tldraw. */
export function pageToRestore(pages, savedId) {
  if (!pages.length) return "";
  if (savedId && pages.some((page) => page.id === savedId)) return savedId;
  return pages[pages.length - 1].id;
}

export function initialSheetNotice(pageId) {
  return {
    pageId: pageId || "",
    approaching: false,
    approachingDismissed: false,
    full: false,
    fullAnnounced: false,
    dismissedByPage: {},
  };
}

export function reduceSheetNotice(state, event) {
  if (event.type === "page") {
    if (!event.pageId || event.pageId === state.pageId) return state;
    return {
      pageId: event.pageId,
      approaching: false,
      approachingDismissed: Boolean(state.dismissedByPage[event.pageId]),
      full: false,
      fullAnnounced: false,
      dismissedByPage: state.dismissedByPage,
    };
  }
  if (event.type === "later") {
    if (state.full) return { ...state, full: false, fullAnnounced: true };
    if (state.approaching) {
      return {
        ...state,
        approaching: false,
        approachingDismissed: true,
        dismissedByPage: { ...state.dismissedByPage, [state.pageId]: true },
      };
    }
    return state;
  }
  if (event.type === "max-shapes") {
    if (state.full || state.fullAnnounced) {
      return state.approaching ? { ...state, approaching: false } : state;
    }
    return { ...state, approaching: false, full: true, fullAnnounced: true };
  }
  if (event.type === "count") {
    const limit = event.limit || 0;
    const ratio = limit > 0 ? event.count / limit : 0;
    if (ratio >= 1) {
      if (state.full || state.fullAnnounced) {
        return state.approaching ? { ...state, approaching: false } : state;
      }
      return { ...state, approaching: false, full: true, fullAnnounced: true };
    }
    if (ratio >= SHEET_APPROACHING_RATIO) {
      if (state.approaching || state.approachingDismissed || state.full || state.fullAnnounced) return state;
      return { ...state, approaching: true };
    }
    return state;
  }
  return state;
}

export function noticeKind(state) {
  if (state.full) return "full";
  if (state.approaching) return "approaching";
  return "none";
}

export function isStockMaxShapesToast(toast) {
  return toast?.title === STOCK_MAX_SHAPES_TITLE;
}

export function dropStockMaxShapesToasts(toasts) {
  const list = typeof toasts?.toasts?.get === "function" ? toasts.toasts.get() : [];
  for (const toast of list) {
    if (isStockMaxShapesToast(toast)) toasts.removeToast(toast.id);
  }
}

export function bindSheetToasts(api) {
  toastApi = api || null;
  return () => {
    if (toastApi === api) toastApi = null;
  };
}

export function bindLessonSheetSession(session) {
  sheetSession = session || null;
}

function rememberPage(pageId) {
  if (!sheetSession || !pageId) return;
  writeLastOpenedPageId(sheetSession.storage, sheetSession.userId, sheetSession.boardId, pageId);
}

export function createNextSheet(editor, now = Date.now()) {
  if (now < createLockedUntil) return { ok: false, reason: "busy" };
  if (editor.getIsReadonly()) return { ok: false, reason: "readonly" };
  const pages = editor.getPages();
  const maxPages = editor.options?.maxPages ?? 40;
  if (pages.length >= maxPages) return { ok: false, reason: "max-pages" };

  createLockedUntil = now + SHEET_CREATE_LOCK_MS;
  if (pages.length === 1 && pages[0].name === DEFAULT_PAGE_NAME) {
    editor.updatePage({ id: pages[0].id, name: "Лист 1" });
  }
  const name = nextSheetName(editor.getPages());
  const before = new Set(editor.getPages().map((page) => page.id));
  editor.createPage({ name });
  const created = editor.getPages().find((page) => !before.has(page.id));
  if (!created) return { ok: false, reason: "failed" };
  editor.setCurrentPage(created.id);
  rememberPage(created.id);
  return { ok: true, pageId: created.id, name: created.name };
}

export function requestNewSheet(editor, now = Date.now()) {
  const result = createNextSheet(editor, now);
  if (!result.ok && result.reason === "max-pages") {
    toastApi?.addToast({
      id: PAGES_TOAST_ID,
      title: MAX_PAGES_MESSAGE,
      severity: "warning",
      keepOpen: true,
    });
  }
  return result;
}

function publishSheetNotice(editor, state, dismiss) {
  const toasts = toastApi;
  if (!toasts) return;
  dropStockMaxShapesToasts(toasts);
  const kind = noticeKind(state);
  if (kind !== "approaching") toasts.removeToast(APPROACHING_TOAST_ID);
  if (kind !== "full") toasts.removeToast(FULL_TOAST_ID);
  if (kind === "none") return;
  const actions = [{ type: "normal", label: "Позже", onClick: dismiss }];
  if (!editor.getIsReadonly()) {
    actions.unshift({ type: "primary", label: "Создать новый лист", onClick: () => requestNewSheet(editor) });
  }
  toasts.addToast({
    id: kind === "full" ? FULL_TOAST_ID : APPROACHING_TOAST_ID,
    title: kind === "full" ? FULL_MESSAGE : APPROACHING_MESSAGE,
    severity: kind === "full" ? "warning" : "info",
    keepOpen: true,
    actions,
  });
}

function noticeVisibleChanged(prev, next) {
  return noticeKind(prev) !== noticeKind(next);
}

/**
 * Ждёт уже загруженный документ: вызывается из onMount после синхронизации.
 * До восстановления не записывает стартовую страницу поверх сохранённого выбора.
 */
export function installLessonSheets(editor, { userId, boardId, storage }) {
  bindLessonSheetSession({ userId, boardId, storage });
  let accept = false;
  let lastPersisted = "";
  let state = initialSheetNotice(editor.getCurrentPageId());

  const persist = (pageId) => {
    if (!accept || !pageId || pageId === lastPersisted) return;
    if (editor.getInstanceState().followingUserId) return;
    lastPersisted = pageId;
    writeLastOpenedPageId(storage, userId, boardId, pageId);
  };

  const dismiss = () => {
    const next = reduceSheetNotice(state, { type: "later" });
    state = next;
    publishSheetNotice(editor, state, dismiss);
  };

  const applyCount = () => {
    const next = reduceSheetNotice(state, {
      type: "count",
      count: editor.getCurrentPageShapeIds().size,
      limit: editor.options.maxShapesPerPage,
    });
    if (!noticeVisibleChanged(state, next)) {
      state = next;
      return;
    }
    state = next;
    publishSheetNotice(editor, state, dismiss);
  };

  const onSession = () => {
    const pageId = editor.getCurrentPageId();
    if (pageId && pageId !== state.pageId) {
      const next = reduceSheetNotice(state, { type: "page", pageId });
      const changed = noticeVisibleChanged(state, next);
      state = next;
      if (changed) publishSheetNotice(editor, state, dismiss);
    }
    persist(pageId);
  };

  const onMaxShapes = () => {
    const next = reduceSheetNotice(state, { type: "max-shapes" });
    const changed = noticeVisibleChanged(state, next);
    state = next;
    if (changed) publishSheetNotice(editor, state, dismiss);
    queueMicrotask(() => dropStockMaxShapesToasts(toastApi));
  };

  const stopSession = editor.store.listen(onSession, { scope: "session" });
  const stopDocument = editor.store.listen(applyCount, { scope: "document" });
  editor.addListener("max-shapes", onMaxShapes);

  const following = Boolean(editor.getInstanceState().followingUserId);
  const target = pageToRestore(editor.getPages(), readLastOpenedPageId(storage, userId, boardId));
  if (!following && target && editor.getCurrentPageId() !== target) {
    editor.setCurrentPage(target);
    state = { ...state, pageId: editor.getCurrentPageId() };
  }
  accept = true;
  if (!following) persist(editor.getCurrentPageId());
  applyCount();

  return () => {
    accept = false;
    stopSession();
    stopDocument();
    editor.removeListener("max-shapes", onMaxShapes);
  };
}
