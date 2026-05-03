/**
 * В dev (Vite) длинная генерация PDF через прокси иногда обрывается; бинарный ответ
 * надёжнее запрашивать напрямую с Django (как в SearchTaskPage).
 * В production — пустая строка, используются относительные /api/... на том же хосте.
 */
export function devApiBase() {
  const fromEnv = import.meta.env.VITE_API_BASE;
  if (fromEnv && String(fromEnv).trim().startsWith("http")) {
    return String(fromEnv).replace(/\/$/, "");
  }
  if (typeof window === "undefined") return "";
  if (!import.meta.env.DEV) return "";
  const port = window.location.port;
  if (port === "5000" || port === "5173") {
    return `${window.location.protocol}//127.0.0.1:8000`;
  }
  return "";
}
