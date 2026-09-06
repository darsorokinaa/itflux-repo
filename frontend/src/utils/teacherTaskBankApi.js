import { ensureCsrfCookie } from "./cabinetAuth";

function getCsrfToken() {
  const match = document.cookie.match(/(?:^|;\s*)csrftoken=([^;]+)/);
  return match ? decodeURIComponent(match[1]) : "";
}

async function teacherTaskFetch(path, options = {}) {
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
  const res = await fetch(`/api/cabinet${path}`, {
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
    const message =
      (typeof data?.detail === "string" && data.detail) ||
      (typeof data?.error === "string" && data.error) ||
      "Ошибка запроса";
    const err = new Error(message);
    err.status = res.status;
    err.data = data;
    throw err;
  }
  return data;
}

export function fetchMyTasks(params = {}) {
  const qs = new URLSearchParams();
  Object.entries(params).forEach(([key, value]) => {
    if (value != null && value !== "") qs.set(key, String(value));
  });
  const query = qs.toString();
  return teacherTaskFetch(`/my-tasks/${query ? `?${query}` : ""}`);
}

export function fetchMyTasksMeta() {
  return teacherTaskFetch("/my-tasks/meta/");
}

export function fetchMyTasksCatalog(params = {}) {
  const qs = new URLSearchParams();
  Object.entries(params).forEach(([key, value]) => {
    if (value != null && value !== "") qs.set(key, String(value));
  });
  const query = qs.toString();
  return teacherTaskFetch(`/my-tasks/catalog/${query ? `?${query}` : ""}`);
}

export function fetchMyTask(id) {
  return teacherTaskFetch(`/my-tasks/${id}/`);
}

export function createMyTask(payload) {
  return teacherTaskFetch("/my-tasks/", {
    method: "POST",
    body: JSON.stringify(payload),
  });
}

export function updateMyTask(id, payload) {
  return teacherTaskFetch(`/my-tasks/${id}/`, {
    method: "PATCH",
    body: JSON.stringify(payload),
  });
}

export function deleteMyTask(id) {
  return teacherTaskFetch(`/my-tasks/${id}/`, { method: "DELETE" });
}

export function duplicateMyTask(id) {
  return teacherTaskFetch(`/my-tasks/${id}/duplicate/`, { method: "POST" });
}

export function archiveMyTask(id) {
  return teacherTaskFetch(`/my-tasks/${id}/archive/`, { method: "POST" });
}

export function restoreMyTask(id) {
  return teacherTaskFetch(`/my-tasks/${id}/restore/`, { method: "POST" });
}

export function mergeCatalogSubjects(...lists) {
  const map = new Map();
  for (const list of lists) {
    for (const item of list || []) {
      const id = String(item?.id || item?.subject_short || "").trim().toLowerCase();
      if (!id) continue;
      const name = String(item?.name || item?.title || "").trim() || id;
      if (!map.has(id)) map.set(id, { id, name, pk: item.pk });
    }
  }
  return [...map.values()].sort((a, b) => a.name.localeCompare(b.name, "ru"));
}

export function copyGlobalTaskToMyBank(taskId) {
  return teacherTaskFetch("/my-tasks/copy-from-global/", {
    method: "POST",
    body: JSON.stringify({ task_id: taskId }),
  });
}

export function uploadMyTaskImage(file) {
  const body = new FormData();
  body.append("upload", file);
  return teacherTaskFetch("/my-tasks/upload-image/", { method: "POST", body });
}

export function uploadMyTaskAttachment(taskId, file) {
  const body = new FormData();
  body.append("file", file);
  return teacherTaskFetch(`/my-tasks/${taskId}/attachments/`, { method: "POST", body });
}

export function deleteMyTaskAttachment(taskId, attachmentId) {
  const path = attachmentId == null
    ? `/my-tasks/${taskId}/attachments/legacy/`
    : `/my-tasks/${taskId}/attachments/${attachmentId}/`;
  return teacherTaskFetch(path, { method: "DELETE" });
}
