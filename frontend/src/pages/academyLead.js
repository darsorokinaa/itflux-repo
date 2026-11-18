/** Поля и проверка заявки на диагностику. Сообщения совпадают с сервером. */

export { ACADEMY_CONSENT_VERSION, ACADEMY_CONSENT_CHECKBOX_TEXT } from "./academyConsentText";

export const ACADEMY_SUCCESS_MESSAGE =
  "Заявка принята. Я свяжусь с вами, чтобы выбрать время диагностики и рассказать, как подключиться к платформе.";

export const SUBJECTS = [
  { value: "oge_inf", label: "ОГЭ информатика", grades: [9] },
  { value: "ege_inf", label: "ЕГЭ информатика", grades: [10, 11] },
];

const UTM_KEYS = ["utm_source", "utm_medium", "utm_campaign", "utm_content", "utm_term"];
const TELEGRAM_NAME = /^@([A-Za-z][A-Za-z0-9_]{4,31})$/;
const TELEGRAM_LINK = /^(?:https?:\/\/)?(?:t\.me|telegram\.me)\/([A-Za-z][A-Za-z0-9_]{4,31})\/?$/i;
const MISMATCH = "Для 9 класса доступен ОГЭ по информатике, для 10–11 классов — ЕГЭ.";

export function subjectFitsGrade(subject, grade) {
  const item = SUBJECTS.find((row) => row.value === subject);
  const gradeNum = Number(grade);
  if (!item || ![9, 10, 11].includes(gradeNum)) return false;
  return item.grades.includes(gradeNum);
}

function telegramOk(value) {
  return TELEGRAM_NAME.test(value) || TELEGRAM_LINK.test(value);
}

function phoneOk(value) {
  if (/[A-Za-zА-Яа-яЁё]/.test(value)) return false;
  const digits = value.replace(/\D/g, "");
  if (digits.length === 11 && (digits[0] === "7" || digits[0] === "8")) return true;
  if (digits.length === 10 && digits[0] !== "0") return true;
  return value.trim().startsWith("+") && digits.length >= 11 && digits.length <= 15;
}

export function contactError(value) {
  const raw = String(value || "").trim();
  if (!raw) return "Укажите Telegram @username или телефон.";
  if (telegramOk(raw) || phoneOk(raw)) return "";
  return "Проверьте контакт: Telegram в виде @username или номер телефона.";
}

export function validateAcademyForm(form) {
  const errors = {};
  if (!String(form.student_name || "").trim()) errors.student_name = "Укажите имя ученика.";
  const grade = String(form.grade || "");
  if (!["9", "10", "11"].includes(grade)) errors.grade = "Выберите класс.";
  if (!SUBJECTS.some((item) => item.value === form.subject)) {
    errors.subject = "Выберите предмет.";
  } else if (grade && !subjectFitsGrade(form.subject, grade)) {
    errors.subject = MISMATCH;
  }
  const contactProblem = contactError(form.contact);
  if (contactProblem) errors.contact = contactProblem;
  if (String(form.comment || "").length > 4000) errors.comment = "Комментарий слишком длинный.";
  if (!form.consent) errors.consent = "Нужно согласие на обработку персональных данных.";
  return errors;
}

export function collectAcquisition({ search = "", stored = {}, referrer = "" } = {}) {
  const params = new URLSearchParams(search || "");
  const utm = {};
  for (const key of UTM_KEYS) {
    const limit = key === "utm_source" || key === "utm_medium" ? 32 : 64;
    const fromUrl = String(params.get(key) || "").trim();
    const fromStored = String(stored?.[key] || "").trim();
    utm[key] = (fromUrl || fromStored).slice(0, limit);
  }
  const ref = String(referrer || stored?.referrer || "").trim().slice(0, 500);
  return { ...utm, referrer: ref };
}
