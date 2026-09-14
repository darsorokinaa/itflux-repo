import { ensureCsrfCookie } from "../../utils/cabinetAuth";

function csrfHeaders(extra = {}) {
  const headers = { Accept: "application/json", ...extra };
  const match = typeof document !== "undefined"
    ? document.cookie.match(/(?:^|;\s*)csrftoken=([^;]+)/)
    : null;
  if (match) headers["X-CSRFToken"] = decodeURIComponent(match[1]);
  return headers;
}

async function parseJson(res) {
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    const err = new Error(data.error || data.detail || `Ошибка ${res.status}`);
    err.status = res.status;
    err.code = data.code;
    err.data = data;
    throw err;
  }
  return data;
}

export async function fetchSubmissionAttachments(submissionId) {
  await ensureCsrfCookie();
  const res = await fetch(`/api/homework/submissions/${submissionId}/attachments/`, {
    credentials: "include",
    headers: csrfHeaders(),
  });
  return parseJson(res);
}

export async function uploadSubmissionTaskAttachment(submissionId, taskId, formData) {
  await ensureCsrfCookie();
  const res = await fetch(
    `/api/homework/submissions/${submissionId}/tasks/${encodeURIComponent(taskId)}/attachments/`,
    {
      method: "POST",
      body: formData,
      credentials: "include",
      headers: csrfHeaders(),
    },
  );
  return parseJson(res);
}

export async function deleteHomeworkAttachment(attachmentId) {
  await ensureCsrfCookie();
  const res = await fetch(`/api/homework/attachments/${attachmentId}/`, {
    method: "DELETE",
    credentials: "include",
    headers: csrfHeaders(),
  });
  return parseJson(res);
}

export async function openHomeworkNotebook(submissionId, taskId, { ownerRole, seed = true } = {}) {
  await ensureCsrfCookie();
  const res = await fetch(`/api/homework/submissions/${submissionId}/notebooks/`, {
    method: "POST",
    credentials: "include",
    headers: csrfHeaders({ "Content-Type": "application/json" }),
    body: JSON.stringify({
      task_id: String(taskId),
      owner_role: ownerRole,
      seed_from_attachments: seed,
    }),
  });
  return parseJson(res);
}

export async function fetchHomeworkNotebook(notebookId) {
  await ensureCsrfCookie();
  const res = await fetch(`/api/homework/notebooks/${notebookId}/`, {
    credentials: "include",
    headers: csrfHeaders(),
  });
  return parseJson(res);
}

export async function saveHomeworkNotebook(notebookId, payload, { signal } = {}) {
  await ensureCsrfCookie();
  const res = await fetch(`/api/homework/notebooks/${notebookId}/`, {
    method: "PUT",
    credentials: "include",
    headers: csrfHeaders({ "Content-Type": "application/json" }),
    body: JSON.stringify(payload),
    signal,
  });
  return parseJson(res);
}

export async function addHomeworkNotebookPage(notebookId, body, file) {
  await ensureCsrfCookie();
  let res;
  if (file) {
    const fd = new FormData();
    Object.entries(body || {}).forEach(([key, value]) => {
      if (value != null) fd.append(key, String(value));
    });
    fd.append("file", file);
    res = await fetch(`/api/homework/notebooks/${notebookId}/pages/`, {
      method: "POST",
      body: fd,
      credentials: "include",
      headers: csrfHeaders(),
    });
  } else {
    res = await fetch(`/api/homework/notebooks/${notebookId}/pages/`, {
      method: "POST",
      credentials: "include",
      headers: csrfHeaders({ "Content-Type": "application/json" }),
      body: JSON.stringify(body),
    });
  }
  return parseJson(res);
}

export async function deleteHomeworkNotebookPage(notebookId, pageId) {
  await ensureCsrfCookie();
  const res = await fetch(`/api/homework/notebooks/${notebookId}/pages/${pageId}/`, {
    method: "DELETE",
    credentials: "include",
    headers: csrfHeaders(),
  });
  return parseJson(res);
}

export async function completeHomeworkNotebook(notebookId, formData) {
  await ensureCsrfCookie();
  const res = await fetch(`/api/homework/notebooks/${notebookId}/complete/`, {
    method: "POST",
    body: formData,
    credentials: "include",
    headers: csrfHeaders(),
  });
  return parseJson(res);
}

export async function submitHomeworkNotebook(notebookId) {
  await ensureCsrfCookie();
  const res = await fetch(`/api/homework/notebooks/${notebookId}/submit/`, {
    method: "POST",
    credentials: "include",
    headers: csrfHeaders(),
  });
  return parseJson(res);
}

export async function fetchPublishedNotebook(submissionId, taskId) {
  await ensureCsrfCookie();
  const res = await fetch(
    `/api/homework/submissions/${submissionId}/tasks/${encodeURIComponent(taskId)}/published-notebook/`,
    { credentials: "include", headers: csrfHeaders() },
  );
  return parseJson(res);
}

export async function uploadNotebookPageBackground(pageId, blob) {
  await ensureCsrfCookie();
  const fd = new FormData();
  fd.append("file", blob, "page.jpg");
  const res = await fetch(`/api/homework/notebook-pages/${pageId}/background/`, {
    method: "POST",
    body: fd,
    credentials: "include",
    headers: csrfHeaders(),
  });
  return parseJson(res);
}

export function notebookExportUrl(notebookId) {
  return `/api/homework/notebooks/${notebookId}/export/`;
}
