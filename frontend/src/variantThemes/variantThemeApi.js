import { ensureCsrfCookie } from "../utils/cabinetAuth";

function getCsrfToken() {
  const match = document.cookie.match(/(?:^|;\s*)csrftoken=([^;]+)/);
  return match ? decodeURIComponent(match[1]) : "";
}

async function themeFetch(path, options = {}) {
  await ensureCsrfCookie();
  const headers = {
    Accept: "application/json",
    ...(options.body && !(options.body instanceof FormData) ? { "Content-Type": "application/json" } : {}),
    ...(options.headers || {}),
  };
  const csrf = getCsrfToken();
  if (csrf) headers["X-CSRFToken"] = csrf;
  const res = await fetch(path, {
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
    const err = new Error(data?.error || data?.detail || "Ошибка запроса");
    err.status = res.status;
    err.data = data;
    throw err;
  }
  return data;
}

export function fetchAvailableVariantThemes() {
  return themeFetch("/api/variant-themes/available/");
}

export function fetchAdminVariantThemes() {
  return themeFetch("/api/admin/variant-themes/");
}

export function createVariantTheme(payload) {
  return themeFetch("/api/admin/variant-themes/", {
    method: "POST",
    body: JSON.stringify(payload),
  });
}

export function updateVariantTheme(themeId, payload) {
  return themeFetch(`/api/admin/variant-themes/${encodeURIComponent(themeId)}/`, {
    method: "PATCH",
    body: JSON.stringify(payload),
  });
}

export function uploadVariantThemeImage(themeId, field, file) {
  const body = new FormData();
  body.append(field, file);
  return themeFetch(`/api/admin/variant-themes/${encodeURIComponent(themeId)}/`, {
    method: "PATCH",
    body,
  });
}

export function deleteVariantTheme(themeId) {
  return themeFetch(`/api/admin/variant-themes/${encodeURIComponent(themeId)}/`, {
    method: "DELETE",
  });
}

export function assignVariantTheme({ level, subject, variantId, themeId }) {
  return themeFetch(
    `/api/${encodeURIComponent(level)}/${encodeURIComponent(subject)}/variant/${encodeURIComponent(variantId)}/`,
    {
      method: "PATCH",
      body: JSON.stringify({ theme_id: themeId }),
    },
  );
}
