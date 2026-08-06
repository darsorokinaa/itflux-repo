import { getAppVersion } from "./appVersion";

function apiBase() {
  return "/api/cabinet";
}

function clientVersionHeaders() {
  const version = getAppVersion();
  return version && version !== "dev" ? { "X-Client-Version": version } : {};
}

function handleClientUpdateRequired(data) {
  if (data?.code !== "client_update_required") return;
  try {
    window.dispatchEvent(
      new CustomEvent("itflux:client-update-required", {
        detail: {
          minimumVersion: data.minimum_version || "",
          message: data.message || "Требуется обновление платформы",
        },
      }),
    );
  } catch {
    /* ignore */
  }
}

/** DRF list or plain array — always returns an array. */
export function normalizeCabinetList(data) {
  if (Array.isArray(data)) return data;
  if (Array.isArray(data?.results)) return data.results;
  return [];
}

function buildCabinetQueryPath(path, params = {}) {
  const qs = new URLSearchParams();
  Object.entries(params).forEach(([key, value]) => {
    if (value != null && value !== "") qs.set(key, value);
  });
  const query = qs.toString();
  return query ? `${path}?${query}` : path;
}

function collectApiMessages(value) {
  if (value == null) return [];
  if (typeof value === "string") return value.trim() ? [value.trim()] : [];
  if (Array.isArray(value)) {
    return value.flatMap((item) => collectApiMessages(item));
  }
  if (typeof value === "object") {
    return Object.values(value).flatMap((item) => collectApiMessages(item));
  }
  return [];
}

function formatApiError(data, fallback = "Ошибка запроса") {
  if (!data || typeof data !== "object") return fallback;
  if (typeof data.error === "string" && data.error.trim()) return data.error;
  if (typeof data.detail === "string" && data.detail.trim()) return data.detail;
  if (typeof data.message === "string" && data.message.trim()) return data.message;
  const fieldMessages = Object.entries(data)
    .filter(([key]) => !["error", "detail", "message", "code", "conflicts"].includes(key))
    .flatMap(([, value]) => collectApiMessages(value))
    .filter(Boolean);
  if (fieldMessages.length) return fieldMessages.join(" ");
  if (data.detail && typeof data.detail === "object") {
    return formatApiError(data.detail, fallback);
  }
  return fallback;
}

function getCsrfToken() {
  const match = document.cookie.match(/(?:^|;\s*)csrftoken=([^;]+)/);
  return match ? decodeURIComponent(match[1]) : "";
}

export async function ensureCsrfCookie() {
  if (getCsrfToken()) return;
  await fetch("/api/csrf/", { credentials: "same-origin", cache: "no-store" });
}

async function cabinetFetch(path, options = {}) {
  await ensureCsrfCookie();
  const headers = {
    Accept: "application/json",
    ...clientVersionHeaders(),
    ...(options.body ? { "Content-Type": "application/json" } : {}),
    ...(options.headers || {}),
  };
  const csrf = getCsrfToken();
  if (csrf) headers["X-CSRFToken"] = csrf;

  const res = await fetch(`${apiBase()}${path}`, {
    credentials: "same-origin",
    cache: "no-store",
    ...options,
    headers,
  });

  let data = null;
  try {
    data = await res.json();
  } catch {
    data = null;
  }

  if (!res.ok) {
    handleClientUpdateRequired(data);
    const message = formatApiError(data);
    const err = new Error(message);
    err.code = data?.code;
    err.conflicts = data?.conflicts;
    err.status = res.status;
    // Сохраняем полный body ответа для обработчиков лимитов
    err.data = data;
    throw err;
  }

  return data;
}

export function fetchCabinetSession() {
  return cabinetFetch("/me/", { method: "GET" });
}

export function loginCabinet(payload) {
  return cabinetFetch("/login/", {
    method: "POST",
    body: JSON.stringify(payload),
  });
}

export function registerCabinet(payload) {
  return cabinetFetch("/register/", {
    method: "POST",
    body: JSON.stringify(payload),
  });
}

export function fetchReferralPreview(code) {
  return cabinetFetch(`/referral/${encodeURIComponent(code)}/preview/`, { method: "GET" });
}

export function logoutCabinet() {
  return cabinetFetch("/logout/", { method: "POST" });
}

/** Logout and detach Web Push from this device so the next user does not get previous pushes. */
export async function logoutCabinetAndDetachPush() {
  try {
    const { unsubscribeCurrentPush } = await import("../cabinet/pwa/pwaHelpers");
    const endpoint = await Promise.race([
      unsubscribeCurrentPush(),
      new Promise((resolve) => {
        window.setTimeout(() => resolve(""), 2500);
      }),
    ]);
    if (endpoint) {
      await Promise.race([
        cabinetFetch("/push/unsubscribe/", {
          method: "POST",
          body: JSON.stringify({ endpoint }),
        }).catch(() => null),
        new Promise((resolve) => {
          window.setTimeout(() => resolve(null), 2000);
        }),
      ]);
    }
  } catch {
    /* best-effort — never block logout on push cleanup */
  }
  try {
    return await Promise.race([
      logoutCabinet(),
      new Promise((_, reject) => {
        window.setTimeout(() => reject(new Error("logout timeout")), 5000);
      }),
    ]);
  } catch (err) {
    // Session may already be gone / network flaky — caller still redirects away.
    return { ok: false, error: err?.message || "logout failed" };
  }
}

export function fetchPushVapidKey() {
  return cabinetFetch("/push/vapid-public-key/", { method: "GET" });
}

export async function fetchPushDevices() {
  let endpoint = "";
  try {
    const { getCurrentPushEndpoint } = await import("../cabinet/pwa/pwaHelpers");
    endpoint = (await getCurrentPushEndpoint()) || "";
  } catch {
    endpoint = "";
  }
  const qs = endpoint ? `?endpoint=${encodeURIComponent(endpoint)}` : "";
  return cabinetFetch(`/push/devices/${qs}`, { method: "GET" });
}

export async function sendPushTestNotification({ allDevices = false } = {}) {
  let endpoint = "";
  if (!allDevices) {
    try {
      const { getCurrentPushEndpoint } = await import("../cabinet/pwa/pwaHelpers");
      endpoint = await getCurrentPushEndpoint();
    } catch {
      endpoint = "";
    }
  }
  return cabinetFetch("/push/test/", {
    method: "POST",
    body: JSON.stringify({
      endpoint: endpoint || undefined,
      all_devices: Boolean(allDevices),
    }),
  });
}

export async function subscribeCabinetPush(deviceLabel = "") {
  const vapid = await fetchPushVapidKey();
  if (!vapid?.configured || !vapid.public_key) {
    throw new Error("Web Push не настроен на сервере");
  }
  const { subscribeWebPush } = await import("../cabinet/pwa/pwaHelpers");
  const payload = await subscribeWebPush({
    publicKey: vapid.public_key,
    deviceLabel,
  });
  return cabinetFetch("/push/subscribe/", {
    method: "POST",
    body: JSON.stringify(payload),
  });
}

/**
 * If the browser already allowed notifications but the server has no active
 * subscription for this user, re-subscribe silently (no permission prompt).
 */
export async function ensureCabinetPushSubscription() {
  try {
    const { notificationPermission } = await import("../cabinet/pwa/pwaHelpers");
    if (notificationPermission() !== "granted") return null;
    const [vapid, devices] = await Promise.all([
      fetchPushVapidKey().catch(() => null),
      fetchPushDevices().catch(() => null),
    ]);
    if (!vapid?.configured) return null;
    if ((devices?.active_count || 0) > 0) return devices;
    return await subscribeCabinetPush();
  } catch {
    return null;
  }
}

export function unsubscribeCabinetPushDevice(deviceIdOrEndpoint) {
  const body = typeof deviceIdOrEndpoint === "number" || /^\d+$/.test(String(deviceIdOrEndpoint))
    ? { device_id: Number(deviceIdOrEndpoint) }
    : { endpoint: String(deviceIdOrEndpoint || "") };
  return cabinetFetch("/push/unsubscribe/", {
    method: "POST",
    body: JSON.stringify(body),
  });
}

