/**
 * Домашнее задание из ЛК: API `/api/homework/assignment/…` на том же origin, что и вариант.
 * JWT в query (`lesson_token` → `token`) — без прокси `/api/lesson/homework/…`.
 * Без токена — cross-origin только если VITE_LK_PUBLIC_URL на другом origin.
 */

import { ensureCsrfCookie } from "./cabinetAuth";

export function getLkPublicBase() {
  const u = (import.meta.env.VITE_LK_PUBLIC_URL || import.meta.env.VITE_LK_URL || "")
    .trim()
    .replace(/\/$/, "");
  return u;
}

/**
 * @typedef {{ lessonToken?: string }} HomeworkLkRequestOpts
 */

/** JWT в заголовках, не в query (Referer / логи / аналитика). */
export function homeworkAuthHeaders(opts) {
  const tok = (opts && opts.lessonToken) || "";
  /** @type {Record<string, string>} */
  const headers = {};
  if (tok) {
    headers.Authorization = `Bearer ${tok}`;
    headers["X-Lesson-Token"] = tok;
  }
  return headers;
}

/**
 * @param {string} assignmentId
 * @param {string} [lkSubpath] пусто | "save-draft/" | "submit/"
 * @param {HomeworkLkRequestOpts} [opts]
 * @returns {string}
 */
