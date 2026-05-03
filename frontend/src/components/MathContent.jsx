import { useEffect, useRef } from "react";

/**
 * Рендерит HTML с поддержкой LaTeX/MathJax. На любой странице MathJax
 * корректно отображает формулы.
 * @param {Function} onImageClick - опционально: (src) => {} при клике по картинке
 */
export function MathContent({ html, className, onImageClick }) {
  const ref = useRef(null);

  useEffect(() => {
    if (!ref.current) return;
    ref.current.innerHTML = (html != null ? String(html) : "") || "";
    const el = ref.current;

    const run = () => {
      if (window.MathJax?.typesetPromise) {
        window.MathJax.typesetPromise([el]).catch(() => {});
      } else {
        const id = setTimeout(run, 100);
        return () => clearTimeout(id);
      }
    };
    run();
  }, [html]);

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
  }, [html, onImageClick]);

  return <div ref={ref} className={className} />;
}

export default MathContent;