export function startTelemostLesson(payload = {}) {
  return cabinetFetch("/telemost/start/", {
    method: "POST",
    body: JSON.stringify(payload),
  });
}

async function videoMeetingFetch(path, options = {}) {
  await ensureCsrfCookie();
  const headers = {
    Accept: "application/json",
    ...clientVersionHeaders(),
    ...(options.body && !(options.body instanceof FormData)
      ? { "Content-Type": "application/json" }
      : {}),
    ...(options.headers || {}),
  };
  const csrf = getCsrfToken();
  if (csrf) headers["X-CSRFToken"] = csrf;

  const res = await fetch(`/api/video-meetings${path}`, {
    credentials: "same-origin",
    cache: "no-store",
    ...options,
    headers,
  });

  const contentType = res.headers.get("content-type") || "";
  let data = null;
  if (contentType.includes("application/json")) {
    try {
      data = await res.json();
    } catch {
      data = null;
    }
  } else {
    const text = await res.text().catch(() => "");
    if (!res.ok) {
      const err = new Error(`Сервер вернул неожиданный ответ: ${res.status}`);
      err.status = res.status;
      err.data = { raw: text?.slice?.(0, 200) };
      throw err;
    }
  }

  if (!res.ok) {
    handleClientUpdateRequired(data);
    const message = formatApiError(data, "Ошибка видеоконференции");
    const err = new Error(message);
    err.code = data?.code;
    err.status = res.status;
    err.data = data;
    throw err;
  }
  return data;
}

export function fetchVideoMeetingForEvent(eventId) {
  return videoMeetingFetch(`/for-event/${eventId}/`, { method: "GET" });
}

export function ensureVideoMeetingForEvent(eventId) {
  return videoMeetingFetch(`/for-event/${eventId}/`, { method: "POST", body: "{}" });
}

export function fetchVideoMeetingDetail(meetingUuid) {
  return videoMeetingFetch(`/${meetingUuid}/`, { method: "GET" });
}

export function fetchVideoMeetingStatus(meetingUuid) {
  return videoMeetingFetch(`/${meetingUuid}/status/`, { method: "GET" });
}

export function fetchVideoMeetingJoinConfig(meetingUuid) {
  return videoMeetingFetch(`/${meetingUuid}/join-config/`, { method: "POST", body: "{}" });
}

export function startVideoMeeting(meetingUuid) {
  return videoMeetingFetch(`/${meetingUuid}/start/`, { method: "POST", body: "{}" });
}

export function finishVideoMeeting(meetingUuid) {
  return videoMeetingFetch(`/${meetingUuid}/finish/`, { method: "POST", body: "{}" });
}

export function recordVideoMeetingJoin(meetingUuid, payload = {}) {
  return videoMeetingFetch(`/${meetingUuid}/attendance/join/`, {
    method: "POST",
    body: JSON.stringify(payload),
  });
}

export function recordVideoMeetingLeave(meetingUuid, payload = {}) {
  return videoMeetingFetch(`/${meetingUuid}/attendance/leave/`, {
    method: "POST",
    body: JSON.stringify(payload),
  });
}

export function fetchVideoMeetingAttendance(meetingUuid) {
  return videoMeetingFetch(`/${meetingUuid}/attendance/`, { method: "GET" });
}

/** Показать ученику доску или вариант во время урока. */
export function presentVideoMeetingResource(meetingUuid, payload) {
  return videoMeetingFetch(`/${meetingUuid}/present/`, {
    method: "POST",
    body: JSON.stringify(payload || {}),
  });
}

export function clearVideoMeetingPresented(meetingUuid) {
  return videoMeetingFetch(`/${meetingUuid}/present/`, { method: "DELETE" });
}

export function fetchVideoMeetingLiveAnswers(meetingUuid) {
  return videoMeetingFetch(`/${meetingUuid}/live-answers/`, { method: "GET" });
}

export function fetchMeetingMaterialSession(meetingUuid) {
  return videoMeetingFetch(`/${meetingUuid}/material-session/`, { method: "GET" });
}

export function openMeetingMaterialSession(meetingUuid, payload) {
  return videoMeetingFetch(`/${meetingUuid}/material-session/`, {
    method: "POST",
    body: JSON.stringify(payload || {}),
  });
}

export function closeMeetingMaterialSession(meetingUuid, payload = {}) {
  return videoMeetingFetch(`/${meetingUuid}/material-session/`, {
    method: "DELETE",
    body: JSON.stringify(payload || {}),
  });
}

export function setMeetingMaterialPermission(meetingUuid, payload) {
  return videoMeetingFetch(`/${meetingUuid}/material-session/permission/`, {
    method: "POST",
    body: JSON.stringify(payload || {}),
  });
}

export function setMeetingMaterialFollowPolicy(meetingUuid, payload) {
  return videoMeetingFetch(`/${meetingUuid}/material-session/permission/`, {
    method: "POST",
    body: JSON.stringify(payload || {}),
  });
}

export function transferMeetingMaterialControl(meetingUuid, payload) {
  return videoMeetingFetch(`/${meetingUuid}/material-session/control/`, {
    method: "POST",
    body: JSON.stringify(payload || {}),
  });
}

/** Player-payload интерактива, открытого в материале урока (доступно и ученику). */
export function fetchMeetingMaterialInteractive(meetingUuid, interactiveId) {
  return videoMeetingFetch(`/${meetingUuid}/material-session/interactive/${interactiveId}/`, {
    method: "GET",
  });
}

export function sendMeetingMaterialOperation(meetingUuid, payload) {
  return videoMeetingFetch(`/${meetingUuid}/material-session/operation/`, {
    method: "POST",
    body: JSON.stringify(payload || {}),
  });
}

export function fetchTelemostStatus() {
  return cabinetFetch("/telemost/status/", { method: "GET" });
}

export function fetchCalendarStatus() {
  return cabinetFetch("/calendar/status/", { method: "GET" });
}

export function fetchCalendarEvents({ from, to }) {
  const params = new URLSearchParams({ from, to });
  return cabinetFetch(`/calendar/events/?${params.toString()}`, { method: "GET" });
}

export function fetchScheduleEvents({ from, to }) {
  const params = new URLSearchParams({ from, to });
  return cabinetFetch(`/schedule/events/?${params.toString()}`, { method: "GET" });
}

export function createScheduleEvent(payload) {
  return cabinetFetch("/schedule/events/create/", {
    method: "POST",
    body: JSON.stringify(payload),
  });
}

export function updateScheduleEvent(eventId, payload) {
  return cabinetFetch(`/schedule/events/${encodeURIComponent(eventId)}/`, {
    method: "PATCH",
    body: JSON.stringify(payload),
  });
}

/** Создаёт/линкует пункт плана у занятия, чтобы прикреплять материалы и ДЗ. */
export function ensureScheduleEventPlanItem(eventId) {
  return cabinetFetch(`/schedule/${encodeURIComponent(eventId)}/ensure-plan-item/`, {
    method: "POST",
    body: "{}",
  });
}

export function linkScheduleEventPlanItem(eventId, lessonPlanItemId) {
  return cabinetFetch(`/schedule/${encodeURIComponent(eventId)}/link-plan-item/`, {
    method: "POST",
    body: JSON.stringify({ lesson_plan_item_id: lessonPlanItemId }),
  });
}

export function syncScheduleEventToPlan(eventId, payload = {}) {
  return cabinetFetch(`/schedule/${encodeURIComponent(eventId)}/sync-to-plan/`, {
    method: "POST",
    body: JSON.stringify(payload),
  });
}

export function syncScheduleEventFromPlan(eventId) {
  return cabinetFetch(`/schedule/${encodeURIComponent(eventId)}/sync-from-plan/`, {
    method: "POST",
    body: "{}",
  });
}

export function setScheduleEventPlanSync(eventId, enabled) {
  return cabinetFetch(`/schedule/${encodeURIComponent(eventId)}/plan-sync/`, {
    method: "POST",
    body: JSON.stringify({ plan_sync_enabled: Boolean(enabled) }),
  });
}

