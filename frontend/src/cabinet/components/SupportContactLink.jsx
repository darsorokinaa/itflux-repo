import { openSupport } from "../support";

/**
 * Вторичная текстовая ссылка «Связаться с поддержкой».
 * Открывает тот же SupportModal, что и кнопка в меню.
 */
export default function SupportContactLink({
  children = "Связаться с поддержкой",
  className = "cb-support-link",
  onClick,
}) {
  return (
    <button
      type="button"
      className={className}
      onClick={(e) => {
        onClick?.(e);
        if (!e.defaultPrevented) openSupport();
      }}
    >
      {children}
    </button>
  );
}
