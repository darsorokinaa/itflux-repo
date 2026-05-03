import { useEffect } from "react";

/**
 * Лайтбокс: клик по картинке — увеличенный просмотр на затемнённом фоне.
 * Закрытие: клик по overlay, Escape.
 */
export default function ImageLightbox({ src, open, onClose }) {
  useEffect(() => {
    if (!open) return;
    const handleKey = (e) => {
      if (e.key === "Escape") onClose();
    };
    document.addEventListener("keydown", handleKey);
    document.body.style.overflow = "hidden";
    return () => {
      document.removeEventListener("keydown", handleKey);
      document.body.style.overflow = "";
    };
  }, [open, onClose]);

  if (!open || !src) return null;

  return (
    <div
      className="image-lightbox-overlay"
      onClick={onClose}
      role="button"
      tabIndex={-1}
      aria-label="Закрыть просмотр"
    >
      <div className="image-lightbox-content" onClick={(e) => e.stopPropagation()}>
        <img src={src} alt="Увеличенное изображение" className="image-lightbox-img" />
      </div>
    </div>
  );
}