export function updateScheduleEventContent(eventId, payload = {}) {
  return cabinetFetch(`/schedule/${encodeURIComponent(eventId)}/content/`, {
    method: "POST",
    body: JSON.stringify(payload),
  });
}

export function updateScheduleEventMaterials(eventId, payload = {}) {
  return cabinetFetch(`/schedule/${encodeURIComponent(eventId)}/event-materials/`, {
    method: "POST",
    body: JSON.stringify(payload),
  });
}

export function deleteScheduleEvent(eventId, { scope, notifyParticipants = true } = {}) {
  if (scope) {
    return updateScheduleEvent(eventId, {
      status: "cancelled",
      scope,
      notify_participants: notifyParticipants,
    });
  }
  return cabinetFetch(`/schedule/events/${encodeURIComponent(eventId)}/delete/`, {
    method: "DELETE",
    body: JSON.stringify({ notify_participants: notifyParticipants }),
  });
}

export function fetchNotifications({ student = false } = {}) {
  const path = student ? "/student/notifications/" : "/notifications/";
  return cabinetFetch(path, { method: "GET" });
}

export function markNotificationRead(id, { student = false } = {}) {
  const path = student
    ? `/student/notifications/${id}/read/`
    : `/notifications/${id}/read/`;
  return cabinetFetch(path, { method: "POST", body: "{}" });
}

export function markAllNotificationsRead({ student = false } = {}) {
  const path = student ? "/student/notifications/read-all/" : "/notifications/read-all/";
  return cabinetFetch(path, { method: "POST", body: "{}" });
}

export function clearNotifications({ student = false } = {}) {
  const path = student ? "/student/notifications/clear/" : "/notifications/clear/";
  return cabinetFetch(path, { method: "POST", body: "{}" });
}

export function checkScheduleConflicts(payload) {
  return cabinetFetch("/schedule/check-conflicts/", {
    method: "POST",
    body: JSON.stringify(payload),
  });
}

// --- Students & Groups ---

export function fetchInvitationPreview(token) {
  return cabinetFetch(`/invitations/join/${encodeURIComponent(token)}/`, { method: "GET" });
}

export function acceptInvitation(token) {
  return cabinetFetch(`/invitations/join/${encodeURIComponent(token)}/accept/`, {
    method: "POST",
    body: "{}",
  });
}

export function fetchInvitations(params = {}) {
  return cabinetFetch(buildCabinetQueryPath("/invitations/", params), { method: "GET" });
}

export function createInvitation(payload) {
  return cabinetFetch("/invitations/", {
    method: "POST",
    body: JSON.stringify(payload),
  });
}

export function cancelInvitation(id) {
  return cabinetFetch(`/invitations/${id}/cancel/`, {
    method: "POST",
    body: "{}",
  });
}

/** Hard-delete an invitation (any status). Removes unregistered pre-profile student too. */
export function deleteInvitation(id) {
  return cabinetFetch(`/invitations/${id}/`, { method: "DELETE" });
}

export function buildInvitationUrl(joinPath) {
  if (!joinPath) return "";
  if (joinPath.startsWith("http")) return joinPath;
  return `${window.location.origin}${joinPath}`;
}

export function fetchTelegramStatus() {
  return cabinetFetch("/telegram/status/", { method: "GET" });
}

/** Создаёт одноразовую deep-link; фронт сразу открывает её, не показывая токен. */
export function createTelegramConnectLink() {
  return cabinetFetch("/telegram/connect-link/", {
    method: "POST",
    body: "{}",
  });
}

export function disconnectTelegram() {
  return cabinetFetch("/telegram/disconnect/", {
    method: "POST",
    body: "{}",
  });
}

export function sendTelegramTestNotification() {
  return cabinetFetch("/telegram/test/", {
    method: "POST",
    body: "{}",
  });
}

export function fetchNotificationPreferences() {
  return cabinetFetch("/settings/notifications/", { method: "GET" });
}

export function updateNotificationPreferences(payload) {
  return cabinetFetch("/settings/notifications/", {
    method: "PATCH",
    body: JSON.stringify(payload),
  });
}

export async function openTelegramConnect() {
  const data = await createTelegramConnectLink();
  const deepLink = data?.deep_link;
  if (!deepLink) {
    throw new Error("Не удалось создать ссылку для Telegram");
  }
  window.open(deepLink, "_blank", "noopener,noreferrer");
  return data;
}

export function fetchStudents(params = {}) {
  return cabinetFetch(buildCabinetQueryPath("/students/", params), { method: "GET" });
}

export function createStudent(payload) {
  return cabinetFetch("/students/", {
    method: "POST",
    body: JSON.stringify(payload),
  });
}

export function updateStudent(id, payload) {
  return cabinetFetch(`/students/${id}/`, {
    method: "PATCH",
    body: JSON.stringify(payload),
  });
}

export function archiveStudent(id) {
  return cabinetFetch(`/students/${id}/archive/`, { method: "PATCH" });
}

export function restoreStudent(id) {
  return cabinetFetch(`/students/${id}/restore/`, { method: "PATCH" });
}

export function fetchStudentNotifySettings(studentId) {
  return cabinetFetch(`/students/${studentId}/notify-settings/`);
}

export function updateStudentNotifySettings(studentId, payload) {
  return cabinetFetch(`/students/${studentId}/notify-settings/`, {
    method: "PATCH",
    body: JSON.stringify(payload || {}),
  });
}

/** Безвозвратное удаление ученика. */
export function deleteStudent(id) {
  return cabinetFetch(`/students/${id}/`, { method: "DELETE" });
}

export function fetchStudentSubjects(studentId, params = {}) {
  return cabinetFetch(
    buildCabinetQueryPath(`/students/${studentId}/subjects/`, params),
    { method: "GET" },
  );
}

export function createStudentSubject(studentId, payload) {
  return cabinetFetch(`/students/${studentId}/subjects/`, {
    method: "POST",
    body: JSON.stringify(payload),
  });
}

export function updateStudentSubject(studentId, subjectId, payload) {
  return cabinetFetch(`/students/${studentId}/subjects/${subjectId}/`, {
    method: "PATCH",
    body: JSON.stringify(payload),
  });
}

export function deleteStudentSubject(studentId, subjectId, { force = false } = {}) {
  const qs = force ? "?force=1" : "";
  return cabinetFetch(`/students/${studentId}/subjects/${subjectId}/${qs}`, {
    method: "DELETE",
  });
}

export function fetchOwnStudentSubjects() {
  return cabinetFetch("/student/subjects/", { method: "GET" });
}

export function notifyBillingChanged(detail = {}) {
  if (typeof window === "undefined") return;
  window.dispatchEvent(new CustomEvent("cabinet:billing-changed", { detail }));
}

export function fetchStudentHomeworkOptions(
  studentId,
  { scheduleEventId, studentSubjectId } = {},
) {
  const params = new URLSearchParams();
  if (scheduleEventId) params.set("schedule_event_id", String(scheduleEventId));
  if (studentSubjectId) params.set("student_subject_id", String(studentSubjectId));
  const qs = params.toString();
  return cabinetFetch(
    `/students/${studentId}/homework-options/${qs ? `?${qs}` : ""}`,
    { method: "GET" },
  );
}

export function assignStudentHomework(studentId, payload) {
  return cabinetFetch(`/students/${studentId}/assign-homework/`, {
    method: "POST",
    body: JSON.stringify(payload),
  });
}

export function checkVariantTasksOverlap(studentId, variantId) {
  return cabinetFetch(`/students/${studentId}/check-variant-tasks/?variant_id=${encodeURIComponent(variantId)}`, {
    method: "GET",
  });
}

export function fetchGroups(params = {}) {
  return cabinetFetch(buildCabinetQueryPath("/groups/", params), { method: "GET" });
}

export function fetchGroup(id) {
  return cabinetFetch(`/groups/${id}/`, { method: "GET" });
}

