/**
 * Зачистка висячих <span> после flatten ФИПИ.
 * Не трогаем </span> у span с class= (math-inline, math-display и др.).
 */
export function repairOrphanSpanTags(raw) {
  if (typeof raw !== "string" || !raw) return raw;
  return raw
    .replace(/(<(?:p|div|td|th|li|h[1-6])\b[^>]*>)\s*<\/span>/gi, "$1")
    .replace(/<span>\s*(<\/(?:p|div|td|th|li|h[1-6])>)/gi, "$1")
    .replace(/<\/span>\s*<span>/gi, " ")
    .replace(/<span>\s*(?=<\/)/gi, "")
    .replace(/<\/span>(?=\s*[^<])/gi, (match, offset, str) => {
      const before = str.slice(0, offset);
      const lastOpen = before.lastIndexOf("<span");
      const lastClose = before.lastIndexOf("</span>");
      if (lastOpen > lastClose) {
        const gt = before.indexOf(">", lastOpen);
        if (gt !== -1) {
          const openTag = before.slice(lastOpen, gt + 1);
          if (/\bclass\s*=/i.test(openTag)) return match;
        }
      }
      return " ";
    });
}
