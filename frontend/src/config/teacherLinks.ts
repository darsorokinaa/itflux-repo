/**
 * Ссылки и точки входа для страницы сообщества учителей.
 */

/** Основной канал «Цифровой поток» в Telegram. */
export const TEACHERS_TELEGRAM_CHANNEL_URL = "https://t.me/itfluxacademy";

/** Сообщество «Учительская» в Telegram. */
export const TEACHERS_TELEGRAM_CHAT_URL = "https://t.me/c/itfluxchat/262";

/** @deprecated используйте TEACHERS_TELEGRAM_CHANNEL_URL */
export const TEACHERS_TELEGRAM_URL = TEACHERS_TELEGRAM_CHANNEL_URL;

/** Сообщество учителей во ВКонтакте. */
export const TEACHERS_VK_URL = "https://vk.com/itfluxacademy";

/** Эндпоинт формы обратной связи сообщества. */
export const TEACHER_COMMUNITY_FEEDBACK_ENDPOINT = "/api/teacher-community-feedback/";

/** Legacy-эндпоинт старой заявки (не используется на новой странице). */
export const TEACHER_APPLICATION_ENDPOINT = "/api/teacher-applications/";

export const TEACHER_APPLICATION_DRAFT_KEY = "teacher_application_draft";
export const TEACHER_FEEDBACK_DRAFT_KEY = "teacher_community_feedback_draft";
