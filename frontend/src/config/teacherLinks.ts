/**
 * Ссылки и точки входа для страницы «Для учителей».
 * Вынесены в отдельный модуль, чтобы их было удобно править из одного места.
 */

/** Сообщество учителей в Telegram. */
export const TEACHERS_TELEGRAM_URL = "https://t.me/itfluxacademy";

/** Сообщество учителей во ВКонтакте. */
export const TEACHERS_VK_URL = "https://vk.com/itfluxacademy";

/** Эндпоинт приёма заявок учителей (Django). */
export const TEACHER_APPLICATION_ENDPOINT = "/api/teacher-applications/";

/** Ключ localStorage для резервной копии заявки при сбое сети. */
export const TEACHER_APPLICATION_DRAFT_KEY = "teacher_application_draft";