export function createGroup(payload) {
  return cabinetFetch("/groups/", {
    method: "POST",
    body: JSON.stringify(payload),
  });
}

export function updateGroup(id, payload) {
  return cabinetFetch(`/groups/${id}/`, {
    method: "PATCH",
    body: JSON.stringify(payload),
  });
}

export function addStudentToGroup(groupId, studentId) {
  return cabinetFetch(`/groups/${groupId}/add-student/`, {
    method: "POST",
    body: JSON.stringify({ student_id: studentId }),
  });
}

export function removeStudentFromGroup(groupId, studentId) {
  return cabinetFetch(`/groups/${groupId}/remove-student/`, {
    method: "POST",
    body: JSON.stringify({ student_id: studentId }),
  });
}

// --- Dashboard ---

export function fetchDashboard() {
  return cabinetFetch("/dashboard/", { method: "GET" });
}

export function fetchNavCounts() {
  return cabinetFetch("/nav-counts/", { method: "GET" });
}

// --- Lessons ---

export function fetchLessons(params = {}) {
  const qs = new URLSearchParams();
  Object.entries(params).forEach(([key, value]) => {
    if (value != null && value !== "") qs.set(key, value);
  });
  const suffix = qs.toString() ? `?${qs.toString()}` : "";
  return cabinetFetch(`/lessons/${suffix}`, { method: "GET" });
}

// --- Review ---

export function fetchReviewItems(params = {}) {
  const qs = new URLSearchParams();
  Object.entries(params).forEach(([key, value]) => {
    if (value != null && value !== "") qs.set(key, value);
  });
  const suffix = qs.toString() ? `?${qs.toString()}` : "";
  return cabinetFetch(`/review/${suffix}`, { method: "GET" });
}

export function fetchReviewItem(reviewId) {
  return cabinetFetch(`/review/${encodeURIComponent(String(reviewId))}/`, { method: "GET" });
}

export function checkReviewItem(reviewId, body = {}) {
  return cabinetFetch(`/review/${encodeURIComponent(String(reviewId))}/check/`, {
    method: "POST",
    body: JSON.stringify(body && typeof body === "object" ? body : {}),
  });
}

export function returnReviewItem(reviewId, body = {}) {
  return cabinetFetch(`/review/${encodeURIComponent(String(reviewId))}/return/`, {
    method: "POST",
    body: JSON.stringify(body && typeof body === "object" ? body : {}),
  });
}

export function fetchReviewHomeworkPreview(reviewId) {
  return cabinetFetch(
    `/review/${encodeURIComponent(String(reviewId))}/create-homework-preview/`,
    { method: "GET" },
  );
}

export function createHomeworkFromReview(reviewId, payload = {}) {
  const body = payload && typeof payload === "object" ? payload : {};
  return cabinetFetch(
    `/review/${encodeURIComponent(String(reviewId))}/create-homework/`,
    {
      method: "POST",
      body: JSON.stringify(body),
      headers: body.idempotency_key
        ? { "X-Idempotency-Key": body.idempotency_key }
        : undefined,
    },
  );
}

async function cabinetFetchMultipart(path, formData, { method = "POST" } = {}) {
  await ensureCsrfCookie();
  const headers = { Accept: "application/json", ...clientVersionHeaders() };
  const csrf = getCsrfToken();
  if (csrf) headers["X-CSRFToken"] = csrf;

  const res = await fetch(`${apiBase()}${path}`, {
    method,
    body: formData,
    credentials: "same-origin",
    cache: "no-store",
    headers,
  });

  let data = null;
  try {
    data = await res.json();
  } catch {
    data = null;
  }

  if (!res.ok || (Object.prototype.hasOwnProperty.call(data || {}, "ok") && !data.ok)) {
    handleClientUpdateRequired(data);
    const message = formatApiError(data, "Не удалось загрузить файл");
    const err = new Error(message);
    err.status = res.status;
    err.data = data;
    throw err;
  }
  return data;
}

export function uploadReviewFeedback(reviewId, formData) {
  return cabinetFetchMultipart(
    `/review/${encodeURIComponent(String(reviewId))}/upload-feedback/`,
    formData
  );
}

export function deleteReviewFeedback(reviewId, params) {
  const qs = new URLSearchParams({ url: String(params.url || "").trim() });
  if (params.taskNumber != null && String(params.taskNumber).trim() !== "") {
    qs.set("task_number", String(params.taskNumber));
  }
  if (params.taskId != null && String(params.taskId).trim() !== "") {
    qs.set("task_id", String(params.taskId));
  }
  return cabinetFetch(
    `/review/${encodeURIComponent(String(reviewId))}/upload-feedback/?${qs.toString()}`,
    { method: "DELETE" }
  );
}

// --- Lesson Plans ---

export function fetchLessonPlans(params = {}) {
  const qs = new URLSearchParams();
  Object.entries(params).forEach(([key, value]) => {
    if (value != null && value !== "") qs.set(key, value);
  });
  const suffix = qs.toString() ? `?${qs.toString()}` : "";
  return cabinetFetch(`/lesson-plans/${suffix}`, { method: "GET" });
}

export function fetchLessonPlan(id) {
  return cabinetFetch(`/lesson-plans/${id}/`, { method: "GET" });
}

export function fetchLessonPlanSubjects() {
  return cabinetFetch("/lesson-plans/subjects/", { method: "GET" });
}

export function fetchLessonPlanLevels() {
  return cabinetFetch("/lesson-plans/levels/", { method: "GET" });
}

export function createLessonPlan(payload) {
  return cabinetFetch("/lesson-plans/", {
    method: "POST",
    body: JSON.stringify(payload),
  });
}

export function updateLessonPlan(id, payload) {
  return cabinetFetch(`/lesson-plans/${id}/`, {
    method: "PATCH",
    body: JSON.stringify(payload),
  });
}

export function deleteLessonPlan(id) {
  return cabinetFetch(`/lesson-plans/${id}/`, { method: "DELETE" });
}

export function deleteHomework(homeworkId) {
  return cabinetFetch(`/homework/${encodeURIComponent(String(homeworkId))}/`, { method: "DELETE" });
}

/** Данные выданного ДЗ для формы редактирования. */
export function fetchHomeworkForEdit(homeworkId) {
  return cabinetFetch(`/homework/${encodeURIComponent(String(homeworkId))}/`, { method: "GET" });
}

/** Сохранить правки выданного ДЗ. */
export function updateHomework(homeworkId, payload = {}) {
  return cabinetFetch(`/homework/${encodeURIComponent(String(homeworkId))}/`, {
    method: "PATCH",
    body: JSON.stringify(payload && typeof payload === "object" ? payload : {}),
  });
}

/** Добавить задание в уже выданное ДЗ (ученик получает оповещение). */
export function addHomeworkTasks(homeworkId, payload = {}) {
  return cabinetFetch(`/homework/${encodeURIComponent(String(homeworkId))}/tasks/`, {
    method: "POST",
    body: JSON.stringify(payload && typeof payload === "object" ? payload : {}),
  });
}

/** Скопировать ДЗ и назначить другим ученикам / группе. */
export function copyHomework(homeworkId, payload = {}) {
  return cabinetFetch(`/homework/${encodeURIComponent(String(homeworkId))}/copy/`, {
    method: "POST",
    body: JSON.stringify(payload && typeof payload === "object" ? payload : {}),
  });
}

export function copyLessonPlan(id) {
  return cabinetFetch(`/lesson-plans/${id}/copy/`, { method: "POST" });
}

export function addLessonPlanItem(planId, payload) {
  return cabinetFetch(`/lesson-plans/${planId}/items/`, {
    method: "POST",
    body: JSON.stringify(payload),
  });
}

export function fetchLessonPlanItems(params = {}) {
  const qs = new URLSearchParams();
  Object.entries(params).forEach(([key, value]) => {
    if (value != null && value !== "") qs.set(key, value);
  });
  const suffix = qs.toString() ? `?${qs.toString()}` : "";
  return cabinetFetch(`/lesson-plan-items/${suffix}`, { method: "GET" });
}

