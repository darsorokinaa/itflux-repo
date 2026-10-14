import { fetchTldrawSyncToken } from "../../utils/cabinetAuth";

const TOKEN_FRESH_MS = 30_000;
const tokens = new Map();
let editorModule = null;

/** Один запрос токена на открытие. Повтор в течение 30 секунд берёт тот же ответ. */
export function prefetchTldrawSyncToken(boardId) {
  const id = String(boardId || "").trim();
  if (!id || typeof fetchTldrawSyncToken !== "function") return Promise.resolve(null);
  const hit = tokens.get(id);
  if (hit && Date.now() - hit.at < TOKEN_FRESH_MS) return hit.promise;
  const promise = fetchTldrawSyncToken(id).catch((error) => {
    const current = tokens.get(id);
    if (current?.promise === promise) tokens.delete(id);
    throw error;
  });
  tokens.set(id, { at: Date.now(), promise });
  return promise;
}

/** Редактор и шлюз качаются вместе с карточкой доски, а не после ответа API. */
export function warmBoardEditor() {
  if (!editorModule) {
    editorModule = Promise.all([
      import("./BoardEditorGate"),
      import("./TldrawBoard"),
    ]).catch((error) => {
      editorModule = null;
      throw error;
    });
  }
  return editorModule;
}
