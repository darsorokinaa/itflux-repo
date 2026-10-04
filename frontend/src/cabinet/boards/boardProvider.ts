/** Выбор доски и стабильный room id. Без персональных данных и без случайных id. */

export type BoardProviderName = "excalidraw" | "tldraw";

const BOARD_UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function normalizeBoardProvider(value: unknown): BoardProviderName {
  return String(value ?? "").trim().toLowerCase() === "tldraw" ? "tldraw" : "excalidraw";
}

/**
 * Комната tldraw для одной доски. Это UUID InteractiveBoard, тот же ключ,
 * что у маршрута `/ws/tldraw/<uuid>/`. VideoMeeting.uuid сюда не подмешивается.
 */
export function lessonBoardRoomId(boardId: unknown): string {
  const id = String(boardId ?? "").trim();
  if (!BOARD_UUID.test(id)) return "";
  return id.toLowerCase();
}

/** Абсолютный WebSocket нашей комнаты. VITE_TLDRAW_SYNC_URL — origin, не путь. */
export function lessonBoardSyncUri(boardId: unknown): string {
  const id = lessonBoardRoomId(boardId);
  if (!id || typeof window === "undefined") return "";
  const configured = import.meta.env?.VITE_TLDRAW_SYNC_URL;
  const base = typeof configured === "string" && configured.trim()
    ? configured.trim().replace(/\/$/, "")
    : `${window.location.protocol === "https:" ? "wss:" : "ws:"}//${window.location.host}`;
  return `${base}/ws/tldraw/${id}/`;
}

const STUDENT_PRESENCE_COLORS = ["#e11d48", "#099268", "#ae3ec9", "#e16919", "#0c8599", "#5f3dc4"];

/** Цвет курсора. Учитель один, ученики различаются по user id, а не общим розовым. */
export function lessonBoardPresenceColor(role: unknown, userId?: unknown): string {
  if (role === "teacher") return "#2563eb";
  if (role === "viewer") return "#64748b";
  const text = String(userId ?? "");
  let hash = 0;
  for (let index = 0; index < text.length; index += 1) {
    hash = (hash + text.charCodeAt(index) * (index + 1)) % STUDENT_PRESENCE_COLORS.length;
  }
  return STUDENT_PRESENCE_COLORS[hash];
}

/** Имя на курсоре. Email и пустое имя заменяются ролью. */
export function lessonBoardDisplayName(name: unknown, role: unknown): string {
  const raw = String(name ?? "").trim();
  if (raw && !raw.includes("@")) return raw.slice(0, 80);
  if (role === "teacher") return "Учитель";
  if (role === "viewer") return "Зритель";
  return "Ученик";
}

/** Публичный frontend-ключ tldraw. Пустая строка на localhost не передаётся. */
export function tldrawLicenseKey(): string | undefined {
  const raw = import.meta.env?.VITE_TLDRAW_LICENSE_KEY;
  if (typeof raw !== "string") return undefined;
  const key = raw.trim();
  return key || undefined;
}