export function fetchLessonPlanItem(id) {
  return cabinetFetch(`/lesson-plan-items/${id}/`, { method: "GET" });
}

export function updateLessonPlanItem(id, payload) {
  return cabinetFetch(`/lesson-plan-items/${id}/`, {
    method: "PATCH",
    body: JSON.stringify(payload),
  });
}

export function deleteLessonPlanItem(id) {
  return cabinetFetch(`/lesson-plan-items/${id}/`, { method: "DELETE" });
}

export function reorderLessonPlanItems(items) {
  return cabinetFetch("/lesson-plan-items/reorder/", {
    method: "POST",
    body: JSON.stringify({ items }),
  });
}

export function fetchPlanEnrollments(params = {}) {
  const qs = new URLSearchParams();
  Object.entries(params).forEach(([key, value]) => {
    if (value != null && value !== "") qs.set(key, value);
  });
  const suffix = qs.toString() ? `?${qs.toString()}` : "";
  return cabinetFetch(`/lesson-plan-enrollments/${suffix}`, { method: "GET" });
}

export function createPlanEnrollment(payload) {
  return cabinetFetch("/lesson-plan-enrollments/", {
    method: "POST",
    body: JSON.stringify(payload),
  });
}

export function enrollLessonPlan(planId, payload) {
  return cabinetFetch(`/lesson-plans/${planId}/enroll/`, {
    method: "POST",
    body: JSON.stringify(payload),
  });
}

export function updatePlanEnrollment(id, payload) {
  return cabinetFetch(`/lesson-plan-enrollments/${id}/`, {
    method: "PATCH",
    body: JSON.stringify(payload),
  });
}

export function deletePlanEnrollment(id) {
  return cabinetFetch(`/lesson-plan-enrollments/${id}/`, { method: "DELETE" });
}

// --- Interactives ---

export function fetchInteractives(params = {}) {
  const qs = new URLSearchParams();
  Object.entries(params).forEach(([key, value]) => {
    if (value != null && value !== "") qs.set(key, value);
  });
  const suffix = qs.toString() ? `?${qs.toString()}` : "";
  return cabinetFetch(`/interactives/${suffix}`, { method: "GET" });
}

export function fetchInteractive(id) {
  return cabinetFetch(`/interactives/${id}/`, { method: "GET" });
}

export function createInteractive(payload) {
  return cabinetFetch("/interactives/", {
    method: "POST",
    body: JSON.stringify(payload),
  });
}

export function updateInteractive(id, payload) {
  return cabinetFetch(`/interactives/${id}/`, {
    method: "PATCH",
    body: JSON.stringify(payload),
  });
}

export function deleteInteractiveApi(id) {
  return cabinetFetch(`/interactives/${id}/`, { method: "DELETE" });
}

export function publishInteractive(id) {
  return cabinetFetch(`/interactives/${id}/publish/`, { method: "POST" });
}

export function assignInteractive(interactiveId, payload) {
  return cabinetFetch(`/interactives/${interactiveId}/assign/`, {
    method: "POST",
    body: JSON.stringify(payload),
  });
}

export function uploadInteractiveImage(formData) {
  return cabinetFetchMultipart("/interactives/upload-image/", formData);
}

export function fetchInteractiveAppearance() {
  return cabinetFetch("/interactive-appearance/", { method: "GET" });
}

// --- Interactive boards (Excalidraw) ---

export function fetchInteractiveBoards(params = {}) {
  return cabinetFetch(buildCabinetQueryPath("/interactive-boards/", params), { method: "GET" });
}

export function fetchInteractiveBoard(id) {
  return cabinetFetch(`/interactive-boards/${id}/`, { method: "GET" });
}

export function createInteractiveBoard(payload) {
  return cabinetFetch("/interactive-boards/", {
    method: "POST",
    body: JSON.stringify(payload),
  });
}

export function updateInteractiveBoard(id, payload) {
  return cabinetFetch(`/interactive-boards/${id}/`, {
    method: "PATCH",
    body: JSON.stringify(payload),
  });
}

export function deleteInteractiveBoard(id) {
  return cabinetFetch(`/interactive-boards/${id}/`, { method: "DELETE" });
}

export function duplicateInteractiveBoard(id, payload = {}) {
  return cabinetFetch(`/interactive-boards/${id}/duplicate/`, {
    method: "POST",
    body: JSON.stringify(payload),
  });
}

export function clearInteractiveBoard(id, payload = {}) {
  return cabinetFetch(`/interactive-boards/${id}/clear/`, {
    method: "POST",
    body: JSON.stringify(payload),
  });
}

export function updateInteractiveBoardAccess(id, payload) {
  return cabinetFetch(`/interactive-boards/${id}/access/`, {
    method: "PUT",
    body: JSON.stringify(payload),
  });
}

export function fetchInteractiveBoardAccess(id) {
  return cabinetFetch(`/interactive-boards/${id}/access/`, { method: "GET" });
}

export function uploadInteractiveBoardImage(id, formData) {
  return cabinetFetchMultipart(`/interactive-boards/${id}/upload-image/`, formData);
}

export function fetchStudentInteractiveBoards() {
  return cabinetFetch("/student/interactive-boards/", { method: "GET" });
}

// --- Materials ---

export function fetchMaterials(params = {}) {
  const qs = new URLSearchParams();
  Object.entries(params).forEach(([key, value]) => {
    if (value != null && value !== "") qs.set(key, value);
  });
  const suffix = qs.toString() ? `?${qs.toString()}` : "";
  return cabinetFetch(`/materials/${suffix}`, { method: "GET" });
}

export async function createTeacherMaterial(payload) {
  await ensureCsrfCookie();
  const isFormData = typeof FormData !== "undefined" && payload instanceof FormData;
  const headers = { Accept: "application/json", ...clientVersionHeaders() };
  const csrf = getCsrfToken();
  if (csrf) headers["X-CSRFToken"] = csrf;
  if (!isFormData) headers["Content-Type"] = "application/json";

  const res = await fetch(`${apiBase()}/materials/`, {
    method: "POST",
    credentials: "same-origin",
    cache: "no-store",
    headers,
    body: isFormData ? payload : JSON.stringify(payload),
  });

  let data = null;
  try {
    data = await res.json();
  } catch {
    data = null;
  }
  if (!res.ok) {
    handleClientUpdateRequired(data);
    const message = formatApiError(data);
    const err = new Error(message);
    err.status = res.status;
    err.data = data;
    throw err;
  }
  return data;
}

// --- Reports ---

export function fetchReportsOverview() {
  return cabinetFetch("/reports/overview/", { method: "GET" });
}

// --- Subscription ---

export function fetchSubscriptionUsage() {
  return cabinetFetch("/subscription/usage/", { method: "GET" });
}

export function fetchSubscriptionCurrent() {
  return cabinetFetch("/subscription/current/", { method: "GET" });
}

export function fetchSubscriptionPlans() {
  return cabinetFetch("/subscription/plans/", { method: "GET" });
}

export function fetchPublicPricingPlans() {
  return fetch("/api/cabinet/pricing/plans/", { credentials: "same-origin" }).then(async (res) => {
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      const err = new Error(data.detail || "Failed to load pricing");
      err.data = data;
      throw err;
    }
    return data;
  });
}

export function trackWorkbookUsage() {
  return cabinetFetch("/usage/workbook/", { method: "POST", body: "{}" });
}

export function fetchLibraryNewThisMonth() {
  return cabinetFetch("/library/new-this-month/", { method: "GET" });
}

export function changePlan(planSlug, billingPeriod = "month") {
  return cabinetFetch("/subscription/change-plan/", {
    method: "POST",
    body: JSON.stringify({ plan_slug: planSlug, billing_period: billingPeriod }),
  });
}

export function createPayment(planSlug, billingPeriod = "month", promoCode = null) {
  return cabinetFetch("/subscription/create-payment/", {
    method: "POST",
    body: JSON.stringify({ plan_slug: planSlug, billing_period: billingPeriod, promo_code: promoCode || undefined }),
  });
}

