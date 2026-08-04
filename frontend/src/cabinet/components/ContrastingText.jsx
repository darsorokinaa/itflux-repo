import { createElement } from "react";
import { resolveTextBackdrop, isAutoTextBackdropEnabled, parseCssColor } from "../interactiveContrast";

/**
 * Text with automatic contrast backdrop when sitting on images / toned backgrounds.
 */
export default function ContrastingText({
  as = "span",
  children,
  color,
  className = "",
  autoBackdrop,
  interactive,
  style,
  ...rest
}) {
  const enabled = autoBackdrop != null
    ? autoBackdrop
    : isAutoTextBackdropEnabled(interactive);

  const resolvedColor = color
    || (typeof style?.color === "string" ? style.color : null)
    || "var(--ix-tone-text, #0f172a)";

  const parsed = parseCssColor(resolvedColor);
  const backdrop = resolveTextBackdrop(
    parsed ? `rgb(${parsed.r}, ${parsed.g}, ${parsed.b})` : resolvedColor,
    { enabled },
  );

  const combinedClass = [className, backdrop.className].filter(Boolean).join(" ");
  const combinedStyle = {
    ...style,
    ...(color ? { color } : null),
    ...(enabled ? backdrop.style : null),
  };

  return createElement(as, { className: combinedClass, style: combinedStyle, ...rest }, children);
}
