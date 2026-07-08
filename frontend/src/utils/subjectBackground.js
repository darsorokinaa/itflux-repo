/**
 * @param {{ background_color?: string, background_image_url?: string, backgroundColor?: string, backgroundImageUrl?: string } | null | undefined} data
 */
export function subjectThemeFromApi(data) {
  if (!data) return null;
  const backgroundColor = String(data.background_color || data.backgroundColor || "").trim();
  const backgroundImageUrl = String(data.background_image_url || data.backgroundImageUrl || "").trim();
  if (!backgroundColor && !backgroundImageUrl) return null;
  return {
    ...(backgroundColor ? { backgroundColor } : {}),
    ...(backgroundImageUrl ? { backgroundImageUrl } : {}),
  };
}

/**
 * CSS-переменные темы предмета для страницы варианта (только фон hero, без смены акцентов).
 * @param {{ backgroundColor?: string, backgroundImageUrl?: string } | null | undefined} theme
 */
export function subjectThemeCssVars(theme) {
  if (!theme) return null;
  const imageUrl = String(theme.backgroundImageUrl || "").trim();
  if (!imageUrl) return null;
  return {
    "--exam-hero-bg-image": `url("${imageUrl}")`,
  };
}

/**
 * Inline-стили фона предмета из API (картинка приоритетнее цвета).
 * @param {{ backgroundColor?: string, backgroundImageUrl?: string } | null | undefined} bg
 * @returns {import('react').CSSProperties}
 */
export function subjectBackgroundStyle(bg) {
  if (!bg) return {};
  const imageUrl = String(bg.backgroundImageUrl || "").trim();
  const color = String(bg.backgroundColor || "").trim();
  if (imageUrl) {
    return {
      backgroundImage: `url("${imageUrl}")`,
      backgroundSize: "cover",
      backgroundPosition: "center",
      backgroundRepeat: "no-repeat",
    };
  }
  if (color) {
    return { background: color };
  }
  return {};
}

/**
 * @param {{ backgroundImageUrl?: string } | null | undefined} bg
 */
export function hasSubjectBackgroundImage(bg) {
  return Boolean(String(bg?.backgroundImageUrl || "").trim());
}
