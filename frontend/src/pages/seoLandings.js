/** Тексты и адреса SEO-лендингов. Совпадают с Generator/seo_landings.py. */

const BRAND = "Цифровой поток";

function titled(h1) {
  return `${h1} — ${BRAND}`;
}

export const SEO_LANDINGS = {
  "generator-variantov-ege-informatika": {
    h1: "Генератор вариантов ЕГЭ по информатике",
    title: titled("Генератор вариантов ЕГЭ по информатике"),
    description:
      "Соберите пример из нескольких заданий ЕГЭ по информатике без регистрации. На странице только условия, без ответов и решений.",
    kind: "variant",
    h2: "Пример из банка заданий",
    note: "Это несколько заданий из банка платформы, не полный вариант ЕГЭ. Ответы и решения скрыты.",
    ctaNote: "Чтобы собрать полный вариант и открыть ответы, зарегистрируйтесь.",
  },
  "generator-variantov-oge-matematika": {
    h1: "Генератор вариантов ОГЭ по математике",
    title: titled("Генератор вариантов ОГЭ по математике"),
    description:
      "Для урока с учеником: пример из нескольких заданий ОГЭ по математике без регистрации. На странице только условия, без ответов и решений.",
    kind: "variant",
    h2: "Пример из банка заданий",
    note: "Это несколько заданий из банка платформы, не полный вариант ОГЭ. Ответы и решения скрыты.",
    ctaNote: "Это не полный вариант ОГЭ. Чтобы собрать полный вариант и открыть ответы, зарегистрируйтесь.",
  },
  "gotovye-uroki-po-matematike": {
    h1: "Готовые уроки по математике для ОГЭ и ЕГЭ",
    title: `Готовые уроки по математике ОГЭ и ЕГЭ — ${BRAND}`,
    description:
      "Готовые уроки по математике ОГЭ и ЕГЭ: тему и описание смотрите без регистрации. Файл открывается после входа, если урок в каталоге бесплатный.",
    kind: "lessons",
    h2: "Примеры уроков по математике",
    note: "Ниже карточки уроков из каталога. Файл открывается после входа, если урок бесплатный.",
    ctaNote: "",
  },
  "interaktivnye-zadaniya-oge-ege-informatika": {
    h1: "Интерактивные задания ОГЭ и ЕГЭ по информатике",
    title: `Тренажёры ОГЭ и ЕГЭ по информатике — ${BRAND}`,
    description:
      "Тренажёры по информатике к заданиям ЕГЭ и ОГЭ. Бесплатные из каталога можно пройти без регистрации.",
    kind: "interactive",
    h2: "Тренажёр из каталога",
    note: "Без регистрации доступны только бесплатные тренажёры. Состав номеров меняется вместе с каталогом.",
    ctaNote: "",
  },
  "onlajn-doska-dlya-repetitora-matematiki": {
    h1: "Онлайн-доска для репетитора математики",
    title: titled("Онлайн-доска для репетитора математики"),
    description:
      "Онлайн-доска для репетитора математики: рисуйте в браузере без регистрации. Это демо — рисунок только на этом устройстве и стирается при обновлении.",
    kind: "board",
    h2: "Демо онлайн-доски",
    note: "",
    extra: "В кабинете репетитора — доска для урока с сохранением.",
    ctaNote: "",
  },
};

export function seoLandingSlug(pathname) {
  const path = String(pathname || "/").replace(/\/+$/, "") || "/";
  const slug = path.replace(/^\//, "");
  return Object.prototype.hasOwnProperty.call(SEO_LANDINGS, slug) ? slug : "";
}

export function isSeoLandingPath(pathname) {
  return Boolean(seoLandingSlug(pathname));
}

export function seoRegisterPath(slug) {
  const params = new URLSearchParams();
  params.set("mode", "register");
  params.set("role", "teacher");
  params.set("utm_source", "seo");
  params.set("utm_medium", "landing");
  params.set("utm_campaign", slug);
  return `/cabinet/login?${params.toString()}`;
}
