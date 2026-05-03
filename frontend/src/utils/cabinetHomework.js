/**
 * Домашнее задание из ЛК: API на origin ЛК, cookies через credentials: 'include'.
 * База URL: VITE_LK_PUBLIC_URL (приоритет) или VITE_LK_URL — тот же origin, что LK_PUBLIC_URL в Django.
 * При варианте в уроке (есть lesson_token) запросы идут same-origin — прокси на бэке генератора, без CORS.
 */

export function getLkPublicBase() {
  const u = (import.meta.env.VITE_LK_PUBLIC_URL || import.meta.env.VITE_LK_URL || "")
    .trim()
    .replace(/\/$/, "");
  return u;
}

/**
 * @typedef {{ lessonToken?: string }} HomeworkLkRequestOpts
 */

/**
 * @param {string} assignmentId
 * @param {string} [lkSubpath] пусто | "save-draft/" | "submit/"
 * @param {HomeworkLkRequestOpts} [opts]
 * @returns {string}
 */
function buildHomeworkApiUrl(assignmentId, lkSubpath, opts) {
  const id = encodeURIComponent(String(assignmentId).trim());
  const tok = (opts && opts.lessonToken) || "";
  const suffix = String(lkSubpath || "")
    .trim()
    .replace(/^\//, "");
  if (tok) {
    const path = suffix
      ? `/api/lesson/homework/assignment/${id}/${suffix}`
      : `/api/lesson/homework/assignment/${id}/`;
    return `${path}?${new URLSearchParams({ token: tok }).toString()}`;
  }
  const base = getLkPublicBase();
  if (!base) throw new Error("VITE_LK_PUBLIC_URL");
  return suffix
    ? `${base}/api/homework/assignment/${id}/${suffix}`
    : `${base}/api/homework/assignment/${id}/`;
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
  const isHomework =
    homeworkModeFlag || cabinetSession === "homework" || !!cabinetAssignment;
  return {
    cabinetAssignment,
    cabinetSession,
    isHomework,
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

export function homeworkResultToUiState(result, taskByNumber) {
  // result: произвольный JSON от ЛК
  if (result == null) return { userAnswers: {}, scores: {}, checkedTasks: {} };
  const o = typeof result === "string" ? safeJson(result) : result;
  if (!o || typeof o !== "object") return { userAnswers: {}, scores: {}, checkedTasks: {} };
  const r = /** @type {Record<string, unknown>} */ (o);
  const outUa = {};
  const outSc = {};
  const outCh = {};

  const byId = r.by_task_id || r.byTaskId || r.answers;
  const hasById = byId && typeof byId === "object" && Object.keys(byId).length > 0;

  const byNum = r.by_number || r.byNumber || r.answersByNumber;
  if (byNum && typeof byNum === "object" && !hasById) {
    for (const [num, val] of Object.entries(/** @type {Record<string, unknown>} */ (byNum))) {
      const t = taskByNumber.get(String(num)) || taskByNumber.get(String(Number(num)));
      if (t) {
        if (typeof val === "string") outUa[t.id] = val;
        else if (val && typeof val === "object" && "text" in (/** @type {object} */ (val)))
          outUa[t.id] = String(/** @type {{ text?: string }} */ (val).text ?? "");
        else if (val != null) outUa[t.id] = String(val);
      }
    }
  }
  
  if (hasById) {
    for (const [id, val] of Object.entries(/** @type {Record<string, unknown>} */ (byId))) {
      if (typeof val === "string") outUa[id] = val;
      else if (val != null) outUa[id] = String(val);
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
export function buildHomeworkResultPayload(tasks, userAnswers, scores, checkedTasks) {
  const byNumber = {};
  const byTaskId = { ...userAnswers };
  for (const t of tasks) {
    const id = String(t.id);
    const num = String(t.number);
    if (userAnswers[id] != null) byNumber[num] = userAnswers[id];
  }
  return {
    by_number: byNumber,
    by_task_id: byTaskId,
    scores: { ...scores },
    checked: checkedTasks ? { ...checkedTasks } : undefined,
  };
}

/**
 * @param {string} assignmentId
 * @param {{ result?: object, score?: number|null }} [body]
 * @param {HomeworkLkRequestOpts} [opts]
 */
export async function saveHomeworkDraft(assignmentId, body, opts) {
  const useProxy = !!(opts && opts.lessonToken);
  if (!useProxy && !getLkPublicBase()) throw new Error("VITE_LK_PUBLIC_URL");
  const url = buildHomeworkApiUrl(assignmentId, "save-draft/", opts);
  const res = await fetch(url, {
    method: "POST",
    credentials: "include",
    headers: { "Content-Type": "application/json" },
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
  const useProxy = !!(opts && opts.lessonToken);
  if (!useProxy && !getLkPublicBase()) throw new Error("VITE_LK_PUBLIC_URL");
  const url = buildHomeworkApiUrl(assignmentId, "submit/", opts);
  const res = await fetch(url, {
    method: "POST",
    credentials: "include",
    headers: { "Content-Type": "application/json" },
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
  const useProxy = !!(opts && opts.lessonToken);
  if (!useProxy && !getLkPublicBase()) throw new Error("VITE_LK_PUBLIC_URL");
  const url = buildHomeworkApiUrl(assignmentId, "", opts);
  const res = await fetch(url, { method: "GET", credentials: "include" });
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
