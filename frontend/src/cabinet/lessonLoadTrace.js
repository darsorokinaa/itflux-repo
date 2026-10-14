/**
 * Временная запись одной попытки открыть звонок и доску.
 * Без JWT и секретов. Пустой Resource Timing не означает, что запрос не уходил:
 * запись появляется, когда загрузка завершилась.
 */

const SCRIPT_KEY = "__ITFLUX_SCRIPT_TRACE";
const BOARD_KEY = "__ITFLUX_BOARD_TRACE";
const SESSION_KEY = "itflux-script-trace";

function nowIso() {
  return new Date().toISOString();
}

export function scrubTraceText(value) {
  return String(value || "")
    .replace(/eyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+/g, "[jwt]")
    .replace(/((?:jwt|token|access_token|secret|password|signature)=)[^&\s]+/gi, "$1redacted")
    .slice(0, 240);
}

export function publicScriptUrl(value) {
  const raw = String(value || "");
  try {
    const url = new URL(raw);
    for (const key of [...url.searchParams.keys()]) {
      if (/jwt|token|secret|password|signature/i.test(key)) url.searchParams.set(key, "redacted");
    }
    return url.toString();
  } catch {
    return scrubTraceText(raw);
  }
}

function emptyTrace() {
  return {
    callSessionId: "",
    attempts: [],
    jsErrors: [],
    pageEvents: [],
  };
}

function root() {
  if (typeof window === "undefined") return emptyTrace();
  if (!window[SCRIPT_KEY]) window[SCRIPT_KEY] = emptyTrace();
  return window[SCRIPT_KEY];
}

function persist() {
  if (typeof sessionStorage === "undefined") return;
  try {
    sessionStorage.setItem(SESSION_KEY, JSON.stringify(root()));
  } catch {
    /* квота не должна ломать урок */
  }
}

export function readScriptTrace() {
  return root();
}

export function bindCallSessionId(callSessionId) {
  const id = scrubTraceText(callSessionId);
  const trace = root();
  trace.callSessionId = id;
  persist();
  return id;
}

function currentAttempt() {
  const trace = root();
  return trace.attempts[trace.attempts.length - 1] || null;
}

export function beginScriptAttempt({ attemptId = "", scriptUrl = "" } = {}) {
  const trace = root();
  const id = scrubTraceText(attemptId || trace.callSessionId || "");
  if (id) trace.callSessionId = id;
  const attempt = {
    n: trace.attempts.length + 1,
    callSessionId: trace.callSessionId,
    scriptUrl: publicScriptUrl(scriptUrl),
    createdAt: "",
    insertedAt: "",
    inDocumentAtTimeout: null,
    loadAt: "",
    errorAt: "",
    apiGlobalAt: "",
    removedAt: "",
    removedReason: "",
    resourceTiming: null,
    events: [],
  };
  trace.attempts = trace.attempts.slice(-3).concat(attempt);
  persist();
  return attempt;
}

export function noteScriptEvent(name, detail = {}) {
  const attempt = currentAttempt();
  const at = nowIso();
  const event = { name, at, ...detail };
  if (event.scriptUrl) event.scriptUrl = publicScriptUrl(event.scriptUrl);
  if (attempt) {
    attempt.events.push(event);
    if (name === "tag_created") attempt.createdAt = at;
    if (name === "tag_inserted") attempt.insertedAt = at;
    if (name === "script_load") attempt.loadAt = at;
    if (name === "script_error") attempt.errorAt = at;
    if (name === "api_global") attempt.apiGlobalAt = at;
    if (name === "timeout") attempt.inDocumentAtTimeout = Boolean(detail.inDocument);
    if (name === "tag_removed") {
      attempt.removedAt = at;
      attempt.removedReason = String(detail.reason || "");
    }
    if (name === "timeout" && detail.resourceTiming) attempt.resourceTiming = detail.resourceTiming;
  } else {
    root().pageEvents.push(event);
  }
  persist();
  return event;
}

export function scriptResourceTiming(scriptUrl) {
  const target = publicScriptUrl(scriptUrl);
  const note = "Пустой список не доказывает, что запрос не отправлялся: запись появляется после завершения загрузки.";
  if (typeof performance === "undefined" || typeof performance.getEntriesByType !== "function") {
    return { available: false, note, entries: [] };
  }
  let entries = [];
  try {
    entries = performance.getEntriesByType("resource");
  } catch (err) {
    return { available: false, note, entries: [], readError: scrubTraceText(err?.message || err) };
  }
  const matched = entries.filter((entry) => {
    const name = String(entry?.name || "");
    return name === target || name.includes("external_api");
  }).slice(-4).map((entry) => ({
    name: publicScriptUrl(entry.name),
    initiatorType: String(entry.initiatorType || ""),
    startTime: Math.round(Number(entry.startTime) || 0),
    duration: Math.round(Number(entry.duration) || 0),
    transferSize: Number(entry.transferSize) || 0,
    decodedBodySize: Number(entry.decodedBodySize) || 0,
    responseStatus: Number(entry.responseStatus) || 0,
  }));
  return { available: true, note, entries: matched };
}

let jsErrorsInstalled = false;

export function installScriptErrorCapture() {
  if (jsErrorsInstalled || typeof window === "undefined") return;
  jsErrorsInstalled = true;
  window.addEventListener("error", (event) => {
    const list = root().jsErrors;
    list.push({
      at: nowIso(),
      message: scrubTraceText(event?.message || "error"),
      source: publicScriptUrl(event?.filename || ""),
      line: Number(event?.lineno) || 0,
    });
    root().jsErrors = list.slice(-8);
    persist();
  });
  window.addEventListener("unhandledrejection", (event) => {
    const reason = event?.reason;
    const list = root().jsErrors;
    list.push({
      at: nowIso(),
      message: scrubTraceText(reason?.message || reason || "unhandledrejection"),
      source: "unhandledrejection",
      line: 0,
    });
    root().jsErrors = list.slice(-8);
    persist();
  });
}

function boardRoot() {
  if (typeof window === "undefined") return null;
  if (!window[BOARD_KEY]) {
    window[BOARD_KEY] = { events: [], jsErrors: [] };
  }
  return window[BOARD_KEY];
}

export function markBoard(field, value) {
  const board = boardRoot();
  if (!board) return;
  const safe = typeof value === "string" ? scrubTraceText(value) : value;
  board[field] = safe;
  board.events = board.events.slice(-12).concat({ field, at: nowIso(), value: safe });
}

export function installBoardErrorCapture() {
  const board = boardRoot();
  if (!board || board.errorsInstalled || typeof window === "undefined") return;
  board.errorsInstalled = true;
  window.addEventListener("error", (event) => {
    board.jsErrors = (board.jsErrors || []).slice(-7).concat({
      at: nowIso(),
      message: scrubTraceText(event?.message || "error"),
      source: publicScriptUrl(event?.filename || ""),
      line: Number(event?.lineno) || 0,
    });
  });
}
