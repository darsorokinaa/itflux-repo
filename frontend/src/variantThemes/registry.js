export const DEFAULT_VARIANT_THEME_LABELS = {
  task: "Задание",
  tasks: "Задания",
  next: "Следующее",
  previous: "Назад",
  finish: "Завершить вариант",
};

export const VARIANT_THEME_LAYOUTS = ["classic", "cards", "route", "game"];
export const IMPLEMENTED_VARIANT_THEME_LAYOUTS = ["classic", "route"];
export const VARIANT_THEME_ANIMATIONS = [
  "none",
  "falling-leaves",
  "snow",
  "floating-stars",
  "plane-route",
  "travel-route",
  "clouds",
];
export const VARIANT_THEME_DECORATIONS = [
  "clouds",
  "route",
  "plane",
  "leaves",
  "stars",
  "map",
  "camera",
  "backpack",
  "compass",
  "suitcase",
  "postcard",
  "passport",
  "airplane",
  "route-dots",
  "mountains",
  "sea",
  "sailboats",
  "flowers",
];

export const CLASSIC_VARIANT_THEME = {
  id: null,
  slug: "classic",
  name: "",
  layoutType: "classic",
  labels: { ...DEFAULT_VARIANT_THEME_LABELS },
  decorations: [],
  animation: "none",
  background: { type: "none", color: "", url: "", blockUrl: "", colors: [], direction: "" },
  previewImageUrl: "",
  isClassic: true,
};

export const variantThemeRegistry = {
  classic: { layout: "classic" },
  travel: { layout: "route", decorations: ["clouds", "route", "plane", "map"] },
  route: { layout: "route" },
};

function pickLabels(raw) {
  const src = raw && typeof raw === "object" ? raw : {};
  const labels = { ...DEFAULT_VARIANT_THEME_LABELS };
  for (const key of Object.keys(DEFAULT_VARIANT_THEME_LABELS)) {
    const value = typeof src[key] === "string" ? src[key].trim() : "";
    if (value) labels[key] = value.slice(0, 60);
  }
  return labels;
}

export function resolveVariantTheme(payload) {
  if (!payload || typeof payload !== "object") {
    return CLASSIC_VARIANT_THEME;
  }

  const slug = String(payload.slug || "").trim().toLowerCase();
  const rawLayout = String(payload.layout_type || payload.layoutType || "").trim().toLowerCase();
  const entry = variantThemeRegistry[slug] || variantThemeRegistry[rawLayout] || null;
  const layoutType = entry?.layout || rawLayout;
  const implemented = IMPLEMENTED_VARIANT_THEME_LAYOUTS.includes(layoutType);
  if (!implemented) {
    return CLASSIC_VARIANT_THEME;
  }

  const config = payload.config && typeof payload.config === "object" ? payload.config : {};
  const backgroundSrc = config.background && typeof config.background === "object" ? config.background : {};
  const decorations = Array.isArray(config.decorations)
    ? config.decorations.map((item) => String(item || "").toLowerCase()).filter((item) => VARIANT_THEME_DECORATIONS.includes(item))
    : (entry?.decorations || []);
  const animation = VARIANT_THEME_ANIMATIONS.includes(String(config.animation || "").toLowerCase())
    ? String(config.animation).toLowerCase()
    : "none";

  return {
    id: payload.id ?? null,
    slug: slug || layoutType,
    name: String(payload.name || "").trim(),
    layoutType,
    labels: pickLabels(config.labels),
    decorations,
    animation,
    background: {
      type: ["image", "color", "gradient"].includes(String(backgroundSrc.type || ""))
        ? String(backgroundSrc.type)
        : "none",
      color: String(backgroundSrc.color || ""),
      url: String(payload.background_image_url || payload.backgroundImageUrl || backgroundSrc.url || ""),
      blockUrl: String(payload.block_background_image_url || payload.blockBackgroundImageUrl || ""),
      colors: Array.isArray(backgroundSrc.colors)
        ? backgroundSrc.colors.map((item) => String(item || "")).filter((item) => /^#([0-9a-f]{3}|[0-9a-f]{6})$/i.test(item))
        : [],
      direction: String(backgroundSrc.direction || ""),
    },
    previewImageUrl: String(payload.preview_image_url || payload.previewImageUrl || ""),
    isClassic: layoutType === "classic",
  };
}
