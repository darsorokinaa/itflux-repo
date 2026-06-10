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
  const { hostname, port } = window.location;
  const hostOk = hostname === "localhost" || hostname === "127.0.0.1";
  const portOk = port === "5000" || port === "5001" || port === "5173";
  // Прямой Django только с локального Vite; с телефона/по IP — через прокси Vite (/api).
  if (hostOk && portOk) {
    return `${window.location.protocol}//127.0.0.1:8000`;
  }
  return "";
}
