/**
 * r73: где показывать баннер cookie.
 *
 * Баннер fixed внизу (z-index 9999). На странице урока он лежит поверх iframe
 * рабочей области и перехватывает клики по нижней части материала — в т.ч. по
 * «Завершить вариант» (на ноутбуке и в узком окне кнопка оказывается под ним,
 * клик уходит в баннер, «ничего не происходит»). z-index тут не поможет:
 * содержимое iframe — другой документ. Поэтому в комнате урока, в редакторе
 * доски и внутри любого iframe баннер не показываем; согласие спросим на
 * обычных страницах.
 */
export function isEmbeddedWindow(win = typeof window !== "undefined" ? window : undefined) {
  if (!win) return false;
  try {
    return win.self !== win.top;
  } catch {
    // cross-origin parent — точно iframe
    return true;
  }
}

export function shouldShowCookieBanner({
  cookieAccepted = false,
  isLessonOrHomeworkContext = false,
  isChromelessPage = false,
  isVideoMeetingPage = false,
  isBoardEditorPage = false,
  inIframe = false,
} = {}) {
  if (cookieAccepted) return false;
  if (isLessonOrHomeworkContext || isChromelessPage) return false;
  if (isVideoMeetingPage || isBoardEditorPage) return false;
  if (inIframe) return false;
  return true;
}
