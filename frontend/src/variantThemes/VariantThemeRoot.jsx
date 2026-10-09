import { createContext, useContext, useEffect, useMemo, useState } from "react";
import { CLASSIC_VARIANT_THEME, resolveVariantTheme } from "./registry";
import ThemeEffects from "./ThemeEffects";
import ThemeDecorations from "./ThemeDecorations";
import { BLOCK_IMAGE_OPACITY, orientedImageUrl, pageBackgroundStyle } from "./themeSurface";
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
  node.classList.remove("variant-theme-active", "variant-theme-has-block-image", ...LAYOUT_CLASSES);
  [...node.classList].forEach((cls) => {
    if (cls.startsWith(SLUG_PREFIX)) node.classList.remove(cls);
  });
}

function clearPageBackground(node) {
  stripThemeClasses(node);
  if (node.dataset) delete node.dataset.variantTheme;
  node.style.removeProperty("--variant-theme-bg-image");
  node.style.removeProperty("--variant-theme-block-bg-image");
  node.style.removeProperty("--variant-theme-block-opacity");
  node.style.removeProperty("--variant-theme-bg-color");
  PAGE_BG_PROPS.forEach((prop) => node.style.removeProperty(prop));
}

function applyPageBackground(node, { pageImageUrl, background }) {
  const style = pageBackgroundStyle(background, pageImageUrl);
  node.style.setProperty("background-image", style.backgroundImage, "important");
  node.style.setProperty("background-size", style.backgroundSize, "important");
  node.style.setProperty("background-repeat", style.backgroundRepeat, "important");
  node.style.setProperty("background-attachment", "fixed", "important");
  node.style.setProperty("background-position", style.backgroundPosition, "important");
  node.style.setProperty("background-color", style.backgroundColor, "important");
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

function safeAssetUrl(url) {
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
  return safe;
}

function cssImageUrl(url) {
  const safe = safeAssetUrl(url);
  return safe ? `url("${safe}")` : "";
}

export function VariantThemeRoot({ payload, children }) {
  const theme = useMemo(() => resolveVariantTheme(payload), [payload]);
  const [orientation, setOrientation] = useState("horizontal");

  useEffect(() => {
    const media = window.matchMedia("(orientation: portrait)");
    const apply = () => setOrientation(media.matches ? "vertical" : "horizontal");
    apply();
    media.addEventListener("change", apply);
    return () => media.removeEventListener("change", apply);
  }, []);

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

    const pageImageUrl = safeAssetUrl(orientedImageUrl(theme.background.url, theme.background.urlVertical, orientation));
    const hasPageImage = Boolean(pageImageUrl);
    const hasPaint = hasPageImage || ["color", "gradient", "image"].includes(theme.background.type);
    if (theme.isClassic && !hasPaint) {
      nodes.forEach(clearNode);
      return undefined;
    }

    const blockImage = cssImageUrl(theme.background.blockUrl);
    const painted = pageBackgroundStyle(theme.background, pageImageUrl);
    nodes.forEach((node) => {
      node.classList.add(...extraClasses);
      if (blockImage) node.classList.add("variant-theme-has-block-image");
      if (node.dataset) node.dataset.variantTheme = theme.slug || theme.layoutType;
      if (painted.backgroundImage) node.style.setProperty("--variant-theme-bg-image", painted.backgroundImage);
      else node.style.removeProperty("--variant-theme-bg-image");
      if (blockImage) node.style.setProperty("--variant-theme-block-bg-image", blockImage);
      else node.style.removeProperty("--variant-theme-block-bg-image");
      node.style.setProperty("--variant-theme-block-opacity", String(BLOCK_IMAGE_OPACITY));
      node.style.setProperty("--variant-theme-bg-color", painted.backgroundColor);
      applyPageBackground(node, { pageImageUrl, background: theme.background });
    });
    return () => {
      nodes.forEach(clearNode);
    };
  }, [orientation, theme]);

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
