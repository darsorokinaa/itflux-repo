/**
 * Безопасный парсинг HTML-фрагмента условия задачи.
 * DOMParser на полном документе при висячих </div> обрезает хвост; createElement — нет.
 */
export function parseTaskHtmlFragment(html, className = "") {
  if (html == null || typeof html !== "string") return null;
  if (typeof document === "undefined") return null;
  const root = document.createElement("div");
  if (className) root.className = className;
  root.innerHTML = html;
  return root;
}

export function serializeTaskHtmlFragment(root) {
  return root?.innerHTML ?? "";
}
