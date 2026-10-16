/**
 * Отладка следов на iPad: ?tldebug=a,b,c в адресе страницы (или #tldebug=...).
 * Каждый флаг отключает одну подозрительную часть доски.
 *   nojitsi   — скрыть плавающее окно звонка (iframe+видео) поверх доски, звук остаётся
 *   nopaper   — штатный фон tldraw вместо своей «бумаги» (SVG-узор, перерисовка на каждый сдвиг)
 *   nocursor  — штатные курсоры участников вместо LessonCursor
 *   nochrome  — убрать свою верхнюю/боковую панель поверх холста (InFrontOfTheCanvas)
 *   nocv      — вернуть штатный content-visibility: auto на .tl-canvas
 *   noinput   — не ставить свой перехват pointer-событий (ластик/ладонь)
 *   all       — всё сразу
 */
const FLAGS = ["nopresence", "nosheets", "nojitsi", "nopaper", "nocursor", "nochrome", "nocv", "noinput"];

function readFlags() {
  if (typeof window === "undefined") return new Set();
  const raw = [];
  try {
    raw.push(new URLSearchParams(window.location.search).get("tldebug") || "");
    const hash = String(window.location.hash || "");
    const m = hash.match(/tldebug=([^&]*)/);
    if (m) raw.push(decodeURIComponent(m[1]));
  } catch {
    /* ignore */
  }
  try {
    const joined = raw.join(",").trim();
    if (joined) window.sessionStorage.setItem("tldebug", joined === "off" ? "" : joined);
    else raw.push(window.sessionStorage.getItem("tldebug") || "");
  } catch {
    /* ignore */
  }
  const set = new Set(raw.join(",").split(",").map((s) => s.trim().toLowerCase()).filter(Boolean));
  set.delete("off");
  if (set.has("allbutchrome")) FLAGS.filter((f) => f !== "nochrome").forEach((f) => set.add(f));
  if (set.has("all")) FLAGS.forEach((f) => set.add(f));
  return set;
}

export const boardDebug = readFlags();

if (typeof document !== "undefined" && boardDebug.size) {
  for (const flag of boardDebug) document.documentElement.classList.add(`tldebug-${flag}`);
  console.info("[itflux tldebug]", [...boardDebug].join(","));
  const show = () => {
    if (!document.body || document.getElementById("itflux-tldebug-badge")) return;
    const badge = document.createElement("div");
    badge.id = "itflux-tldebug-badge";
    badge.textContent = `tldebug: ${[...boardDebug].join(",")}`;
    badge.style.cssText = "position:fixed;left:8px;bottom:8px;z-index:2147483647;background:#dc2626;color:#fff;font:600 12px/1.2 system-ui;padding:4px 8px;border-radius:6px;pointer-events:none";
    document.body.appendChild(badge);
  };
  if (document.body) show();
  else document.addEventListener("DOMContentLoaded", show);
}

export function debugBoardComponents(components) {
  if (!boardDebug.size) return components;
  const next = { ...components };
  if (boardDebug.has("nopaper")) delete next.Background;
  if (boardDebug.has("nocursor")) delete next.CollaboratorCursor;
  if (boardDebug.has("nochrome")) {
    // Без своей панели — штатный интерфейс tldraw, чтобы можно было рисовать.
    const stock = {};
    if (!boardDebug.has("nopaper") && next.Background) stock.Background = next.Background;
    if (!boardDebug.has("nocursor") && next.CollaboratorCursor) stock.CollaboratorCursor = next.CollaboratorCursor;
    return stock;
  }
  return next;
}

let mounts = 0;
/** Счётчик монтирований редактора tldraw: перемонтирование — подозреваемый источник следов. */
export function boardDebugMounted() {
  mounts += 1;
  if (typeof document === "undefined" || !boardDebug.size) return;
  const badge = document.getElementById("itflux-tldebug-badge");
  if (badge) badge.textContent = `tldebug: ${[...boardDebug].join(",")} · mounts: ${mounts}`;
  console.info("[itflux tldebug] tldraw mount", mounts);
}
