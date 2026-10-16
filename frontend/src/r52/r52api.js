import { ensureCsrfCookie, getCsrfToken } from "../utils/cabinetAuth";

export async function r52Get(path) {
  const res = await fetch(`/api/cabinet/r52/${path}`, { credentials: "same-origin" });
  if (!res.ok) { const e = new Error("http"); e.status = res.status; throw e; }
  return res.json();
}

export async function r52Post(path, body) {
  await ensureCsrfCookie();
  const res = await fetch(`/api/cabinet/r52/${path}`, {
    method: "POST",
    credentials: "same-origin",
    headers: { "Content-Type": "application/json", "X-CSRFToken": getCsrfToken() },
    body: JSON.stringify(body || {}),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) { const e = new Error(data.error || data.detail || "Не удалось сохранить"); e.status = res.status; throw e; }
  return data;
}