function buildHomeworkApiUrl(assignmentId, lkSubpath, opts) {
  const id = encodeURIComponent(String(assignmentId).trim());
  const suffix = String(lkSubpath || "")
    .trim()
    .replace(/^\//, "");
  const path = suffix
    ? `/api/homework/assignment/${id}/${suffix}`
    : `/api/homework/assignment/${id}/`;

  const legacyBase = getLkPublicBase();
  if (legacyBase && typeof window !== "undefined" && !(opts && opts.lessonToken)) {
    try {
      const lkOrigin = new URL(legacyBase).origin;
      if (lkOrigin !== window.location.origin) {
        return suffix
          ? `${legacyBase}/api/homework/assignment/${id}/${suffix}`
          : `${legacyBase}/api/homework/assignment/${id}/`;
      }
    } catch {
      /* ignore bad VITE_LK_PUBLIC_URL */
    }
  }

  return path;
}

/**
 * @param {string} search
 */
export function parseHomeworkFromSearchParams(search) {
  const sp = new URLSearchParams(
    search.startsWith("?") || search.startsWith("#") ? search : `?${search}`
  );
  const cabinetAssignment = (sp.get("cabinet_assignment") || sp.get("cabinetAssignment") || "")
    .trim();
  const cabinetSession = (sp.get("cabinet_session") || sp.get("cabinetSession") || "")
    .trim()
    .toLowerCase();
  const homeworkModeFlag = sp.get("homework_mode") === "1" || sp.get("homework") === "1";
  const isLiveMeeting = sp.get("live_meeting") === "1" || sp.get("liveMeeting") === "1";
  const isHomework =
    homeworkModeFlag || cabinetSession === "homework" || !!cabinetAssignment;
  return {
    cabinetAssignment,
    cabinetSession,
    isHomework,
    isLiveMeeting,
  };
}

/**
 * В комнате урока параметры дз обычно в query iframe; если их нет (старые бандлы, редкий редирект),
 * при lesson_embed=1 тот же origin: читаем query родителя (страница /lesson/join/…).
 * @param {string} search — iframe location.search
 * @param {boolean} lessonEmbed
 */
export function parseHomeworkFromSearchForExam(search, lessonEmbed) {
  const fromIframe = parseHomeworkFromSearchParams(search);
  if (fromIframe.isHomework) return fromIframe;
  if (!lessonEmbed || typeof window === "undefined") return fromIframe;
  try {
    if (window.parent === window) return fromIframe;
    const ps = String(window.parent.location.search || "");
    if (!ps) return fromIframe;
    const fromParent = parseHomeworkFromSearchParams(ps);
    if (fromParent.isHomework) {
      return {
        cabinetAssignment: fromParent.cabinetAssignment || fromIframe.cabinetAssignment,
        cabinetSession: fromParent.cabinetSession || fromIframe.cabinetSession,
        isHomework: true,
        isLiveMeeting: fromParent.isLiveMeeting || fromIframe.isLiveMeeting,
      };
    }
  } catch {
    /* cross-origin */
  }
  return fromIframe;
}

/**
 * @param {string} s
 * @returns {'sent'|'submitted'|'reviewing'|'revision'|'reviewed'|'unknown'}
 */
export function normalizeHomeworkStatus(s) {
  const x = String(s || "")
    .trim()
    .toLowerCase();
  if (["sent", "draft", "not_sent", "notsent"].includes(x)) return "sent";
  if (x === "submitted" || x === "pending" || x === "waiting") return "submitted";
  if (x === "reviewing" || x === "in_review" || x === "inreview") return "reviewing";
  if (x === "revision" || x === "need_revision" || x === "returned") return "revision";
  if (x === "reviewed" || x === "done" || x === "checked" || x === "graded" || x === "approved")
    return "reviewed";
  return "unknown";
}

/**
 * @param {unknown} data — ответ GET assignment
 * @param {string} fallbackId
 */
export function pickHomeworkFields(data, fallbackId) {
  if (!data || typeof data !== "object") {
    return {
      id: String(fallbackId),
      status: "unknown",
      result: null,
      revisionTaskIds: [],
      deadline: null,
      variantId: null,
      raw: data,
    };
  }
  const d = /** @type {Record<string, unknown>} */ (data);
  const st =
    d.status || d.assignment_status || d.state || d.homework_status || d.homeworkStatus || "";
  const result = d.result ?? d.data ?? d.payload ?? d.answers ?? null;
  let revisionTaskIds = d.revision_task_ids || d.revisionTaskIds || d.revisionTasks || [];
  if (!Array.isArray(revisionTaskIds)) revisionTaskIds = [];
  revisionTaskIds = revisionTaskIds.map((x) => String(x).trim()).filter(Boolean);
  return {
    id: String(d.id ?? d.assignment_id ?? d.assignmentId ?? fallbackId),
    status: normalizeHomeworkStatus(String(st)),
    result,
    revisionTaskIds,
    deadline: d.deadline ?? d.deadline_at ?? d.deadlineAt ?? null,
    variantId: d.variant_id ?? d.variantId ?? d.variant_id ?? null,
    raw: d,
  };
}

/**
 * @param {unknown} result
 * @param {Map<string, {id?: unknown, number?: unknown}>} [taskByNumber]
 * @param {Array<{id?: unknown, number?: unknown}>} [allTasks] полный список задач
 *   (нужен при одинаковых bank-номерах — Map по номеру их схлопывает)
 */
export function homeworkResultToUiState(result, taskByNumber, allTasks) {
  // result: произвольный JSON от ЛК
  if (result == null) return { userAnswers: {}, scores: {}, checkedTasks: {} };
  const o = typeof result === "string" ? safeJson(result) : result;
  if (!o || typeof o !== "object") return { userAnswers: {}, scores: {}, checkedTasks: {} };
  const r = /** @type {Record<string, unknown>} */ (o);
  const outUa = {};
  const outSc = {};
  const outCh = {};

  const numberMap = taskByNumber instanceof Map ? taskByNumber : new Map();
  const tasksList = Array.isArray(allTasks) && allTasks.length
    ? allTasks
    : [...numberMap.values()];
  const knownIds = new Set();
  for (const t of tasksList) {
    if (t?.id != null) knownIds.add(String(t.id));
  }

  const stringifyAnswer = (val) => {
    if (typeof val === "string") return val;
    if (val && typeof val === "object" && "text" in /** @type {object} */ (val)) {
      return String(/** @type {{ text?: string }} */ (val).text ?? "");
    }
    if (val == null) return "";
    return String(val);
  };

  // Сколько задач с каждым bank-номером — by_number нельзя размазывать при коллизиях.
  const numberCounts = new Map();
  for (const t of tasksList) {
    if (t?.number == null) continue;
    const nk = String(t.number);
    numberCounts.set(nk, (numberCounts.get(nk) || 0) + 1);
  }

  const byNum = r.by_number || r.byNumber || r.answersByNumber;
  if (byNum && typeof byNum === "object") {
    for (const [num, val] of Object.entries(/** @type {Record<string, unknown>} */ (byNum))) {
      const numKey = String(num);
      if ((numberCounts.get(numKey) || 0) > 1) continue;
      const t = numberMap.get(numKey) || numberMap.get(String(Number(num)));
      if (!t?.id) continue;
      const text = stringifyAnswer(val);
      if (text.trim() !== "") outUa[String(t.id)] = text;
    }
  }

  const byId = r.by_task_id || r.byTaskId || r.answers;
  if (byId && typeof byId === "object") {
    for (const [key, val] of Object.entries(/** @type {Record<string, unknown>} */ (byId))) {
      const text = stringifyAnswer(val);
      if (text.trim() === "") continue;
      const keyStr = String(key);
      if (knownIds.has(keyStr)) {
        outUa[keyStr] = text;
        continue;
      }
      // Legacy: ключ — номер задания, а не TaskList.id (только если номер уникален)
      if ((numberCounts.get(keyStr) || 0) > 1) continue;
      const t = numberMap.get(keyStr) || numberMap.get(String(Number(keyStr)));
      if (t?.id != null) {
        const idKey = String(t.id);
        if (outUa[idKey] == null || String(outUa[idKey]).trim() === "") {
          outUa[idKey] = text;
        }
      } else {
        outUa[keyStr] = text;
      }
    }
  }

  if (r.scores && typeof r.scores === "object") {
    for (const [id, v] of Object.entries(/** @type {Record<string, unknown>} */ (r.scores))) {
      const n = Number(v);
      if (!Number.isNaN(n)) outSc[id] = n;
    }
  }
  if (r.checked && typeof r.checked === "object") {
    for (const [id, v] of Object.entries(/** @type {Record<string, unknown>} */ (r.checked))) {
      if (typeof v === "boolean") outCh[id] = v;
    }
  }
  return { userAnswers: outUa, scores: outSc, checkedTasks: outCh };
}

function safeJson(s) {
  try {
    return JSON.parse(s);
  } catch {
    return null;
  }
}

/**
 * @param {Array<{ id: number|string, number: number }>} tasks
 * @param {Record<string, string>} userAnswers
 * @param {Record<string, number>} scores
 * @param {Record<string, boolean>} [checkedTasks]
 */
const HOMEWORK_ATTACHMENT_IMAGE_RE = /\.(png|jpe?g|webp|gif|bmp|heic|heif)$/i;

/**
 * @param {unknown} result
 * @param {number|string} taskId
 * @param {number|string} taskNumber
 * @returns {Array<{ url: string, filename: string, isImage: boolean }>}
 */
export function homeworkTaskAttachments(result, taskId, taskNumber, tasks) {
  const o = typeof result === "string" ? safeJson(result) : result;
  if (!o || typeof o !== "object") return [];
  const r = /** @type {Record<string, unknown>} */ (o);
  const byId =
    /** @type {Record<string, unknown[]>|undefined} */ (
      r.attachments_by_task_id || r.attachmentsByTaskId
    );
  const byNum =
    /** @type {Record<string, unknown[]>|undefined} */ (
      r.attachments_by_number || r.attachmentsByNumber
    );
  const idKey = String(taskId);
  if (byId && Array.isArray(byId[idKey]) && byId[idKey].length) {
    return byId[idKey]
      .map((item) => {
        if (!item || typeof item !== "object") return null;
        const row = /** @type {{ url?: string, filename?: string }} */ (item);
        const url = String(row.url || "").trim();
        if (!url) return null;
        const filename = String(row.filename || url.split("/").pop() || "Файл");
        return { url, filename, isImage: HOMEWORK_ATTACHMENT_IMAGE_RE.test(filename) };
      })
      .filter(Boolean);
  }
  // by_number при одинаковых № заданий неоднозначен
  if (Array.isArray(tasks) && tasks.length > 1) {
    const numKey = String(taskNumber);
    const collisions = tasks.reduce(
      (n, t) => (String(t?.number) === numKey ? n + 1 : n),
      0,
    );
    if (collisions > 1) return [];
  }
  const list =
    (byNum && byNum[String(taskNumber)]) ||
    (byNum && byNum[String(Number(taskNumber))]) ||
    [];
  if (!Array.isArray(list)) return [];
  return list
    .map((item) => {
      if (!item || typeof item !== "object") return null;
      const row = /** @type {{ url?: string, filename?: string }} */ (item);
      const url = String(row.url || "").trim();
      if (!url) return null;
      const filename = String(row.filename || url.split("/").pop() || "Файл");
      return {
        url,
        filename,
        isImage: HOMEWORK_ATTACHMENT_IMAGE_RE.test(filename) || HOMEWORK_ATTACHMENT_IMAGE_RE.test(url),
      };
    })
    .filter(Boolean);
}

/**
 * Same-origin upload URL (native Cabinet API on генераторе, не прокси ЛК).
 * @param {string} assignmentId
 * @param {HomeworkLkRequestOpts} [opts]
 */
export function homeworkUploadAnswerUrl(assignmentId, _opts) {
  const id = encodeURIComponent(String(assignmentId).trim());
  return `/api/homework/assignment/${id}/upload-answer/`;
}

function readCsrfToken() {
  if (typeof document === "undefined") return "";
  const match = document.cookie.match(/(?:^|;\s*)csrftoken=([^;]+)/);
  return match ? decodeURIComponent(match[1]) : "";
}

/**
 * @param {string} assignmentId
 * @param {FormData} formData
 * @param {HomeworkLkRequestOpts} [opts]
 */
export async function uploadHomeworkAnswer(assignmentId, formData, opts) {
  await ensureCsrfCookie();
  const headers = { ...homeworkAuthHeaders(opts) };
  const csrf = readCsrfToken();
  if (csrf) headers["X-CSRFToken"] = csrf;

  const url = homeworkUploadAnswerUrl(assignmentId, opts);
  const res = await fetch(url, {
    method: "POST",
    body: formData,
    credentials: "include",
    headers,
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok || (Object.prototype.hasOwnProperty.call(data, "ok") && !data.ok)) {
    const err = new Error(
      (typeof data.error === "string" && data.error)
        || (typeof data.detail === "string" && data.detail)
        || `Не удалось загрузить файл (${res.status || "ошибка"})`
    );
    /** @type {any} */ (err).status = res.status;
    throw err;
  }
  return data;
}

/**
 * @param {string} assignmentId
 * @param {{ url: string, taskNumber?: number|string, taskId?: number|string }} params
 * @param {HomeworkLkRequestOpts} [opts]
 */
export async function deleteHomeworkAnswer(assignmentId, params, opts) {
  await ensureCsrfCookie();
  const headers = { ...homeworkAuthHeaders(opts) };
  const csrf = readCsrfToken();
  if (csrf) headers["X-CSRFToken"] = csrf;

  const qs = new URLSearchParams({ url: String(params.url || "").trim() });
  if (params.taskNumber != null && String(params.taskNumber).trim() !== "") {
    qs.set("task_number", String(params.taskNumber));
  }
  if (params.taskId != null && String(params.taskId).trim() !== "") {
    qs.set("task_id", String(params.taskId));
  }

  const id = encodeURIComponent(String(assignmentId).trim());
  const res = await fetch(`/api/homework/assignment/${id}/upload-answer/?${qs.toString()}`, {
    method: "DELETE",
    credentials: "include",
    headers,
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok || (Object.prototype.hasOwnProperty.call(data, "ok") && !data.ok)) {
    const err = new Error(
      (typeof data.error === "string" && data.error)
        || (typeof data.detail === "string" && data.detail)
        || `Не удалось удалить файл (${res.status || "ошибка"})`
    );
    /** @type {any} */ (err).status = res.status;
    throw err;
  }
  return data;
}

export function buildHomeworkResultPayload(tasks, userAnswers, scores, checkedTasks) {
  const byNumber = {};
  const byTaskId = {};
  const list = Array.isArray(tasks) ? tasks : [];
  const knownIds = new Set(list.map((t) => String(t.id)));

  const numberCounts = new Map();
  for (const t of list) {
    const nk = String(t.number);
    numberCounts.set(nk, (numberCounts.get(nk) || 0) + 1);
  }

  for (const t of list) {
    const id = String(t.id);
    const num = String(t.number);
    let val = userAnswers?.[id];
    if (val == null || String(val).trim() === "") {
      // Legacy-ключи-номера в userAnswers — только если номер уникален
      if (!knownIds.has(num) && (numberCounts.get(num) || 0) <= 1) {
        val = userAnswers?.[num] ?? userAnswers?.[String(Number(num))];
      }
    }
    if (val != null && String(val).trim() !== "") {
      byTaskId[id] = val;
      // При одинаковых № (тетрадь №8×N) by_number неоднозначен — не пишем.
      if ((numberCounts.get(num) || 0) <= 1) {
        byNumber[num] = val;
      }
    }
  }

  // Сохраняем прочие ключи userAnswers (на всякий случай), но не затираем id.
  if (userAnswers && typeof userAnswers === "object") {
    for (const [key, val] of Object.entries(userAnswers)) {
      if (val == null || String(val).trim() === "") continue;
      if (byTaskId[key] != null) continue;
      if (knownIds.has(String(key))) byTaskId[String(key)] = val;
    }
  }

  return {
    by_number: byNumber,
    by_task_id: byTaskId,
    scores: { ...scores },
    checked: checkedTasks ? { ...checkedTasks } : undefined,
  };
}

/**
 * Live-урок: на сервер (и учителю) уходят только ответы после «Проверить».
 * @param {Array<{id: unknown, number?: unknown}>} tasks
 * @param {Record<string, unknown>} userAnswers
 * @param {Record<string, unknown>} scores
 * @param {Record<string, boolean>} checkedTasks
 */
export function buildLiveCheckedHomeworkResult(tasks, userAnswers, scores, checkedTasks) {
  const checked = checkedTasks && typeof checkedTasks === "object" ? checkedTasks : {};
  const byNumber = {};
  const byTaskId = {};
  const outScores = {};
  const outChecked = {};
  const list = Array.isArray(tasks) ? tasks : [];
  const numberCounts = new Map();
  for (const t of list) {
    if (t?.number == null) continue;
    const nk = String(t.number);
    numberCounts.set(nk, (numberCounts.get(nk) || 0) + 1);
  }
  for (const t of list) {
    const id = t?.id;
    if (id == null) continue;
    const idKey = String(id);
    if (checked[id] === undefined && checked[idKey] === undefined) continue;
    const ok = checked[id] !== undefined ? checked[id] : checked[idKey];
    outChecked[idKey] = Boolean(ok);
    if (userAnswers?.[id] != null) byTaskId[idKey] = userAnswers[id];
    else if (userAnswers?.[idKey] != null) byTaskId[idKey] = userAnswers[idKey];
    // При одинаковых № by_number неоднозначен — пишем только уникальные.
    if (t.number != null && byTaskId[idKey] != null) {
      const numKey = String(t.number);
      if ((numberCounts.get(numKey) || 0) <= 1) {
        byNumber[numKey] = byTaskId[idKey];
      }
    }
    if (scores?.[id] != null) outScores[idKey] = scores[id];
    else if (scores?.[idKey] != null) outScores[idKey] = scores[idKey];
  }
  return {
    by_number: byNumber,
    by_task_id: byTaskId,
    scores: outScores,
    checked: outChecked,
  };
}

/**
 * @param {string} assignmentId
 * @param {{ result?: object, score?: number|null }} [body]
 * @param {HomeworkLkRequestOpts} [opts]
 */
export async function saveHomeworkDraft(assignmentId, body, opts) {
  const url = buildHomeworkApiUrl(assignmentId, "save-draft/", opts);
  if (!opts?.lessonToken) await ensureCsrfCookie();
  const headers = {
    "Content-Type": "application/json",
    ...homeworkAuthHeaders(opts),
  };
  const csrf = readCsrfToken();
  if (csrf) headers["X-CSRFToken"] = csrf;
  const res = await fetch(url, {
    method: "POST",
    credentials: "include",
    headers,
    body: JSON.stringify(body && typeof body === "object" ? body : {}),
  });
  if (!res.ok) {
    const t = await res.text().catch(() => "");
    const err = new Error(t || `HTTP ${res.status}`);
    /** @type {any} */ (err).status = res.status;
    throw err;
  }
  return res.json().catch(() => ({}));
}

/**
 * @param {string} assignmentId
 * @param {{ result?: object, score?: number|null }} [body]
 * @param {HomeworkLkRequestOpts} [opts]
 */
export async function submitHomework(assignmentId, body, opts) {
  const url = buildHomeworkApiUrl(assignmentId, "submit/", opts);
  if (!opts?.lessonToken) await ensureCsrfCookie();
  const headers = {
    "Content-Type": "application/json",
    ...homeworkAuthHeaders(opts),
  };
  const csrf = readCsrfToken();
  if (csrf) headers["X-CSRFToken"] = csrf;
  const res = await fetch(url, {
    method: "POST",
    credentials: "include",
    headers,
    body: JSON.stringify(body && typeof body === "object" ? body : {}),
  });
  if (!res.ok) {
    const t = await res.text().catch(() => "");
    const err = new Error(t || `HTTP ${res.status}`);
    /** @type {any} */ (err).status = res.status;
    throw err;
  }
  return res.json().catch(() => ({}));
}

/**
 * @param {string} assignmentId
 * @param {HomeworkLkRequestOpts} [opts]
 */
export async function fetchHomeworkAssignment(assignmentId, opts) {
  const url = buildHomeworkApiUrl(assignmentId, "", opts);
  const res = await fetch(url, {
    method: "GET",
    credentials: "include",
    headers: homeworkAuthHeaders(opts),
  });
  if (!res.ok) {
    const t = await res.text().catch(() => "");
    const err = new Error(t || `HTTP ${res.status}`);
    /** @type {any} */ (err).status = res.status;
    throw err;
  }
  return res.json();
}

/**
 * @param {string} statusNorm
 * @param {string[]} revisionTaskIds
 * @param {number} taskNumber
 * @param {boolean} isTeacherView
 */
export function homeworkTaskNumberEditable(
  statusNorm,
  revisionTaskIds,
  taskNumber,
  isTeacherView
) {
  if (isTeacherView) return false;
  if (statusNorm === "sent" || statusNorm === "unknown") return true;
  if (statusNorm === "revision") {
    if (!revisionTaskIds.length) return true;
    const n = String(taskNumber);
    return revisionTaskIds.includes(n) || revisionTaskIds.includes(String(Number(n)));
  }
  if (statusNorm === "submitted" || statusNorm === "reviewing" || statusNorm === "reviewed")
    return false;
  return false;
}

/**
 * @param {string} statusNorm
 * @param {boolean} isTeacherView
 */
export function homeworkIsReadonly(statusNorm, isTeacherView) {
  if (isTeacherView) return true;
  if (statusNorm === "submitted" || statusNorm === "reviewing" || statusNorm === "reviewed")
    return true;
  return false;
}

/**
 * Скрывать кнопку завершения в сайдбаре варианта.
 * lesson_token у ДЗ из кабинета НЕ должен скрывать «Отправить на проверку».
 * @param {{ embed?: boolean, lessonToken?: string, isHomework?: boolean, homeworkReadonly?: boolean }} opts
 */
export function shouldHideHomeworkFinishButton({
  embed = false,
  lessonToken = "",
  isHomework = false,
  homeworkReadonly = false,
} = {}) {
  if (embed) return true;
  if (lessonToken && !isHomework) return true;
  if (homeworkReadonly) return true;
  return false;
}

/**
 * Показывать блок «Сохранить черновик / Отправить на проверку» под заданиями.
 * @param {{
 *   isEmbeddedHomework?: boolean,
 *   isCabinetHomework?: boolean,
 *   homeworkStudentMode?: boolean,
 *   isLiveVariant?: boolean,
 *   isTeacherView?: boolean,
 *   homeworkReadonly?: boolean,
 *   statusNorm?: string,
 * }} opts
 */
export function shouldShowHomeworkBottomActions({
  isEmbeddedHomework = false,
  isCabinetHomework = false,
  homeworkStudentMode = false,
  isLiveVariant = false,
  isTeacherView = false,
  homeworkReadonly = false,
  statusNorm = "unknown",
} = {}) {
  if (homeworkReadonly) return false;
  if (isTeacherView) return false;
  const editable = statusNorm === "sent" || statusNorm === "revision" || statusNorm === "unknown";
  if (!editable) return false;
  if (isEmbeddedHomework) return true;
  if (isCabinetHomework && homeworkStudentMode && !isLiveVariant) return true;
  return false;
}

/**
 * @param {string} statusNorm
 */
export function homeworkIsReviewed(statusNorm) {
  return normalizeHomeworkStatus(statusNorm) === "reviewed";
}

/**
 * @param {string} statusNorm
 */
export function homeworkShowSolutions(statusNorm) {
  return statusNorm === "reviewed";
}

/**
 * Короткое сообщение для UI из ошибки fetch к API ДЗ (в т.ч. JSON DRF).
 * @param {unknown} err
 */
export function homeworkApiUserMessage(err) {
  const raw = err instanceof Error ? err.message : String(err || "");
  let detail = "";
  try {
    const j = JSON.parse(raw);
    if (typeof j?.detail === "string") detail = j.detail;
    else if (Array.isArray(j?.detail))
      detail = j.detail
        .map((x) => (typeof x === "string" ? x : JSON.stringify(x)))
        .join("; ");
  } catch {
    /* не JSON */
  }
  const text = (detail || raw).trim();
  const lower = text.toLowerCase();
  const looksLikeDrfNoCredentials =
    /authentication credentials were not provided/i.test(text) ||
    /credentials were not provided/i.test(lower);
  if (looksLikeDrfNoCredentials) {
    return "Сохранение недоступно: личный кабинет отклонил запрос (нет доверия к прокси урока). Нужна настройка приёма токена/секрета на стороне ЛК.";
  }
  if (text.length > 280) return `${text.slice(0, 277)}…`;
  return text || "Ошибка запроса";
}
