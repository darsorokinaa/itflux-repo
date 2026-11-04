/** r147: признак встроенной доски из «Доска рядом». */
export function isVariantEmbed(search) {
  try {
    const q = search ?? (typeof window !== "undefined" ? window.location.search : "");
    return new URLSearchParams(q).get("embed") === "variant";
  } catch {
    return false;
  }
}