export function fetchSubscriptionPayment(paymentId, { sync = false } = {}) {
  const q = sync ? "?sync=1" : "";
  return cabinetFetch(`/subscription/payments/${paymentId}/${q}`);
}

/** Сверить статус с банком (GetState) и активировать тариф при успехе */
export function syncSubscriptionPayment(paymentId) {
  return cabinetFetch(`/subscription/payments/${paymentId}/`, {
    method: "POST",
    body: JSON.stringify({ action: "sync" }),
  });
}

/** Только локальный DEBUG + provider=mock */
export function confirmMockSubscriptionPayment(paymentId) {
  return cabinetFetch(`/subscription/payments/${paymentId}/`, {
    method: "POST",
    body: JSON.stringify({ action: "confirm_mock" }),
  });
}

export function validatePromoCode(code, planSlug = null, billingPeriod = "month") {
  return cabinetFetch("/subscription/apply-promo/", {
    method: "POST",
    body: JSON.stringify({
      code,
      plan_slug: planSlug || undefined,
      billing_period: billingPeriod || "month",
    }),
  });
}

export function createReferralLink() {
  return cabinetFetch("/subscription/referral-link/", {
    method: "POST",
    body: "{}",
  });
}

export function manageSubscription(action, extra = {}) {
  return cabinetFetch("/subscription/manage/", {
    method: "POST",
    body: JSON.stringify({ action, ...extra }),
  });
}

// --- AI ---

export function fetchAIUsage() {
  return cabinetFetch("/ai/usage/", { method: "GET" });
}

export function sendAIRequest(prompt, requestType = "explain") {
  return cabinetFetch("/ai/request/", {
    method: "POST",
    body: JSON.stringify({ prompt, request_type: requestType }),
  });
}

// --- Role routing ---

export function getCabinetHomePath(user) {
  const role = user?.role;
  if (role === "teacher") return "/cabinet";
  if (role === "student") return "/cabinet/student";
  if (role === "parent") return "/cabinet/parent";
  return "/cabinet";
}

export function isTeacherRole(user) {
  return user?.role === "teacher";
}

export function isStudentRole(user) {
  return user?.role === "student";
}

export function isParentRole(user) {
  return user?.role === "parent";
}

/* ── Родительский кабинет и приглашения ───────────────────────────── */

export function fetchStudentParentsAccess(studentId) {
  return cabinetFetch(`/students/${studentId}/parents/`, { method: "GET" });
}

export function createStudentParentInvite(studentId, payload) {
  return cabinetFetch(`/students/${studentId}/parents/invite/`, {
    method: "POST",
    body: JSON.stringify(payload),
  });
}

export function revokeStudentParentInvite(studentId, invitationId) {
  return cabinetFetch(`/students/${studentId}/parents/invitations/${invitationId}/revoke/`, {
    method: "POST",
    body: JSON.stringify({}),
  });
}

export function updateStudentParentAccess(studentId, relationshipId, payload) {
  return cabinetFetch(`/students/${studentId}/parents/relationships/${relationshipId}/`, {
    method: "PATCH",
    body: JSON.stringify(payload),
  });
}

export function fetchParentInvitePreview(token) {
  return cabinetFetch(`/parent/invite/${encodeURIComponent(token)}/`, { method: "GET" });
}

export function acceptParentInvite(token) {
  return cabinetFetch(`/parent/invite/${encodeURIComponent(token)}/accept/`, {
    method: "POST",
    body: JSON.stringify({}),
  });
}

export function fetchParentDashboard(params = {}) {
  return cabinetFetch(buildCabinetQueryPath("/parent/dashboard/", params), { method: "GET" });
}

export function fetchParentChildren() {
  return cabinetFetch("/parent/children/", { method: "GET" });
}

export function fetchParentHomework(params = {}) {
  return cabinetFetch(buildCabinetQueryPath("/parent/homework/", params), { method: "GET" });
}

export function fetchParentJournal(params = {}) {
  return cabinetFetch(buildCabinetQueryPath("/parent/journal/", params), { method: "GET" });
}

export function fetchParentSchedule(params = {}) {
  return cabinetFetch(buildCabinetQueryPath("/parent/schedule/", params), { method: "GET" });
}

export function fetchParentBilling(params = {}) {
  return cabinetFetch(buildCabinetQueryPath("/parent/billing/", params), { method: "GET" });
}

export function claimParentPayment(payload) {
  return cabinetFetch("/parent/billing/claim/", {
    method: "POST",
    body: JSON.stringify(payload),
  });
}

export function fetchJournalEntries(params = {}) {
  return cabinetFetch(buildCabinetQueryPath("/journal/entries/", params), { method: "GET" });
}

// --- Student cabinet ---

export function fetchStudentDashboard() {
  return cabinetFetch("/student/dashboard/", { method: "GET" });
}

export function fetchStudentLessons() {
  return cabinetFetch("/student/lessons/", { method: "GET" });
}

export function fetchStudentLesson(assignmentId) {
  return cabinetFetch(`/student/lessons/${assignmentId}/`, { method: "GET" });
}

export function completeStudentLesson(assignmentId) {
  return cabinetFetch(`/student/lessons/${assignmentId}/`, { method: "POST", body: "{}" });
}

export function fetchStudentAssignments({ studentSubjectId } = {}) {
  const params = new URLSearchParams();
  if (studentSubjectId) params.set("student_subject", String(studentSubjectId));
  const qs = params.toString();
  return cabinetFetch(`/student/assignments/${qs ? `?${qs}` : ""}`, { method: "GET" });
}

export function fetchStudentAssignment(homeworkId) {
  return cabinetFetch(`/student/assignments/${homeworkId}/`, { method: "GET" });
}

export function submitStudentAssignment(homeworkId, payload) {
  if (typeof FormData !== "undefined" && payload instanceof FormData) {
    return cabinetFetchMultipart(`/student/assignments/${homeworkId}/`, payload);
  }
  return cabinetFetch(`/student/assignments/${homeworkId}/`, {
    method: "POST",
    body: JSON.stringify(payload),
  });
}

export function fetchStudentInteractives() {
  return cabinetFetch("/student/interactives/", { method: "GET" });
}

export function fetchStudentInteractive(assignmentId) {
  return cabinetFetch(`/student/interactives/${assignmentId}/`, { method: "GET" });
}

export function submitStudentInteractiveAttempt(assignmentId, payload) {
  return cabinetFetch(`/student/interactives/${assignmentId}/`, {
    method: "POST",
    body: JSON.stringify(payload),
  });
}

export function fetchStudentSchedule({ studentSubjectId } = {}) {
  const params = new URLSearchParams();
  if (studentSubjectId) params.set("student_subject", String(studentSubjectId));
  const qs = params.toString();
  return cabinetFetch(`/student/schedule/${qs ? `?${qs}` : ""}`, { method: "GET" });
}

export function fetchStudentScheduleEvent(eventId) {
  return cabinetFetch(`/student/schedule/${eventId}/`, { method: "GET" });
}

export function fetchStudentProgress() {
  return cabinetFetch("/student/progress/", { method: "GET" });
}

export function fetchStudentMaterials(query = "", { studentSubjectId } = {}) {
  const params = new URLSearchParams();
  if (query) params.set("q", query);
  if (studentSubjectId) params.set("student_subject", String(studentSubjectId));
  const qs = params.toString();
  return cabinetFetch(`/student/materials/${qs ? `?${qs}` : ""}`, { method: "GET" });
}

export function fetchDirectMaterials() {
  return cabinetFetch("/direct-materials/", { method: "GET" });
}

export function assignMaterialDirect(payload) {
  return cabinetFetch("/direct-materials/", {
    method: "POST",
    body: JSON.stringify(payload),
  });
}

export function deleteDirectMaterial(id) {
  return cabinetFetch(`/direct-materials/${id}/`, { method: "DELETE" });
}

export function fetchStudentProfile() {
  return cabinetFetch("/student/profile/", { method: "GET" });
}

export function updateStudentProfile(payload) {
  return cabinetFetch("/student/profile/", {
    method: "PATCH",
    body: JSON.stringify(payload),
  });
}

