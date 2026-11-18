/** Тексты и адреса SEO-лендингов. Совпадают с Generator/seo_landings.py. */

export const SEO_LANDINGS = {
  "generator-variantov-ege-informatika": {
    h1: "Генератор вариантов ЕГЭ по информатике",
    description:
      "Соберите пример варианта ЕГЭ по информатике из задач открытого банка. Условия можно смотреть без регистрации, ответы и решения на странице не показываются.",
    kind: "variant",
  },
  "generator-variantov-oge-matematika": {
    h1: "Генератор вариантов ОГЭ по математике",
    description:
      "Соберите пример варианта ОГЭ по математике из задач открытого банка. Гость видит условия заданий без регистрации, без ответов и решений.",
    kind: "variant",
  },
  "gotovye-uroki-po-matematike": {
    h1: "Готовые уроки по математике",
    description:
      "Опубликованные уроки по математике из каталога: тема и краткое описание открыты без входа. Файл урока доступен после регистрации.",
    kind: "lessons",
  },
  "interaktivnye-zadaniya-oge-ege-informatika": {
    h1: "Интерактивные задания ОГЭ/ЕГЭ по информатике",
    description:
      "Открытые тренажёры по информатике для ОГЭ и ЕГЭ. Бесплатный интерактив из каталога можно пройти без регистрации.",
    kind: "interactive",
  },
  "onlajn-doska-dlya-repetitora-matematiki": {
    h1: "Онлайн-доска для репетитора математики",
    description:
      "Доска для занятия по математике в браузере: рисуйте и стирайте без регистрации. Рисунок остаётся на этом устройстве и не сохраняется на сервере.",
    kind: "board",
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
