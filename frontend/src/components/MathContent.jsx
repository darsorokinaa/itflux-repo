import { memo, useEffect, useRef } from "react";
import { formatOgeInformaticsTask13Html } from "../utils/formatOgeInf13TaskHtml";
import { formatOgeMathChoiceTaskHtml } from "../utils/formatOgeMathChoiceTaskHtml";
import { formatOgeMathMatchingTaskHtml } from "../utils/formatOgeMathMatchingTaskHtml";

/** Снять слои &lt;…&gt; если HTML целиком попал в БД как экранированный текст. */
function decodeHtmlEntityLayersIfStoredEscaped(raw) {
  if (typeof raw !== "string" || !raw) return raw;
  let cur = raw;
  for (let i = 0; i < 8; i++) {
    const t = cur.trimStart();
    if (!t.startsWith("&lt;") && !t.startsWith("&amp;lt;")) break;
    const textarea = document.createElement("textarea");
    textarea.innerHTML = cur;
    const next = textarea.value;
    if (next === cur) break;
    cur = next;
  }
  return cur;
}

/**
 * В старых задачах встречаются лишние экранирующие "\" перед символами
 * вроде #, +, ^ (например "\#"). Убираем только этот частный случай.
 */
function normalizeEscapedTaskSymbols(raw) {
  if (typeof raw !== "string" || !raw) return raw;
  return raw
    .replace(/\\([#+^])/g, "$1")
    // Удаляем одиночный "\" перед пробелом, HTML-тегом или концом строки.
    .replace(/\\(?=\s|<|$)/g, "");
}

/** span.logic-connective-ru иногда портится при сохранении (пробелы в тегах). */
function repairLogicConnectiveSpanMarkup(raw) {
  if (typeof raw !== "string" || !raw) return raw;
  let s = raw;
  s = s.replace(/<\s*spanclass\b/gi, "<span class");
  s = s.replace(
    /<\s*span\s+class\s*=\s*['"]?\s*logic\s*-\s*connective\s*-\s*ru\s*['"]?\s*>/gi,
    '<span class="logic-connective-ru">'
  );
  s = s.replace(/<\/\s*sp\s*an\s*>/gi, "</span>");
  return s;
}

/** В math mode пробелы не видны — разрядка вокруг \\text{…} и скобок (как на бэкенде). */
function addThinSpaceAroundLogicText(texFragment) {
  if (typeof texFragment !== "string" || texFragment.indexOf("\\text{") === -1) {
    return texFragment;
  }
  return texFragment
    .replace(/\)\s*(?=\\text)/g, ")\\;")
    .replace(/(\\text\{[^}]+\})\s*(?=\\text)/g, "$1\\;")
    .replace(/(\\text\{[^}]+\})\s*(?=\()/g, "$1\\;");
}

/**
 * Внутри $...$ и $$...$$ MathJax воспринимает разметку как TeX: заменяем span на \text{…}.
 */
function convertLogicSpansInsideMathDelimitersToTex(html) {
  if (typeof html !== "string" || !html) return html;

  const spanToTex = (texFragment) =>
    addThinSpaceAroundLogicText(
      texFragment.replace(
        /<span\s+class=["']logic-connective-ru["']>\s*([^<]*?)\s*<\/span>/gi,
        (_, inner) => {
          const word = String(inner || "").trim();
          return word ? `\\text{${word}}` : "";
        }
      )
    );

  const out = [];
  let i = 0;
  while (i < html.length) {
    if (html.startsWith("$$", i)) {
      const end = html.indexOf("$$", i + 2);
      if (end === -1) {
        out.push(html.slice(i));
        break;
      }
      out.push("$$");
      out.push(spanToTex(html.slice(i + 2, end)));
      out.push("$$");
      i = end + 2;
      continue;
    }
    const j = html.indexOf("$", i);
    if (j === -1) {
      out.push(html.slice(i));
      break;
    }
    out.push(html.slice(i, j));
    const k = html.indexOf("$", j + 1);
    if (k === -1) {
      out.push(html.slice(j));
      break;
    }
    out.push("$");
    out.push(spanToTex(html.slice(j + 1, k)));
    out.push("$");
    i = k + 1;
  }
  return out.join("");
}

/**
 * Рендерит HTML с поддержкой LaTeX/MathJax. На любой странице MathJax
 * корректно отображает формулы.
 * @param {Function} onImageClick - опционально: (src) => {} при клике по картинке
 * @param {boolean} [ogeInf13Enhance] — ОГЭ информатика №13: разметка длинного ТЗ презентации
 */
/**
 * Inline-стили ФИПИ (цвета, рамки) — снимаем в DOM, иначе !important в HTML побеждает CSS.
 */
function _stripFipiDeclarationsFromStyleAttr(node) {
  const style = node.getAttribute("style");
  if (!style) return;
  const filtered = style
    .split(";")
    .map((s) => s.trim())
    .filter((decl) => {
      if (!decl) return false;
      const prop = decl.split(":", 1)[0]?.trim().toLowerCase() ?? "";
      return !(
        prop === "color" ||
        prop === "background" ||
        prop === "background-color" ||
        prop === "background-image" ||
        prop.startsWith("border") ||
        prop === "outline"
      );
    })
    .join("; ");
  if (filtered) node.setAttribute("style", filtered);
  else node.removeAttribute("style");
}

function stripFipiInlineLayoutStyles(root) {
  if (!root) return;
  const targets = [root, ...root.querySelectorAll("*")];
  for (const node of targets) {
    node.removeAttribute?.("border");
    node.removeAttribute?.("frame");
    node.removeAttribute?.("rules");
    node.removeAttribute?.("bgcolor");
    node.removeAttribute?.("color");
    if (node.tagName === "FONT") {
      const span = document.createElement("span");
      while (node.firstChild) span.appendChild(node.firstChild);
      node.replaceWith(span);
      continue;
    }
    _stripFipiDeclarationsFromStyleAttr(node);
  }
}

/**
 * Снимаем <style>...</style> из строки HTML — FIPI-контент иногда тащит свои
 * правила (оранжевые таблицы), а мы хотим единый брендовый стиль.
 */
function stripEmbeddedStyleBlocks(raw) {
  if (typeof raw !== "string" || !raw) return raw;
  return raw.replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi, "");
}

function MathContentInner({ html, className, onImageClick, ogeInf13Enhance = false }) {
  const ref = useRef(null);

  useEffect(() => {
    if (!ref.current) return;
    const el = ref.current;
    const s = (html != null ? String(html) : "") || "";
    const decoded = decodeHtmlEntityLayersIfStoredEscaped(s);
    const cleaned = stripEmbeddedStyleBlocks(decoded);
    const normalized = normalizeEscapedTaskSymbols(cleaned);
    const repaired = repairLogicConnectiveSpanMarkup(normalized);
    const inf13 = ogeInf13Enhance ? formatOgeInformaticsTask13Html(repaired) : repaired;
    // Соответствие А/Б/В ↔ 1/2/3 (ОГЭ мат. №11) — до choice, иначе 1) 2) путаются с вариантами.
    const matched = formatOgeMathMatchingTaskHtml(inf13);
    const afterMatch = matched && matched.trim() ? matched : inf13;
    // Только отображение: в CKEditor в БД остаются исходные <table>, не oge-math-choice-*.
    const formatted = formatOgeMathChoiceTaskHtml(afterMatch);
    const piped = formatted && formatted.trim() ? formatted : afterMatch;
    el.innerHTML = convertLogicSpansInsideMathDelimitersToTex(piped);
    stripFipiInlineLayoutStyles(el);

    // На странице варианта MathJax один раз на весь документ (ExamPage), не на каждую задачу.
    const inExamVariant = !!el.closest(
      "#main-wrapper.exam-page, .exam-page, .exam-page-container"
    );
    if (inExamVariant) return undefined;

    let cancelled = false;
    const run = () => {
      if (cancelled) return;
      if (window.MathJax?.typesetPromise) {
        window.MathJax.typesetPromise([el])
          .then(() => {
            if (!cancelled) stripFipiInlineLayoutStyles(el);
          })
          .catch(() => {});
      } else {
        setTimeout(run, 100);
      }
    };
    run();
    return () => {
      cancelled = true;
    };
  }, [html, ogeInf13Enhance]);

  useEffect(() => {
    if (!onImageClick || !ref.current) return;
    const el = ref.current;
    const imgs = el.querySelectorAll("img");
    const handlers = [];
    imgs.forEach((img) => {
      if (img.closest(".task-img-zoomable")) return;
      const wrap = document.createElement("span");
      wrap.className = "task-img-zoomable";
      img.parentNode?.insertBefore(wrap, img);
      wrap.appendChild(img);
      const hint = document.createElement("span");
      hint.className = "task-img-zoom-hint";
      hint.setAttribute("aria-hidden", "true");
      hint.setAttribute("role", "button");
      hint.setAttribute("title", "Увеличить");
      hint.innerHTML = `<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="11" cy="11" r="8"/><path d="m21 21-4.35-4.35"/></svg>`;
      wrap.appendChild(hint);
      const openLightbox = (e) => {
        e.preventDefault();
        e.stopPropagation();
        const targetImg = wrap.querySelector("img");
        if (targetImg) onImageClick(targetImg.src || targetImg.getAttribute("src"));
      };
      wrap.addEventListener("click", openLightbox);
      hint.addEventListener("click", openLightbox);
      handlers.push({ wrap, hint, handler: openLightbox });
    });
    return () =>
      handlers.forEach(({ wrap, hint, handler }) => {
        wrap.removeEventListener("click", handler);
        hint.removeEventListener("click", handler);
      });
  }, [html, onImageClick, ogeInf13Enhance]);

  return <div ref={ref} className={className} />;
}

export const MathContent = memo(MathContentInner);
export default MathContent;
