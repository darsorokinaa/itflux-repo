/**
 * Единый источник публичных контактов поддержки.
 *
 * Значения по умолчанию заданы ниже. Переопределение без правки кода — через VITE_*:
 *
 *   VITE_SUPPORT_TELEGRAM          — username без @ или полный https://t.me/…
 *   VITE_SUPPORT_EMAIL             — публичный email поддержки
 *   VITE_SUPPORT_VK                — URL VK
 *   VITE_SUPPORT_TELEGRAM_CHAT     — Telegram в блоке «Социальные сети»
 *   VITE_SUPPORT_TELEGRAM_CHANNEL  — канал (опционально) в блоке «Социальные сети»
 */

import {
  TEACHERS_TELEGRAM_CHAT_URL,
  TEACHERS_VK_URL,
} from "./teacherLinks";

/** Личный Telegram для связи по поддержке. */
export const SUPPORT_TELEGRAM_DEFAULT = "dariyasorokinaa";

/** Публичный email поддержки. */
export const SUPPORT_EMAIL_DEFAULT = "itflux.academy@yandex.ru";

function readEnv(name) {
  try {
    const value = import.meta.env?.[name];
    return typeof value === "string" ? value.trim() : "";
  } catch {
    return "";
  }
}

export function normalizeTelegramUsername(raw) {
  const value = String(raw || "").trim();
  if (!value) return "";
  if (/^https?:\/\//i.test(value)) {
    try {
      const path = new URL(value).pathname.replace(/^\/+/, "").split("/")[0] || "";
      return path.replace(/^@/, "");
    } catch {
      return "";
    }
  }
  return value.replace(/^@/, "");
}

export function telegramHttpsUrl(usernameOrUrl) {
  const raw = String(usernameOrUrl || "").trim();
  if (!raw) return "";
  if (/^https?:\/\//i.test(raw)) return raw;
  const username = normalizeTelegramUsername(raw);
  return username ? `https://t.me/${username}` : "";
}

/**
 * @returns {{
 *   telegram: null | { username: string, display: string, url: string },
 *   email: null | string,
 *   vk: null | { url: string },
 *   social: Array<{ id: string, label: string, url: string }>,
 * }}
 */
export function getSupportContacts() {
  const telegramRaw =
    readEnv("VITE_SUPPORT_TELEGRAM") || SUPPORT_TELEGRAM_DEFAULT;
  const telegramUsername = normalizeTelegramUsername(telegramRaw);
  const telegramUrl = telegramHttpsUrl(telegramRaw);

  const email = readEnv("VITE_SUPPORT_EMAIL") || SUPPORT_EMAIL_DEFAULT;
  const vkUrl = readEnv("VITE_SUPPORT_VK") || TEACHERS_VK_URL;

  const social = [];
  const seen = new Set();

  const addSocial = (id, label, url) => {
    if (!url || url === telegramUrl || seen.has(url)) return;
    seen.add(url);
    social.push({ id, label, url });
  };

  addSocial(
    "telegram-chat",
    "Telegram",
    readEnv("VITE_SUPPORT_TELEGRAM_CHAT") || TEACHERS_TELEGRAM_CHAT_URL,
  );

  const channelUrl = readEnv("VITE_SUPPORT_TELEGRAM_CHANNEL");
  if (channelUrl) {
    addSocial("telegram-channel", "Telegram-канал", channelUrl);
  }

  return {
    telegram:
      telegramUsername && telegramUrl
        ? {
            username: telegramUsername,
            display: `@${telegramUsername}`,
            url: telegramUrl,
          }
        : null,
    email: email || null,
    vk: vkUrl ? { url: vkUrl } : null,
    social,
  };
}

/** Публичные поля, которые можно безопасно отдавать в UI (без секретов). */
export function getPublicSupportContactKeys() {
  return ["telegram", "email", "vk", "social"];
}