export function uploadProfileAvatar(file) {
  const formData = new FormData();
  formData.append("avatar", file);
  return cabinetFetchMultipart("/profile/avatar/", formData);
}

export function deleteProfileAvatar() {
  return cabinetFetch("/profile/avatar/", { method: "DELETE" });
}

/* ── Учёт оплат репетитора ─────────────────────────────────────────── */

export function fetchBillingDashboard(params = {}) {
  return cabinetFetch(buildCabinetQueryPath("/billing/dashboard/", params), { method: "GET" });
}

export function fetchBillingDashboardDetail(detail, params = {}) {
  return fetchBillingDashboard({ ...params, detail });
}

export function fetchBillingSettings() {
  return cabinetFetch("/billing/settings/", { method: "GET" });
}

export function updateBillingSettings(payload) {
  return cabinetFetch("/billing/settings/", {
    method: "PATCH",
    body: JSON.stringify(payload),
  });
}

export function fetchBillingAccounts(params = {}) {
  return cabinetFetch(buildCabinetQueryPath("/billing/accounts/", params), { method: "GET" });
}

export function fetchBillingAccount(accountId) {
  return cabinetFetch(`/billing/accounts/${accountId}/`, { method: "GET" });
}

export function fetchStudentBillingAccount(studentId) {
  return cabinetFetch(`/billing/students/${studentId}/account/`, { method: "GET" });
}

export function updateBillingAccountSettings(accountId, payload) {
  return cabinetFetch(`/billing/accounts/${accountId}/settings/`, {
    method: "PATCH",
    body: JSON.stringify(payload),
  });
}

export function fetchBillingTransactions(params = {}) {
  return cabinetFetch(buildCabinetQueryPath("/billing/transactions/", params), { method: "GET" });
}

export function createBillingPayment(payload) {
  return cabinetFetch("/billing/payments/", {
    method: "POST",
    body: JSON.stringify(payload),
  });
}

export function createBillingRefund(payload) {
  return cabinetFetch("/billing/refunds/", {
    method: "POST",
    body: JSON.stringify(payload),
  });
}

export function createBillingAdjustment(payload) {
  return cabinetFetch("/billing/adjustments/", {
    method: "POST",
    body: JSON.stringify(payload),
  });
}

export function reverseBillingTransaction(txId, payload = {}) {
  return cabinetFetch(`/billing/transactions/${txId}/reverse/`, {
    method: "POST",
    body: JSON.stringify(payload),
  });
}

export function fetchBillingPackages(params = {}) {
  return cabinetFetch(buildCabinetQueryPath("/billing/packages/", params), { method: "GET" });
}

export function createBillingPackage(payload) {
  return cabinetFetch("/billing/packages/", {
    method: "POST",
    body: JSON.stringify(payload),
  });
}

export function patchBillingPackage(packageId, payload) {
  return cabinetFetch(`/billing/packages/${packageId}/`, {
    method: "PATCH",
    body: JSON.stringify(payload),
  });
}

export function deleteBillingPackage(packageId) {
  return cabinetFetch(`/billing/packages/${packageId}/`, {
    method: "DELETE",
  });
}

export function freezeBillingPackage(packageId) {
  return cabinetFetch(`/billing/packages/${packageId}/freeze/`, {
    method: "POST",
    body: "{}",
  });
}

export function unfreezeBillingPackage(packageId) {
  return cabinetFetch(`/billing/packages/${packageId}/unfreeze/`, {
    method: "POST",
    body: "{}",
  });
}

export function extendBillingPackage(packageId, payload) {
  return cabinetFetch(`/billing/packages/${packageId}/extend/`, {
    method: "POST",
    body: JSON.stringify(payload),
  });
}

export function adjustBillingPackage(packageId, payload) {
  return cabinetFetch(`/billing/packages/${packageId}/adjust/`, {
    method: "POST",
    body: JSON.stringify(payload),
  });
}

export function previewAccountChargeFromPackage(accountId, payload) {
  return cabinetFetch(`/billing/accounts/${accountId}/charge-from-package/`, {
    method: "POST",
    body: JSON.stringify({ ...payload, preview: true }),
  });
}

export function chargeAccountFromPackage(accountId, payload) {
  return cabinetFetch(`/billing/accounts/${accountId}/charge-from-package/`, {
    method: "POST",
    body: JSON.stringify(payload),
    headers: payload?.idempotency_key
      ? { "X-Idempotency-Key": payload.idempotency_key }
      : undefined,
  });
}

export function settlePackageUnpaid(packageId, payload) {
  return cabinetFetch(`/billing/packages/${packageId}/settle-unpaid/`, {
    method: "POST",
    body: JSON.stringify(payload),
    headers: payload?.idempotency_key
      ? { "X-Idempotency-Key": payload.idempotency_key }
      : undefined,
  });
}

export function chargeEventBillingFromPackage(recordId, payload) {
  return cabinetFetch(`/billing/event-billing/${recordId}/charge-from-package/`, {
    method: "POST",
    body: JSON.stringify(payload),
    headers: payload?.idempotency_key
      ? { "X-Idempotency-Key": payload.idempotency_key }
      : undefined,
  });
}

export function refundEventBillingPackage(recordId, payload = {}) {
  return cabinetFetch(`/billing/event-billing/${recordId}/refund-package/`, {
    method: "POST",
    body: JSON.stringify(payload),
  });
}

export function markEventBillingPaid(recordId, payload) {
  return cabinetFetch(`/billing/event-billing/${recordId}/mark-paid/`, {
    method: "POST",
    body: JSON.stringify(payload),
  });
}

export function fetchUnresolvedBillingLessons() {
  return cabinetFetch("/billing/unresolved-lessons/", { method: "GET" });
}

export function previewEventBilling(eventId, payload = {}) {
  return cabinetFetch(`/billing/events/${eventId}/preview/`, {
    method: "POST",
    body: JSON.stringify(payload),
  });
}

export function finalizeEventBilling(eventId, payload) {
  return cabinetFetch(`/billing/events/${eventId}/finalize/`, {
    method: "POST",
    body: JSON.stringify(payload),
    headers: payload?.idempotency_key
      ? { "X-Idempotency-Key": payload.idempotency_key }
      : undefined,
  });
}

export function cancelEventFinance(eventId, payload) {
  return cabinetFetch(`/billing/events/${eventId}/cancel-finance/`, {
    method: "POST",
    body: JSON.stringify(payload),
  });
}

export function noShowEventFinance(eventId, payload) {
  return cabinetFetch(`/billing/events/${eventId}/no-show/`, {
    method: "POST",
    body: JSON.stringify(payload),
  });
}

export function fetchEventBillingBadge(eventId) {
  return cabinetFetch(`/billing/events/${eventId}/badge/`, { method: "GET" });
}

export function bulkFinalizeBilling(payload) {
  return cabinetFetch("/billing/lessons/bulk-finalize/", {
    method: "POST",
    body: JSON.stringify(payload),
  });
}

export function billingPlanCheck(payload) {
  return cabinetFetch("/billing/plan-check/", {
    method: "POST",
    body: JSON.stringify(payload),
  });
}

export function fetchBillingReports(params = {}) {
  return cabinetFetch(buildCabinetQueryPath("/billing/reports/", params), { method: "GET" });
}

export function billingExportUrl(params = {}) {
  const path = buildCabinetQueryPath("/billing/export/", params);
  return `${apiBase()}${path}`;
}

export function previewPaymentReminder(payload) {
  return cabinetFetch("/billing/reminders/preview/", {
    method: "POST",
    body: JSON.stringify(payload),
  });
}

export function sendPaymentReminder(payload) {
  return cabinetFetch("/billing/reminders/", {
    method: "POST",
    body: JSON.stringify(payload),
  });
}

export function fetchStudentBilling() {
  return cabinetFetch("/billing/student/", { method: "GET" });
}

/* ── Журнал успеваемости ─────────────────────────────────────────── */

export function fetchJournalOverview() {
  return cabinetFetch("/journal/", { method: "GET" });
}

