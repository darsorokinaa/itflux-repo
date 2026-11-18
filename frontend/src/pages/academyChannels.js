/** Каналы онлайн-академии. Только подвал /academy, не подвал платформы.
 *  Пустая строка — ссылку не показываем.
 */

export const ACADEMY_TELEGRAM_URL = "https://t.me/+euR2vXJwj201N2Iy";
export const ACADEMY_VK_URL = "https://vk.ru/club243179171";
/** Адрес канала MAX. Пустая строка скрывает ссылку в подвале академии. */
export const ACADEMY_MAX_URL = "https://max.ru/join/WDCMDl6TEwYOQx6oAYKSB0MotkcpP7fv2uhTBM73OSo";

function channel(id, label, href) {
  const url = String(href || "").trim();
  if (!url) return null;
  return { id, label, href: url, text: url.replace(/^https?:\/\//, "") };
}

export function academyChannels({
  telegram = ACADEMY_TELEGRAM_URL,
  vk = ACADEMY_VK_URL,
  max = ACADEMY_MAX_URL,
} = {}) {
  return [
    channel("telegram", "Telegram", telegram),
    channel("vk", "ВКонтакте", vk),
    channel("max", "MAX", max),
  ].filter(Boolean);
}

export const ACADEMY_CHANNELS = academyChannels();
