/**
 * Ссылки и точки входа для страницы «Для учителей».
 * Вынесены в отдельный модуль, чтобы их было удобно править из одного места.
 */

/** Сообщество учителей в Telegram. */
export const TEACHERS_TELEGRAM_URL = "https://t.me/itfluxacademy";

/** Сообщество учителей во ВКонтакте. */
export const TEACHERS_VK_URL = "https://vk.com/itfluxacademy";

/**
 * Эндпоинт приёма заявок учителей.
 * Пока backend не готов — оставляем `null`, форма работает в режиме заглушки
 * (валидация + локальное сохранение черновика + success-state).
 * Когда API появится, укажите путь, например "/api/teacher-applications/".
 */
export const TEACHER_APPLICATION_ENDPOINT: string | null = null;

/** Ключ localStorage для черновика/резервной копии заявки до подключения backend. */
export const TEACHER_APPLICATION_DRAFT_KEY = "teacher_application_draft";
