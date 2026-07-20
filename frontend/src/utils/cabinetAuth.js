function apiBase() {
  return "/api/cabinet";
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
  await fetch("/api/csrf/", { credentials: "same-origin" });
}

async function cabinetFetch(path, options = {}) {
  await ensureCsrfCookie();
  const headers = {
    Accept: "application/json",
    ...(options.body ? { "Content-Type": "application/json" } : {}),
    ...(options.headers || {}),
  };
  const csrf = getCsrfToken();
  if (csrf) headers["X-CSRFToken"] = csrf;

  const res = await fetch(`${apiBase()}${path}`, {
    credentials: "same-origin",
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
    ...(options.body && !(options.body instanceof FormData)
      ? { "Content-Type": "application/json" }
      : {}),
    ...(options.headers || {}),
  };
  const csrf = getCsrfToken();
  if (csrf) headers["X-CSRFToken"] = csrf;

  const res = await fetch(`/api/video-meetings${path}`, {
    credentials: "same-origin",
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

export function fetchStudentHomeworkOptions(studentId) {
  return cabinetFetch(`/students/${studentId}/homework-options/`, { method: "GET" });
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

async function cabinetFetchMultipart(path, formData, { method = "POST" } = {}) {
  await ensureCsrfCookie();
  const headers = { Accept: "application/json" };
  const csrf = getCsrfToken();
  if (csrf) headers["X-CSRFToken"] = csrf;

  const res = await fetch(`${apiBase()}${path}`, {
    method,
    body: formData,
    credentials: "same-origin",
    headers,
  });

  let data = null;
  try {
    data = await res.json();
  } catch {
    data = null;
  }

  if (!res.ok || (Object.prototype.hasOwnProperty.call(data || {}, "ok") && !data.ok)) {
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
  const headers = { Accept: "application/json" };
  const csrf = getCsrfToken();
  if (csrf) headers["X-CSRFToken"] = csrf;
  if (!isFormData) headers["Content-Type"] = "application/json";

  const res = await fetch(`${apiBase()}/materials/`, {
    method: "POST",
    credentials: "same-origin",
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

export function validatePromoCode(code, planSlug = null) {
  return cabinetFetch("/subscription/apply-promo/", {
    method: "POST",
    body: JSON.stringify({ code, plan_slug: planSlug || undefined }),
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
  return "/cabinet";
}

export function isTeacherRole(user) {
  return user?.role === "teacher";
}

export function isStudentRole(user) {
  return user?.role === "student";
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

export function fetchStudentAssignments() {
  return cabinetFetch("/student/assignments/", { method: "GET" });
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

export function fetchStudentSchedule() {
  return cabinetFetch("/student/schedule/", { method: "GET" });
}

export function fetchStudentScheduleEvent(eventId) {
  return cabinetFetch(`/student/schedule/${eventId}/`, { method: "GET" });
}

export function fetchStudentProgress() {
  return cabinetFetch("/student/progress/", { method: "GET" });
}

export function fetchStudentMaterials(query = "") {
  const qs = query ? `?q=${encodeURIComponent(query)}` : "";
  return cabinetFetch(`/student/materials/${qs}`, { method: "GET" });
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
