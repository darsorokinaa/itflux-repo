/**
 * Статичные декоративные изображения темы (pointer-events: none, кроме click_url).
 */
export default function SeasonalThemeDecorations({
  decorations,
  intensity,
  isMobile,
  animationsEnabled,
  pathname,
}) {
  if (!Array.isArray(decorations) || !decorations.length || intensity === "off") {
    return null;
  }

  const isTablet = !isMobile && typeof window !== "undefined" && window.matchMedia("(max-width: 1024px)").matches;

  const visible = decorations.filter((d) => {
    if (!d?.image_url) return false;
    if (isMobile && !d.show_mobile) return false;
    if (!isMobile && isTablet && !d.show_tablet) return false;
    if (!isMobile && !isTablet && !d.show_desktop) return false;
    if (d.zone === "custom_routes") {
      const routes = d.custom_routes || [];
      if (!routes.length) return false;
      return routes.some((r) => pathname === r || pathname.startsWith(r));
    }
    return true;
  });

  if (!visible.length) return null;

  return (
    <div className="seasonal-decor-layer" aria-hidden="true">
      {visible.map((d) => {
        const animType = d.animation?.type;
        const delay = Math.max(Number(d.animation?.delay) || 0, 0);
        const style = {
          width: d.width || "80px",
          height: d.height || "auto",
          opacity: d.opacity ?? 0.85,
          zIndex: d.z_index ?? 1,
          ["--seasonal-decor-x"]: d.offset_x || "0",
          ["--seasonal-decor-y"]: d.offset_y || "0",
          // fade_in в админке по умолчанию 6с (как цикл sway) — для появления это слишком долго
          animationDuration: animType === "fade_in"
            ? "0.4s"
            : `${d.animation?.speed || 6}s`,
          animationDelay: animType === "fade_in"
            ? `${Math.min(delay, 0.15)}s`
            : `${delay}s`,
        };
        const animClass =
          animationsEnabled && d.animation?.type && d.animation.type !== "none"
            ? `seasonal-decor--${d.animation.type}`
            : "";
        const posClass = `seasonal-decor--pos-${d.position || "top-right"}`;
        const img = (
          <img
            src={d.image_url}
            alt=""
            loading="eager"
            decoding="async"
            draggable={false}
          />
        );
        if (d.click_url) {
          return (
            <a
              key={d.id}
              className={`seasonal-decor ${posClass} ${animClass} seasonal-decor--clickable`.trim()}
              href={d.click_url}
              style={style}
              target="_blank"
              rel="noopener noreferrer"
              aria-label={d.name || "Декор"}
            >
              {img}
            </a>
          );
        }
        return (
          <div
            key={d.id}
            className={`seasonal-decor ${posClass} ${animClass}`.trim()}
            style={style}
          >
            {img}
          </div>
        );
      })}
    </div>
  );
}
