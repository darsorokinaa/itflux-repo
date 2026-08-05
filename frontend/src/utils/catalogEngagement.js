/** API просмотров и лайков для /lessons и /interesting */

function getCsrfToken() {
  const match = document.cookie.match(/(?:^|;\s*)csrftoken=([^;]+)/);
  return match ? decodeURIComponent(match[1]) : "";
}

async function ensureCsrf() {
  if (getCsrfToken()) return;
  try {
    await fetch("/api/csrf/", { credentials: "same-origin", cache: "no-store" });
  } catch {
    /* ignore */
  }
}

async function catalogPost(path) {
  await ensureCsrf();
  const headers = { Accept: "application/json" };
  const csrf = getCsrfToken();
  if (csrf) headers["X-CSRFToken"] = csrf;
  const res = await fetch(path, {
    method: "POST",
    credentials: "same-origin",
    headers,
  });
  let data = null;
  try {
    data = await res.json();
  } catch {
    data = null;
  }
  if (!res.ok) {
    const err = new Error(data?.detail || data?.error || "Ошибка запроса");
    err.status = res.status;
    err.data = data;
    throw err;
  }
  return data;
}

export function registerCatalogView(kind, slug) {
  const base = kind === "interesting" ? "interesting" : "lessons";
  return catalogPost(`/api/${base}/${encodeURIComponent(slug)}/stats/view/`);
}

export function toggleCatalogLike(kind, slug) {
  const base = kind === "interesting" ? "interesting" : "lessons";
  return catalogPost(`/api/${base}/${encodeURIComponent(slug)}/stats/like/`);
}

/** 125 → «125», 1200 → «1,2 тыс.», 1_100_000 → «1,1 млн» */
export function formatCompactCount(value) {
  const n = Number(value) || 0;
  if (n < 1000) return String(n);
  if (n < 1_000_000) {
    const k = n / 1000;
    const text = k >= 100 ? String(Math.round(k)) : k.toFixed(1).replace(".", ",");
    return `${text.replace(/,0$/, "")} тыс.`;
  }
  const m = n / 1_000_000;
  const text = m >= 100 ? String(Math.round(m)) : m.toFixed(1).replace(".", ",");
  return `${text.replace(/,0$/, "")} млн`;
}

export const CATALOG_ORDERING_OPTIONS = [
  { value: "newest", label: "Сначала новые" },
  { value: "views", label: "По просмотрам" },
  { value: "likes", label: "По лайкам" },
];
