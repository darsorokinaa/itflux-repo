import { createContext, useContext, useEffect, useMemo } from "react";
import { CLASSIC_VARIANT_THEME, resolveVariantTheme } from "./registry";
import ThemeEffects from "./ThemeEffects";
import ThemeDecorations from "./ThemeDecorations";
import "./variant-themes.css";

const VariantThemeContext = createContext(CLASSIC_VARIANT_THEME);
const LAYOUT_CLASSES = ["variant-theme--route", "variant-theme--classic", "variant-theme--cards", "variant-theme--game"];
const SLUG_PREFIX = "variant-theme-slug--";

const PAGE_BG_PROPS = [
  "background-image",
  "background-size",
  "background-repeat",
  "background-attachment",
  "background-position",
  "background-color",
];

function stripThemeClasses(node) {
  node.classList.remove("variant-theme-active", ...LAYOUT_CLASSES);
  [...node.classList].forEach((cls) => {
    if (cls.startsWith(SLUG_PREFIX)) node.classList.remove(cls);
  });
}

function clearPageBackground(node) {
  stripThemeClasses(node);
  if (node.dataset) delete node.dataset.variantTheme;
  node.style.removeProperty("--variant-theme-bg-image");
  node.style.removeProperty("--variant-theme-block-bg-image");
  node.style.removeProperty("--variant-theme-bg-color");
  PAGE_BG_PROPS.forEach((prop) => node.style.removeProperty(prop));
}

function fallbackGradient(background) {
  const colors = Array.isArray(background?.colors)
    ? background.colors.filter((item) => /^#([0-9a-f]{3}|[0-9a-f]{6})$/i.test(item))
    : [];
  if (background?.type === "gradient" && colors.length >= 2) {
    const joined = colors.join(", ");
    if (background.direction === "radial") return `radial-gradient(ellipse at 50% 0%, ${joined})`;
    if (background.direction === "sunset") return `linear-gradient(160deg, ${joined})`;
    if (background.direction === "sunrise") return `linear-gradient(20deg, ${joined})`;
    if (background.direction === "horizontal") return `linear-gradient(90deg, ${joined})`;
    return `linear-gradient(180deg, ${joined})`;
  }
  return "linear-gradient(180deg, #9fc8e4 0%, #c5e0f2 42%, #e7f3fb 100%)";
}

function applyPageBackground(node, { pageImage, color, background }) {
  const wash = "linear-gradient(rgba(255, 255, 255, 0.22), rgba(255, 255, 255, 0.3))";
  const image = pageImage || fallbackGradient(background);
  node.style.setProperty("background-image", `${wash}, ${image}`, "important");
  node.style.setProperty("background-size", pageImage ? "auto, cover" : "auto, 100% 100%", "important");
  node.style.setProperty("background-repeat", "no-repeat", "important");
  node.style.setProperty("background-attachment", "fixed", "important");
  node.style.setProperty("background-position", "center, center top", "important");
  node.style.setProperty("background-color", color, "important");
}

export function useVariantTheme() {
  return useContext(VariantThemeContext) || CLASSIC_VARIANT_THEME;
}

export function useVariantThemeLabels() {
  return useVariantTheme().labels || CLASSIC_VARIANT_THEME.labels;
}

function themeSlugClass(slug) {
  const safe = String(slug || "").replace(/[^a-z0-9-]/gi, "");
  return safe ? `variant-theme-slug--${safe}` : "";
}

function cssImageUrl(url) {
  let safe = String(url || "").replace(/["'\\)]/g, "").trim();
  if (!safe) return "";
  try {
    const parsed = new URL(safe, typeof window !== "undefined" ? window.location.origin : "http://localhost");
    if (parsed.pathname.startsWith("/media/")) {
      safe = `${parsed.pathname}${parsed.search}`;
    }
  } catch {
    /* keep original */
  }
  return `url("${safe}")`;
}

export function VariantThemeRoot({ payload, children }) {
  const theme = useMemo(() => resolveVariantTheme(payload), [payload]);

  useEffect(() => {
    const nodes = [
      document.documentElement,
      document.body,
      typeof document !== "undefined" ? document.getElementById("root") : null,
    ].filter(Boolean);
    const layoutClass = `variant-theme--${theme.layoutType}`;
    const slugClass = themeSlugClass(theme.slug);
    const activeClass = "variant-theme-active";
    const extraClasses = [activeClass, layoutClass, slugClass].filter(Boolean);

    const clearNode = (node) => {
      clearPageBackground(node);
    };

    if (theme.isClassic) {
      nodes.forEach(clearNode);
      return undefined;
    }

    const pageImage = cssImageUrl(theme.background.url);
    const blockImage = cssImageUrl(theme.background.blockUrl);
    const color = theme.background.color || "#cfe8f6";
    nodes.forEach((node) => {
      node.classList.add(...extraClasses);
      if (node.dataset) node.dataset.variantTheme = theme.slug || theme.layoutType;
      if (pageImage) node.style.setProperty("--variant-theme-bg-image", pageImage);
      else node.style.removeProperty("--variant-theme-bg-image");
      if (blockImage) node.style.setProperty("--variant-theme-block-bg-image", blockImage);
      else node.style.removeProperty("--variant-theme-block-bg-image");
      node.style.setProperty("--variant-theme-bg-color", color);
      applyPageBackground(node, { pageImage, color, background: theme.background });
    });
    return () => {
      nodes.forEach(clearNode);
    };
  }, [theme]);

  return (
    <VariantThemeContext.Provider value={theme}>
      {children}
      {!theme.isClassic ? (
        <>
          <ThemeDecorations decorations={theme.decorations} layoutType={theme.layoutType} />
          <ThemeEffects type={theme.animation} />
        </>
      ) : null}
    </VariantThemeContext.Provider>
  );
}
