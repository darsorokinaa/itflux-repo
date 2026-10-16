import { createElement } from "react";
import { DefaultCursor } from "@tldraw/editor";

/** Относительная яркость sRGB (WCAG) для #rgb/#rrggbb/rgb(). null — цвет не распознан. */
export function colorLuminance(color) {
  const text = String(color || "").trim();
  let r;
  let g;
  let b;
  let m = text.match(/^#([0-9a-f]{3})$/i);
  if (m) [r, g, b] = m[1].split("").map((c) => parseInt(c + c, 16));
  m = m || text.match(/^#([0-9a-f]{6})/i);
  if (r === undefined && m) [r, g, b] = [0, 2, 4].map((i) => parseInt(m[1].slice(i, i + 2), 16));
  const rgb = text.match(/^rgba?\(\s*(\d+)[,\s]+(\d+)[,\s]+(\d+)/i);
  if (r === undefined && rgb) [r, g, b] = rgb.slice(1, 4).map(Number);
  if (r === undefined) return null;
  const lin = (v) => {
    const c = v / 255;
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b);
}

/** Тёмный текст на светлой плашке, белый — на тёмной. */
export function nametagTextColor(background) {
  const lum = colorLuminance(background);
  if (lum === null) return "#fff";
  return lum > 0.4 ? "#111" : "#fff";
}

/** Курсор участника: плашка с именем в цвете пера, текст подбирается по контрасту. */
export function LessonCursor(props) {
  return createElement(
    "div",
    { className: "lesson-cursor", style: { display: "contents", "--lesson-nametag-text": nametagTextColor(props.color) } },
    createElement(DefaultCursor, props),
  );
}
