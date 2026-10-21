/** r91: маленький fetch-хелпер (CSRF + JSON) для входа по ссылке на урок и выбора роли. */
function csrf() {
  const m = document.cookie.match(/(?:^|;\s*)csrftoken=([^;]+)/);
  return m ? decodeURIComponent(m[1]) : "";
}

export async function r91Json(path, { method = "GET", body } = {}) {
  if (method !== "GET" && !csrf()) {
    try { await fetch("/api/csrf/", { credentials: "same-origin", cache: "no-store" }); } catch { /* ignore */ }
  }
  const headers = { Accept: "application/json" };
  if (body !== undefined) headers["Content-Type"] = "application/json";
  if (method !== "GET") headers["X-CSRFToken"] = csrf();
  const res = await fetch(`/api/cabinet${path}`, {
    method, credentials: "same-origin", cache: "no-store", headers,
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  let data = null;
  try { data = await res.json(); } catch { data = null; }
  return { ok: res.ok, status: res.status, data: data || {} };
}

export function loginHref(next, extra = {}) {
  const q = new URLSearchParams({ next: next || "/cabinet", ...extra });
  return `/cabinet/login?${q.toString()}`;
}