export function fetchJournalGradebook(params = {}) {
  return cabinetFetch(buildCabinetQueryPath("/journal/gradebook/", params), { method: "GET" });
}

export function fetchJournalLessons(params = {}) {
  return cabinetFetch(buildCabinetQueryPath("/journal/lessons/", params), { method: "GET" });
}

export function fetchJournalLesson(lessonId) {
  return cabinetFetch(`/journal/lessons/${lessonId}/`, { method: "GET" });
}

export function saveJournalLesson(lessonId, payload) {
  return cabinetFetch(`/journal/lessons/${lessonId}/`, {
    method: "PATCH",
    body: JSON.stringify(payload),
  });
}

export function updateJournalLessonTopics(lessonId, payload) {
  return cabinetFetch(`/journal/lessons/${lessonId}/topics/`, {
    method: "PATCH",
    body: JSON.stringify(payload),
  });
}

export function completeJournalLesson(lessonId, payload = {}) {
  return cabinetFetch(`/journal/lessons/${lessonId}/complete/`, {
    method: "POST",
    body: JSON.stringify(payload),
  });
}

export function publishJournalLesson(lessonId, payload = {}) {
  return cabinetFetch(`/journal/lessons/${lessonId}/publish/`, {
    method: "POST",
    body: JSON.stringify(payload),
  });
}

export function bulkJournalLesson(lessonId, payload) {
  return cabinetFetch(`/journal/lessons/${lessonId}/bulk/`, {
    method: "POST",
    body: JSON.stringify(payload),
  });
}

export function fetchJournalStudent(studentId) {
  return cabinetFetch(`/journal/students/${studentId}/`, { method: "GET" });
}

export function fetchJournalStudentErrors(studentId, params = {}) {
  return cabinetFetch(
    buildCabinetQueryPath(`/journal/students/${studentId}/errors/`, params),
    { method: "GET" },
  );
}

export function fetchJournalStudentErrorsSummary(studentId) {
  return fetchJournalStudentErrors(studentId, { summary: 1 });
}

export function createHomeworkFromStudentErrors(studentId, payload = {}) {
  return cabinetFetch(`/journal/students/${studentId}/errors/create-homework/`, {
    method: "POST",
    body: JSON.stringify(payload),
  });
}

export function fetchJournalStudentsSummary() {
  return cabinetFetch("/journal/students/", { method: "GET" });
}

export function fetchJournalGroup(groupId) {
  return cabinetFetch(`/journal/groups/${groupId}/`, { method: "GET" });
}

export function fetchJournalAttendance(params = {}) {
  return cabinetFetch(buildCabinetQueryPath("/journal/attendance/", params), { method: "GET" });
}

export function fetchJournalAnalytics(studentId) {
  return cabinetFetch(
    buildCabinetQueryPath("/journal/analytics/", { student_id: studentId }),
    { method: "GET" },
  );
}

export function fetchJournalSettings() {
  return cabinetFetch("/journal/settings/", { method: "GET" });
}

export function updateJournalSettings(payload) {
  return cabinetFetch("/journal/settings/", {
    method: "PATCH",
    body: JSON.stringify(payload),
  });
}

export function fetchStudentResults() {
  return cabinetFetch("/student/results/", { method: "GET" });
}

export function fetchStudentResultDetail(recordId) {
  return cabinetFetch(`/student/results/${recordId}/`, { method: "GET" });
}

// --- My Files ---

function filesBase(student = false) {
  return student ? "/student/files" : "/files";
}

export function fetchMyFiles(params = {}, { student = false } = {}) {
  return cabinetFetch(buildCabinetQueryPath(`${filesBase(student)}/`, params), { method: "GET" });
}

export function fetchMyFilesQuota({ student = false } = {}) {
  return cabinetFetch(`${filesBase(student)}/quota/`, { method: "GET" });
}

export function createMyFilesFolder(payload, { student = false } = {}) {
  return cabinetFetch(`${filesBase(student)}/folders/`, {
    method: "POST",
    body: JSON.stringify(payload),
  });
}

export function updateMyFilesFolder(folderId, payload, { student = false } = {}) {
  return cabinetFetch(`${filesBase(student)}/folders/${folderId}/`, {
    method: "PATCH",
    body: JSON.stringify(payload),
  });
}

export function trashMyFilesFolder(folderId, { student = false } = {}) {
  return cabinetFetch(`${filesBase(student)}/folders/${folderId}/`, { method: "DELETE" });
}

export function restoreMyFilesFolder(folderId, payload = {}) {
  return cabinetFetch(`/files/folders/${folderId}/restore/`, {
    method: "POST",
    body: JSON.stringify(payload),
  });
}

export function uploadMyFile(file, { folderId, displayName, student = false } = {}) {
  const formData = new FormData();
  formData.append("file", file);
  if (folderId) formData.append("folder_id", folderId);
  if (displayName) formData.append("display_name", displayName);
  return cabinetFetchMultipart(`${filesBase(student)}/upload/`, formData);
}

export function fetchHomeworkAttachments(homeworkId) {
  return cabinetFetch(`/homework/${homeworkId}/attachments/`, { method: "GET" });
}

export function uploadHomeworkAttachments(homeworkId, files) {
  const formData = new FormData();
  const list = Array.isArray(files) ? files : [files];
  list.forEach((file) => {
    if (file) formData.append("files", file);
  });
  return cabinetFetchMultipart(`/homework/${homeworkId}/attachments/`, formData);
}

export function deleteHomeworkAttachment(homeworkId, attachmentId) {
  return cabinetFetch(`/homework/${homeworkId}/attachments/${attachmentId}/`, {
    method: "DELETE",
  });
}

export function fetchMyFile(fileId, { student = false } = {}) {
  return cabinetFetch(`${filesBase(student)}/${fileId}/`, { method: "GET" });
}

export function updateMyFile(fileId, payload, { student = false } = {}) {
  return cabinetFetch(`${filesBase(student)}/${fileId}/`, {
    method: "PATCH",
    body: JSON.stringify(payload),
  });
}

export function trashMyFile(fileId, { student = false } = {}) {
  return cabinetFetch(`${filesBase(student)}/${fileId}/trash/`, {
    method: "POST",
    body: "{}",
  });
}

export function restoreMyFile(fileId, payload = {}, { student = false } = {}) {
  return cabinetFetch(`${filesBase(student)}/${fileId}/restore/`, {
    method: "POST",
    body: JSON.stringify(payload),
  });
}

export function purgeMyFile(fileId, { force = false, student = false } = {}) {
  const qs = force ? "?force=true" : "";
  return cabinetFetch(`${filesBase(student)}/${fileId}/${qs}`, { method: "DELETE" });
}

export function copyMyFile(fileId, payload = {}) {
  return cabinetFetch(`/files/${fileId}/copy/`, {
    method: "POST",
    body: JSON.stringify(payload),
  });
}

export function moveMyFiles(payload) {
  return cabinetFetch("/files/move/", {
    method: "POST",
    body: JSON.stringify(payload),
  });
}

export function attachMyFile(fileId, payload) {
  return cabinetFetch(`/files/${fileId}/attach/`, {
    method: "POST",
    body: JSON.stringify(payload),
  });
}

export function assignMyFile(fileId, payload) {
  return cabinetFetch(`/files/${fileId}/assign/`, {
    method: "POST",
    body: JSON.stringify(payload),
  });
}

export function emptyMyFilesTrash() {
  return cabinetFetch("/files/trash/empty/", {
    method: "POST",
    body: "{}",
  });
}

export function myFileDownloadUrl(fileId, { student = false, shared = false } = {}) {
  if (shared) return `${apiBase()}/student/files/shared/${fileId}/download/`;
  return `${apiBase()}${filesBase(student)}/${fileId}/download/`;
}

export function myFilePreviewUrl(fileId, { student = false, shared = false } = {}) {
  if (shared) return `${apiBase()}/student/files/shared/${fileId}/preview/`;
  return `${apiBase()}${filesBase(student)}/${fileId}/preview/`;
}
