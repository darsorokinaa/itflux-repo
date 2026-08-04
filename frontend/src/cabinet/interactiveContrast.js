/**
 * Color contrast utilities for interactive text/background readability.
 * Supports HEX, RGB/RGBA, named colors, and CSS variables (best-effort).
 */

const NAMED_COLORS = {
  white: "#ffffff",
  black: "#000000",
  red: "#ff0000",
  green: "#008000",
  blue: "#0000ff",
  yellow: "#ffff00",
  cyan: "#00ffff",
  magenta: "#ff00ff",
  gray: "#808080",
  grey: "#808080",
  silver: "#c0c0c0",
  maroon: "#800000",
  olive: "#808000",
  navy: "#000080",
  purple: "#800080",
  teal: "#008080",
  orange: "#ffa500",
  transparent: null,
};

const CSS_VAR_FALLBACKS = {
  "--ix-tone-text": "#0f172a",
  "--ix-tone-text-secondary": "#475569",
  "--ix-tone-text-muted": "#64748b",
  "--ix-tone-text-soft": "rgba(15, 23, 42, 0.78)",
};

function clampByte(n) {
  return Math.max(0, Math.min(255, Math.round(n)));
}

function channelToLinear(c) {
  const s = c / 255;
  return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
}

/**
 * Parse a CSS color string into { r, g, b, a } or null.
 */
export function parseCssColor(input) {
  if (input == null) return null;
  let raw = String(input).trim().toLowerCase();
  if (!raw) return null;

  if (raw.startsWith("var(")) {
    const match = raw.match(/var\(\s*([^,\s)]+)(?:\s*,\s*([^)]+))?\)/);
    if (!match) return null;
    const fallback = match[2]?.trim();
    const known = CSS_VAR_FALLBACKS[match[1].trim()];
    return parseCssColor(fallback || known || null);
  }

  if (NAMED_COLORS[raw] !== undefined) {
    if (NAMED_COLORS[raw] == null) return { r: 0, g: 0, b: 0, a: 0 };
    return parseCssColor(NAMED_COLORS[raw]);
  }

  if (raw.startsWith("#")) {
    let hex = raw.slice(1);
    if (hex.length === 3 || hex.length === 4) {
      hex = hex.split("").map((ch) => ch + ch).join("");
    }
    if (hex.length === 6 || hex.length === 8) {
      const r = parseInt(hex.slice(0, 2), 16);
      const g = parseInt(hex.slice(2, 4), 16);
      const b = parseInt(hex.slice(4, 6), 16);
      const a = hex.length === 8 ? parseInt(hex.slice(6, 8), 16) / 255 : 1;
      if ([r, g, b].some((n) => Number.isNaN(n))) return null;
      return { r, g, b, a };
    }
    return null;
  }

  const rgbMatch = raw.match(/^rgba?\(\s*([^)]+)\)$/);
  if (rgbMatch) {
    const parts = rgbMatch[1].split(/[\s,/]+/).filter(Boolean);
    if (parts.length < 3) return null;
    const nums = parts.map((p, i) => {
      if (p.endsWith("%")) {
        const pct = parseFloat(p);
        return i < 3 ? (pct / 100) * 255 : pct / 100;
      }
      return parseFloat(p);
    });
    if (nums.slice(0, 3).some((n) => Number.isNaN(n))) return null;
    return {
      r: clampByte(nums[0]),
      g: clampByte(nums[1]),
      b: clampByte(nums[2]),
      a: nums[3] != null && !Number.isNaN(nums[3]) ? nums[3] : 1,
    };
  }

  return null;
}

/** Relative luminance (WCAG), 0–1. */
export function relativeLuminance(color) {
  const parsed = typeof color === "object" && color != null && "r" in color
    ? color
    : parseCssColor(color);
  if (!parsed || parsed.a === 0) return null;
  const r = channelToLinear(parsed.r);
  const g = channelToLinear(parsed.g);
  const b = channelToLinear(parsed.b);
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

/** True when color is perceptually light. */
export function isLightColor(color, threshold = 0.55) {
  const L = relativeLuminance(color);
  if (L == null) return false;
  return L >= threshold;
}

/** True when color is perceptually dark. */
export function isDarkColor(color, threshold = 0.55) {
  const L = relativeLuminance(color);
  if (L == null) return true;
  return L < threshold;
}

/**
 * Contrast ratio between two colors (WCAG), or null if either unparsable.
 */
export function contrastRatio(fg, bg) {
  const L1 = relativeLuminance(fg);
  const L2 = relativeLuminance(bg);
  if (L1 == null || L2 == null) return null;
  const lighter = Math.max(L1, L2);
  const darker = Math.min(L1, L2);
  return (lighter + 0.05) / (darker + 0.05);
}

/**
 * Pick black or white text for a background.
 */
export function getContrastingTextColor(backgroundColor, options = {}) {
  const { light = "#ffffff", dark = "#0f172a", threshold = 0.55 } = options;
  return isLightColor(backgroundColor, threshold) ? dark : light;
}

/**
 * Resolve backdrop style for text that may sit on images/gradients.
 * Light text → dark translucent plate; dark text → light translucent plate.
 */
export function resolveTextBackdrop(textColor, options = {}) {
  const {
    enabled = true,
    lightTextBackdrop = "rgba(0, 0, 0, 0.62)",
    darkTextBackdrop = "rgba(255, 255, 255, 0.84)",
    padding = "0.35em 0.7em",
    borderRadius = "10px",
    blur = true,
  } = options;

  if (!enabled) {
    return {
      needed: false,
      style: {},
      className: "",
      backdrop: null,
      textIsLight: isLightColor(textColor),
    };
  }

  const textIsLight = isLightColor(textColor);
  const backdrop = textIsLight ? lightTextBackdrop : darkTextBackdrop;
  const style = {
    background: backdrop,
    padding,
    borderRadius,
    display: "inline-block",
    maxWidth: "100%",
    boxDecorationBreak: "clone",
    WebkitBoxDecorationBreak: "clone",
  };
  if (blur) {
    style.backdropFilter = "blur(8px)";
    style.WebkitBackdropFilter = "blur(8px)";
  }

  return {
    needed: true,
    style,
    className: textIsLight ? "ix-text-backdrop ix-text-backdrop--dark" : "ix-text-backdrop ix-text-backdrop--light",
    backdrop,
    textIsLight,
  };
}

/**
 * Warn when text/background contrast is below WCAG AA for normal text (4.5).
 */
export function getContrastWarning(textColor, backgroundColor, minRatio = 4.5) {
  const ratio = contrastRatio(textColor, backgroundColor);
  if (ratio == null) return null;
  if (ratio >= minRatio) return null;
  return {
    ratio: Math.round(ratio * 100) / 100,
    message: `Низкий контраст текста (${Math.round(ratio * 10) / 10}:1). Включена автоматическая подложка.`,
  };
}

/**
 * Whether auto text backdrop should be on (default true for legacy data).
 */
export function isAutoTextBackdropEnabled(interactiveOrParams) {
  if (!interactiveOrParams || typeof interactiveOrParams !== "object") return true;
  if ("autoTextBackdrop" in interactiveOrParams) {
    return interactiveOrParams.autoTextBackdrop !== false;
  }
  if (interactiveOrParams.params && "autoTextBackdrop" in interactiveOrParams.params) {
    return interactiveOrParams.params.autoTextBackdrop !== false;
  }
  return true;
}
