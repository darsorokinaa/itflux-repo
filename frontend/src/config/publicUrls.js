/**
 * URL ЛК из сборки (до и после `/api/site-config/`, вместе с Django `LK_PUBLIC_URL`).
 * Задавайте VITE_LK_PUBLIC_URL (рекомендуется) — тот же origin, что и сессия/cookies ЛК
 * (CORS + `credentials: 'include'` с стороны ЛК для API ДЗ). Фоллбек: VITE_LK_URL.
 * Не подставляйте URL корня генератора вместо ЛК.
 */
function lkBuildBase() {
  return String(
    import.meta.env.VITE_LK_PUBLIC_URL || import.meta.env.VITE_LK_URL || "http://lk.genurok.tw1.ru"
  )
    .trim()
    .replace(/\/$/, "");
}

export const LK_PUBLIC_URL = lkBuildBase();
