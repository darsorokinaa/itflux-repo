/** r131: Markdown + LaTeX разбора -> безопасный HTML (формулы оставляем для MathJax). */
import { marked } from "marked";
import DOMPurify from "dompurify";

const MATH_RE = /\$\$[\s\S]+?\$\$|(?<!\\)\$(?!\s)[^$\n]+?(?<!\\)\$/g;

function escapeHtml(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

export function taskLinkHref(taskId: string | number): string {
  return `/search/tasks?q=${encodeURIComponent(String(taskId))}`;
}

export function renderRazborMarkdown(md: string): string {
  const formulas: string[] = [];
  // Формулы прячем от Markdown (иначе _ и * внутри LaTeX станут курсивом).
  const protectedMd = String(md || "").replace(MATH_RE, (m) => {
    formulas.push(m);
    return `@@RZMATH${formulas.length - 1}@@`;
  });
  let html = marked.parse(protectedMd, { async: false, gfm: true, breaks: false }) as string;
  html = html.replace(/@@RZMATH(\d+)@@/g, (_m, i) => escapeHtml(formulas[Number(i)] ?? ""));
  html = DOMPurify.sanitize(html, { USE_PROFILES: { html: true } });
  // Примеры «… task_id 41378» -> ссылка на задачу в банке.
  html = html.replace(/(<h[2-4][^>]*>)([\s\S]*?)task_id\s*(\d+)([\s\S]*?)(<\/h[2-4]>)/g, (_m, open, before, id, after, close) => {
    const label = String(before).replace(/[,\s]+$/, "");
    return `${open}${label}${after}${close}<p class="razbor-task-link"><a href="${taskLinkHref(id)}">Задача №${id} в банке — решить самостоятельно →</a></p>`;
  });
  // Картинки и таблицы: lazy + горизонтальная прокрутка на мобильных.
  html = html.replace(/<img /g, '<img loading="lazy" decoding="async" ');
  html = html.replace(/<table>/g, '<div class="razbor-table-wrap"><table>').replace(/<\/table>/g, "</table></div>");
  return html;
}
