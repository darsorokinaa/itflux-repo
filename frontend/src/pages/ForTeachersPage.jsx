import { useCallback, useEffect, useRef, useState } from "react";
import {
  BookOpen,
  Check,
  CheckCircle2,
  ChevronDown,
  CircleAlert,
  ClipboardList,
  FileText,
  FolderOpen,
  Gamepad2,
  Gift,
  GraduationCap,
  Lightbulb,
  MessageCircle,
  Package,
  Presentation,
  Send,
  Sparkles,
  Sun,
  Target,
  Ticket,
  Users,
  Wrench,
} from "lucide-react";
import {
  TEACHERS_TELEGRAM_URL,
  TEACHERS_VK_URL,
  TEACHER_APPLICATION_DRAFT_KEY,
  TEACHER_APPLICATION_ENDPOINT,
} from "../config/teacherLinks";
import { SUMMER_CLUB_TAGLINE, SUMMER_CLUB_URL } from "../config/summerClub";

const PAGE_TITLE = "Для учителей — Цифровой поток";
const PAGE_DESCRIPTION =
  "Страница для учителей информатики: как присоединиться к платформе «Цифровой поток», предложить задачи, уроки, презентации, методические материалы и стать частью профессионального сообщества.";

const ANCHOR_NAV = [
  { id: "what", label: "Что это" },
  { id: "summer-club", label: "Летний клуб" },
  { id: "help", label: "Как помочь" },
  { id: "materials", label: "Материалы" },
  { id: "formats", label: "Форматы участия" },
  { id: "apply", label: "Заявка" },
  { id: "faq", label: "FAQ" },
];

const SUMMER_CLUB_BONUSES = [
  {
    title: "Промокод для учеников",
    text: "Учитель получает персональный промокод, по которому ученики могут записаться в клуб со скидкой.",
    Icon: Ticket,
  },
  {
    title: "Доступ к материалам",
    text: "За рекомендации можно получить доступ к новым урокам, презентациям, задачам и методическим материалам «Цифрового потока».",
    Icon: FolderOpen,
  },
  {
    title: "Методический набор",
    text: "Учитель может получить готовые материалы для занятий: презентации, рабочие листы, подборки задач и идеи проектных уроков.",
    Icon: Package,
  },
];

const HERO_CARDS = [
  { title: "Готовые уроки", tag: "ОГЭ · ЕГЭ", Icon: BookOpen },
  { title: "Задачи ЕГЭ", tag: "База заданий", Icon: Target },
  { title: "Презентации", tag: "Визуальные материалы", Icon: Presentation },
  { title: "Интерактивы", tag: "Тренажёры", Icon: Sparkles },
  { title: "Ответы и методика", tag: "Разборы", Icon: ClipboardList },
  { title: "Сообщество учителей", tag: "Профессионалы", Icon: Users },
];

const PLATFORM_CARDS = [
  { title: "Готовые уроки", text: "Структурированные материалы для занятия — от теории до практики.", Icon: BookOpen },
  { title: "База задач", text: "Задания по темам, типам и уровням сложности для ОГЭ и ЕГЭ.", Icon: Target },
  { title: "Презентации", text: "Визуальные материалы для объяснения сложных тем.", Icon: Presentation },
  { title: "Интерактивные тренажёры", text: "Практика в формате, который помогает закрепить материал.", Icon: Sparkles },
  { title: "Ответы и разборы", text: "Проверенные решения и пояснения к типовым заданиям.", Icon: ClipboardList },
  { title: "Материалы для учителя и ученика", text: "Рабочие листы, сценарии и методические заметки.", Icon: FileText },
];

const WHY_CARDS = [
  {
    title: "Экономить время",
    text: "Не собирать каждый урок с нуля, а опираться на готовую структуру, задачи и визуальные материалы.",
    Icon: BookOpen,
    tone: "blue",
  },
  {
    title: "Делиться опытом",
    text: "Ваши задачи, объяснения и методические находки могут помочь другим учителям и ученикам.",
    Icon: Users,
    tone: "olive",
  },
  {
    title: "Влиять на развитие платформы",
    text: "Учителя лучше всех видят, каких материалов не хватает, где ученики ошибаются и какие темы требуют сильной подачи.",
    Icon: Lightbulb,
    tone: "sand",
  },
  {
    title: "Получать доступ к новым материалам",
    text: "Участники сообщества смогут первыми видеть новые уроки, тестировать интерактивы и предлагать улучшения.",
    Icon: Sparkles,
    tone: "blue",
  },
  {
    title: "Стать автором",
    text: "Если у вас есть сильные материалы, можно обсудить авторское участие в развитии платформы.",
    Icon: GraduationCap,
    tone: "olive",
  },
];

const HELP_ITEMS = [
  {
    title: "Прислать свои задачи",
    text: "Можно предложить авторские задачи по информатике: для ОГЭ, ЕГЭ, тематических уроков, олимпиадной подготовки или программирования.",
  },
  {
    title: "Сообщить об ошибке",
    text: "Если вы нашли неточность в ответе, формулировке, таблице, рисунке или решении, можно отправить правку. Это помогает поддерживать качество базы.",
  },
  {
    title: "Предложить тему урока",
    text: "Если вы видите, что учителям не хватает урока по конкретной теме, можно предложить её для разработки.",
  },
  {
    title: "Поделиться презентацией или методикой",
    text: "Можно предложить свою структуру объяснения, сценарий урока, презентацию, рабочий лист или идею интерактива.",
  },
  {
    title: "Стать тестировщиком",
    text: "Можно смотреть новые материалы до публикации и давать обратную связь: понятно ли, удобно ли, хватает ли задач.",
  },
  {
    title: "Стать автором платформы",
    text: "Если вы хотите системно создавать материалы для «Цифрового потока», можно оставить заявку на авторское участие.",
  },
];

const MATERIAL_CHIPS = [
  "авторские задачи",
  "подборки задач по темам",
  "ответы к задачам",
  "разборы решений",
  "презентации",
  "рабочие листы",
  "сценарии уроков",
  "идеи интерактивов",
  "методические заметки",
  "таблицы, схемы, графы",
  "тренажёры",
  "замечания по уже опубликованным материалам",
];

const STEPS = [
  {
    title: "Вы оставляете заявку",
    text: "Указываете, чем хотите помочь: задачами, методикой, проверкой, идеями или авторскими материалами.",
  },
  {
    title: "Мы связываемся с вами",
    text: "Уточняем формат участия, темы и удобный способ коммуникации.",
  },
  {
    title: "Вы отправляете материал или идею",
    text: "Это может быть одна задача, подборка, презентация, комментарий к ошибке или предложение по новому уроку.",
  },
  {
    title: "Материал проходит проверку",
    text: "После проверки он может быть добавлен на платформу с указанием авторства, если это согласовано.",
  },
];

const AUDIENCE = [
  "учителям информатики в школе",
  "репетиторам по ОГЭ и ЕГЭ",
  "преподавателям программирования",
  "авторам учебных материалов",
  "методистам",
  "тем, кто хочет развивать качественные материалы по информатике",
];

const FORMATS = [
  { kicker: "Формат 1", title: "Разово", text: "Прислать одну задачу, идею, ошибку или предложение." },
  { kicker: "Формат 2", title: "Иногда", text: "Периодически помогать с проверкой, идеями и обратной связью." },
  { kicker: "Формат 3", title: "Как автор", text: "Системно создавать материалы для платформы: уроки, задачи, презентации, тренажёры." },
  {
    kicker: "Формат 4",
    title: "Как участник сообщества",
    text: "Обсуждать темы, делиться опытом и видеть развитие проекта изнутри.",
  },
];

const FAQ_ITEMS = [
  {
    q: "Можно ли просто сообщить об ошибке?",
    a: "Да. Даже одна найденная неточность помогает сделать платформу полезнее.",
  },
  {
    q: "Обязательно ли присылать большие материалы?",
    a: "Нет. Можно начать с одной задачи, идеи урока или короткого комментария.",
  },
  {
    q: "Будет ли указано авторство?",
    a: "Если материал публикуется на платформе и авторство согласовано, его можно указать.",
  },
  {
    q: "Можно ли стать автором платформы?",
    a: "Да. Если вы хотите системно создавать материалы, оставьте заявку — мы обсудим формат участия.",
  },
  {
    q: "Какие материалы подходят?",
    a: "Задачи, подборки, презентации, рабочие листы, сценарии уроков, интерактивы, методические идеи и правки к уже опубликованным материалам.",
  },
  {
    q: "Нужно ли платить за участие в сообществе?",
    a: "Нет, заявка на участие и предложение материалов бесплатны.",
  },
];

const ROLE_OPTIONS = [
  { value: "teacher", label: "Учитель" },
  { value: "tutor", label: "Репетитор" },
  { value: "methodist", label: "Методист" },
  { value: "author", label: "Автор материалов" },
  { value: "other", label: "Другое" },
];

const HELP_OPTIONS = [
  { value: "tasks", label: "Прислать задачи" },
  { value: "error", label: "Сообщить об ошибке" },
  { value: "lesson", label: "Предложить урок" },
  { value: "presentation", label: "Поделиться презентацией" },
  { value: "author", label: "Стать автором" },
  { value: "tester", label: "Тестировать материалы" },
  { value: "other", label: "Другое" },
];

const EMPTY_FORM = {
  name: "",
  contact: "",
  role: "",
  teaches: "",
  help: [],
  comment: "",
  materialsUrl: "",
};

function iconToneClass(tone) {
  if (tone === "olive") return "t-card__icon--olive";
  if (tone === "sand") return "t-card__icon--sand";
  return "";
}

function scrollToSection(id) {
  const el = document.getElementById(id);
  if (!el) return;
  el.scrollIntoView({ behavior: "smooth", block: "start" });
}

function usePageMeta() {
  useEffect(() => {
    const prevTitle = document.title;
    let meta = document.querySelector('meta[name="description"]');
    const createdMeta = !meta;
    if (!meta) {
      meta = document.createElement("meta");
      meta.setAttribute("name", "description");
      document.head.appendChild(meta);
    }
    const prevDesc = meta.getAttribute("content") ?? "";

    document.title = PAGE_TITLE;
    meta.setAttribute("content", PAGE_DESCRIPTION);

    return () => {
      document.title = prevTitle;
      if (createdMeta) {
        meta.remove();
      } else {
        meta.setAttribute("content", prevDesc);
      }
    };
  }, []);
}

function useAnchorNav() {
  const [activeId, setActiveId] = useState(ANCHOR_NAV[0].id);

  useEffect(() => {
    const ids = ANCHOR_NAV.map((item) => item.id);
    const sections = ids
      .map((id) => document.getElementById(id))
      .filter(Boolean);

    if (!sections.length) return undefined;

    const observer = new IntersectionObserver(
      (entries) => {
        const visible = entries
          .filter((e) => e.isIntersecting)
          .sort((a, b) => b.intersectionRatio - a.intersectionRatio);
        if (visible[0]?.target?.id) {
          setActiveId(visible[0].target.id);
        }
      },
      { rootMargin: "-20% 0px -55% 0px", threshold: [0.1, 0.35, 0.6] }
    );

    sections.forEach((section) => observer.observe(section));
    return () => observer.disconnect();
  }, []);

  return activeId;
}

function HeroDecor() {
  return (
    <div className="t-hero__decor" aria-hidden="true">
      <svg viewBox="0 0 640 420" fill="none" xmlns="http://www.w3.org/2000/svg">
        <path
          d="M40 280 C120 180, 200 340, 300 240 S480 120, 600 200"
          stroke="currentColor"
          strokeWidth="1.5"
          strokeDasharray="6 8"
          opacity="0.35"
        />
        <path
          d="M80 120 C180 60, 260 180, 380 100 S520 40, 580 90"
          stroke="currentColor"
          strokeWidth="1"
          strokeDasharray="4 6"
          opacity="0.25"
        />
        <circle cx="300" cy="240" r="6" fill="currentColor" opacity="0.4" />
        <circle cx="480" cy="120" r="4" fill="currentColor" opacity="0.3" />
        <circle cx="120" cy="180" r="5" fill="currentColor" opacity="0.35" />
      </svg>
    </div>
  );
}

function AnchorNav({ activeId }) {
  return (
    <nav className="t-anchornav" aria-label="Навигация по странице">
      <div className="t-anchornav__inner">
        {ANCHOR_NAV.map((item) => (
          <a
            key={item.id}
            href={`#${item.id}`}
            className={`t-anchornav__link${activeId === item.id ? " is-active" : ""}`}
            onClick={(e) => {
              e.preventDefault();
              scrollToSection(item.id);
            }}
          >
            {item.label}
          </a>
        ))}
      </div>
    </nav>
  );
}

function FaqAccordion() {
  const [openIndex, setOpenIndex] = useState(null);

  return (
    <div className="t-faq">
      {FAQ_ITEMS.map((item, index) => {
        const isOpen = openIndex === index;
        const panelId = `faq-panel-${index}`;
        const btnId = `faq-btn-${index}`;
        return (
          <div key={item.q} className={`t-faq__item${isOpen ? " is-open" : ""}`}>
            <button
              type="button"
              id={btnId}
              className="t-faq__q"
              aria-expanded={isOpen}
              aria-controls={panelId}
              onClick={() => setOpenIndex(isOpen ? null : index)}
            >
              <span>{item.q}</span>
              <ChevronDown className="t-faq__icon" aria-hidden="true" />
            </button>
            {isOpen ? (
              <div id={panelId} role="region" aria-labelledby={btnId} className="t-faq__a">
                {item.a}
              </div>
            ) : null}
          </div>
        );
      })}
    </div>
  );
}

function ApplicationForm() {
  const [form, setForm] = useState(EMPTY_FORM);
  const [errors, setErrors] = useState({});
  const [submitting, setSubmitting] = useState(false);
  const [status, setStatus] = useState(null);
  const [submitError, setSubmitError] = useState("");
  const successRef = useRef(null);

  const updateField = useCallback((field, value) => {
    setForm((prev) => ({ ...prev, [field]: value }));
    setErrors((prev) => {
      if (!prev[field]) return prev;
      const next = { ...prev };
      delete next[field];
      return next;
    });
  }, []);

  const toggleHelp = useCallback((value) => {
    setForm((prev) => {
      const has = prev.help.includes(value);
      const help = has ? prev.help.filter((v) => v !== value) : [...prev.help, value];
      return { ...prev, help };
    });
    setErrors((prev) => {
      if (!prev.help) return prev;
      const next = { ...prev };
      delete next.help;
      return next;
    });
  }, []);

  const validate = useCallback(() => {
    const next = {};
    if (!form.name.trim()) next.name = "Укажите имя";
    if (!form.contact.trim()) next.contact = "Укажите email или Telegram";
    if (!form.role) next.role = "Выберите, кто вы";
    if (!form.help.length) next.help = "Выберите хотя бы один вариант";
    return next;
  }, [form]);

  const handleSubmit = async (e) => {
    e.preventDefault();
    setSubmitError("");
    const nextErrors = validate();
    if (Object.keys(nextErrors).length) {
      setErrors(nextErrors);
      return;
    }

    setSubmitting(true);
    const payload = {
      ...form,
      name: form.name.trim(),
      contact: form.contact.trim(),
      teaches: form.teaches.trim(),
      comment: form.comment.trim(),
      materialsUrl: form.materialsUrl.trim(),
      submittedAt: new Date().toISOString(),
    };

    const getCsrfToken = () => {
      const match = document.cookie.match(/(?:^|;\s*)csrftoken=([^;]+)/);
      return match ? decodeURIComponent(match[1]) : "";
    };

    try {
      if (!TEACHER_APPLICATION_ENDPOINT) {
        try {
          localStorage.setItem(TEACHER_APPLICATION_DRAFT_KEY, JSON.stringify(payload));
        } catch {
          /* ignore quota errors */
        }
        setStatus("unavailable");
        window.setTimeout(() => successRef.current?.focus(), 50);
        return;
      }

      if (!getCsrfToken()) {
        await fetch("/api/csrf/", { credentials: "same-origin" });
      }
      const csrf = getCsrfToken();
      const res = await fetch(TEACHER_APPLICATION_ENDPOINT, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Accept: "application/json",
          ...(csrf ? { "X-CSRFToken": csrf } : {}),
        },
        credentials: "same-origin",
        body: JSON.stringify(payload),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.error || err.detail || "Не удалось отправить заявку");
      }
      try {
        localStorage.removeItem(TEACHER_APPLICATION_DRAFT_KEY);
      } catch {
        /* ignore */
      }
      setStatus("success");
      setForm(EMPTY_FORM);
      window.setTimeout(() => successRef.current?.focus(), 50);
    } catch (err) {
      try {
        localStorage.setItem(TEACHER_APPLICATION_DRAFT_KEY, JSON.stringify(payload));
      } catch {
        /* ignore */
      }
      setStatus("error");
      setSubmitError(err instanceof Error ? err.message : "Не удалось отправить заявку");
    } finally {
      setSubmitting(false);
    }
  };

  if (status === "unavailable") {
    return (
      <div
        className="t-form t-form-state"
        role="status"
        aria-live="polite"
        ref={successRef}
        tabIndex={-1}
      >
        <div className="t-form-state__icon" aria-hidden="true">
          <CircleAlert />
        </div>
        <h3 className="t-form-state__title">Автоотправка пока недоступна</h3>
        <p className="t-form-state__text">
          Форма заявки ещё не подключена к серверу. Черновик сохранён в браузере —
          напишите нам в сообществе, и мы свяжемся с вами.
        </p>
        <div className="t-form-state__links" style={{ display: "flex", flexWrap: "wrap", gap: "12px", justifyContent: "center" }}>
          <a
            href={TEACHERS_TELEGRAM_URL}
            className="t-btn t-btn--primary"
            target="_blank"
            rel="noopener noreferrer"
          >
            Telegram
          </a>
          <a
            href={TEACHERS_VK_URL}
            className="t-btn t-btn--secondary"
            target="_blank"
            rel="noopener noreferrer"
          >
            ВКонтакте
          </a>
        </div>
        <button
          type="button"
          className="t-btn t-btn--secondary"
          onClick={() => {
            setStatus(null);
            setErrors({});
          }}
        >
          Вернуться к форме
        </button>
      </div>
    );
  }

  if (status === "success") {
    return (
      <div
        className="t-form t-form-state"
        role="status"
        aria-live="polite"
        ref={successRef}
        tabIndex={-1}
      >
        <div className="t-form-state__icon t-form-state__icon--ok" aria-hidden="true">
          <CheckCircle2 />
        </div>
        <h3 className="t-form-state__title">Спасибо!</h3>
        <p className="t-form-state__text">
          Заявка отправлена. Мы свяжемся с вами в ближайшее время.
        </p>
        <button
          type="button"
          className="t-btn t-btn--secondary"
          onClick={() => {
            setStatus(null);
            setErrors({});
          }}
        >
          Отправить ещё одну заявку
        </button>
      </div>
    );
  }

  return (
    <form className="t-form" onSubmit={handleSubmit} noValidate>
      {status === "error" && submitError ? (
        <div className="t-form-alert" role="alert">
          <CircleAlert aria-hidden="true" />
          <span>{submitError}</span>
        </div>
      ) : null}

      <div className="t-field">
        <label htmlFor="t-name" className="t-field__label">
          Имя<span className="t-field__req" aria-hidden="true">*</span>
        </label>
        <input
          id="t-name"
          type="text"
          className={`t-input${errors.name ? " has-error" : ""}`}
          value={form.name}
          onChange={(e) => updateField("name", e.target.value)}
          autoComplete="name"
          required
        />
        {errors.name ? <span className="t-field__error">{errors.name}</span> : null}
      </div>

      <div className="t-field">
        <label htmlFor="t-contact" className="t-field__label">
          Email или Telegram<span className="t-field__req" aria-hidden="true">*</span>
        </label>
        <input
          id="t-contact"
          type="text"
          className={`t-input${errors.contact ? " has-error" : ""}`}
          value={form.contact}
          onChange={(e) => updateField("contact", e.target.value)}
          autoComplete="email"
          placeholder="example@mail.ru или @username"
          required
        />
        {errors.contact ? <span className="t-field__error">{errors.contact}</span> : null}
      </div>

      <div className="t-field">
        <label htmlFor="t-role" className="t-field__label">
          Кто вы<span className="t-field__req" aria-hidden="true">*</span>
        </label>
        <select
          id="t-role"
          className={`t-select${errors.role ? " has-error" : ""}`}
          value={form.role}
          onChange={(e) => updateField("role", e.target.value)}
          required
        >
          <option value="">Выберите вариант</option>
          {ROLE_OPTIONS.map((opt) => (
            <option key={opt.value} value={opt.value}>
              {opt.label}
            </option>
          ))}
        </select>
        {errors.role ? <span className="t-field__error">{errors.role}</span> : null}
      </div>

      <div className="t-field">
        <label htmlFor="t-teaches" className="t-field__label">
          Что преподаёте<span className="t-field__opt">— необязательно</span>
        </label>
        <input
          id="t-teaches"
          type="text"
          className="t-input"
          value={form.teaches}
          onChange={(e) => updateField("teaches", e.target.value)}
          placeholder="Например: информатика 9–11 класс, ОГЭ, ЕГЭ"
        />
      </div>

      <fieldset className="t-field">
        <legend className="t-field__label">
          Чем хотите помочь<span className="t-field__req" aria-hidden="true">*</span>
        </legend>
        <div className="t-checks">
          {HELP_OPTIONS.map((opt) => (
            <label key={opt.value} className="t-check">
              <input
                type="checkbox"
                checked={form.help.includes(opt.value)}
                onChange={() => toggleHelp(opt.value)}
              />
              <span>{opt.label}</span>
            </label>
          ))}
        </div>
        {errors.help ? <span className="t-field__error">{errors.help}</span> : null}
      </fieldset>

      <div className="t-field">
        <label htmlFor="t-comment" className="t-field__label">
          Комментарий<span className="t-field__opt">— необязательно</span>
        </label>
        <textarea
          id="t-comment"
          className="t-textarea"
          value={form.comment}
          onChange={(e) => updateField("comment", e.target.value)}
          placeholder="Расскажите, чем хотите помочь или что хотите предложить"
          rows={4}
        />
      </div>

      <div className="t-field">
        <label htmlFor="t-materials" className="t-field__label">
          Ссылка на материалы<span className="t-field__opt">— если есть</span>
        </label>
        <input
          id="t-materials"
          type="url"
          className="t-input"
          value={form.materialsUrl}
          onChange={(e) => updateField("materialsUrl", e.target.value)}
          placeholder="https://"
        />
      </div>

      <button type="submit" className="t-btn t-btn--primary t-form__submit" disabled={submitting}>
        {submitting ? "Отправка…" : "Отправить заявку"}
      </button>

      <p className="t-form__legal">
        Нажимая кнопку, вы соглашаетесь с{" "}
        <a href="/privacy">политикой конфиденциальности</a>.
      </p>
    </form>
  );
}

export default function ForTeachersPage() {
  usePageMeta();
  const activeAnchor = useAnchorNav();

  return (
    <div className="teachers-page">
      <section className="t-hero" aria-labelledby="teachers-hero-heading">
        <HeroDecor />
        <div className="teachers-wrap">
          <div className="t-hero__grid">
            <div className="t-hero__copy">
              <span className="t-eyebrow">Сообщество «Цифровой поток»</span>
              <h1 id="teachers-hero-heading" className="t-hero__title">
                Для учителей информатики, которые хотят делать{" "}
                <em>образование сильнее</em>
              </h1>
              <p className="t-hero__lead">
                Цифровой поток — это платформа с задачами, уроками, презентациями и интерактивными
                материалами по информатике. Мы собираем вокруг проекта учителей, которые хотят
                пользоваться качественными материалами, делиться своими наработками и помогать
                платформе расти.
              </p>
              <div className="t-hero__btns">
                <button
                  type="button"
                  className="t-btn t-btn--primary"
                  onClick={() => scrollToSection("apply")}
                >
                  Стать участником
                  <Send className="t-btn-arrow" aria-hidden="true" />
                </button>
                <button
                  type="button"
                  className="t-btn t-btn--secondary"
                  onClick={() => scrollToSection("apply")}
                >
                  Предложить материал
                </button>
              </div>
              <p className="t-hero__note">
                Можно начать с малого: прислать задачу, сообщить об ошибке или предложить тему для
                урока.
              </p>
            </div>

            <div className="t-hero__visual" aria-hidden="true">
              {HERO_CARDS.map(({ title, tag, Icon }) => (
                <div key={title} className="t-mini-card">
                  <div className="t-mini-card__icon">
                    <Icon />
                  </div>
                  <span className="t-mini-card__title">{title}</span>
                  <span className="t-mini-card__tag">{tag}</span>
                </div>
              ))}
            </div>
          </div>
        </div>
      </section>

      <AnchorNav activeId={activeAnchor} />

      <section id="what" className="t-section" aria-labelledby="what-heading">
        <div className="teachers-wrap">
          <header className="t-section-head">
            <h2 id="what-heading" className="t-section-title">
              Что такое «Цифровой поток»
            </h2>
            <p className="t-section-lead">
              Это образовательная платформа для подготовки к ОГЭ, ЕГЭ и обучению информатике, где
              учитель может быстро найти готовый урок, задачу, презентацию, интерактив или
              методический материал. Мы хотим, чтобы подготовка к занятию занимала меньше времени, а
              сам урок становился понятнее, технологичнее и сильнее.
            </p>
          </header>
          <div className="t-grid t-grid--3">
            {PLATFORM_CARDS.map(({ title, text, Icon }) => (
              <article key={title} className="t-card t-card--hover">
                <div className="t-card__icon">
                  <Icon aria-hidden="true" />
                </div>
                <h3 className="t-card__title">{title}</h3>
                <p className="t-card__text">{text}</p>
              </article>
            ))}
          </div>
        </div>
      </section>

      <section className="t-section t-section--alt" aria-labelledby="why-heading">
        <div className="teachers-wrap">
          <header className="t-section-head">
            <h2 id="why-heading" className="t-section-title">
              Зачем учителю участвовать
            </h2>
          </header>
          <div className="t-grid t-grid--3">
            {WHY_CARDS.map(({ title, text, Icon, tone }) => (
              <article key={title} className="t-card t-card--hover">
                <div className={`t-card__icon ${iconToneClass(tone)}`}>
                  <Icon aria-hidden="true" />
                </div>
                <h3 className="t-card__title">{title}</h3>
                <p className="t-card__text">{text}</p>
              </article>
            ))}
          </div>
        </div>
      </section>

      <section id="summer-club" className="t-section sc-club-section" aria-labelledby="summer-club-heading">
        <div className="teachers-wrap">
          <div className="sc-club">
            <div className="sc-club__decor" aria-hidden="true">
              <span className="sc-club__decor-sun" />
              <span className="sc-club__decor-coin" />
              <span className="sc-club__decor-grid" />
            </div>
            <div className="sc-club__body">
              <span className="sc-club__eyebrow">
                <Sun aria-hidden="true" />
                Лето 2026 · проектная летняя практика
              </span>
              <h2 id="summer-club-heading" className="sc-club__title">
                Порекомендуйте ученикам летний IT-клуб
              </h2>
              <p className="sc-club__lead">
                Если среди ваших учеников есть подростки, которым интересны игры, программирование и
                IT, вы можете предложить им проектный летний формат от «Цифрового потока».
              </p>
              <p className="sc-club__text">
                За июль участники создают собственную игру на Godot: персонажа, уровни, монеты,
                препятствия, анимации, звуки и финальный проект. Это не школьный урок летом, а
                спокойная проектная практика, где ребёнок видит результат своей работы.
              </p>

              <div className="sc-club__bonus">
                <span className="sc-club__bonus-badge">
                  <Gift aria-hidden="true" />
                  Бонусы для учителей
                </span>
                <p className="sc-club__bonus-text">
                  Учителя, которые рекомендуют клуб своим ученикам, могут получить благодарность от
                  «Цифрового потока»: персональный промокод для учеников, доступ к материалам
                  платформы или методический набор для занятий.
                </p>
              </div>

              <div className="sc-club__btns">
                <button
                  type="button"
                  className="sc-club-btn sc-club-btn--primary"
                  onClick={() => scrollToSection("apply")}
                >
                  Получить промокод учителя
                </button>
                <a
                  href={SUMMER_CLUB_URL}
                  className="sc-club-btn sc-club-btn--secondary"
                  target="_blank"
                  rel="noopener noreferrer"
                >
                  Открыть страницу клуба
                </a>
              </div>
            </div>

            <aside className="sc-club__card" aria-hidden="true">
              <span className="sc-club__card-badge">☀️ Лето 2026</span>
              <span className="sc-club__card-icon">
                <Gamepad2 />
              </span>
              <strong className="sc-club__card-title">Летний IT-клуб</strong>
              <span className="sc-club__card-text">{SUMMER_CLUB_TAGLINE}</span>
              <ul className="sc-club__card-list">
                <li>Персонаж, уровни и монеты</li>
                <li>Анимации и звуки</li>
                <li>Готовый проект к концу июля</li>
              </ul>
            </aside>
          </div>
        </div>
      </section>

      <section
        id="teacher-bonuses"
        className="t-section t-section--alt sc-bonuses-section"
        aria-labelledby="bonuses-heading"
      >
        <div className="teachers-wrap">
          <header className="t-section-head">
            <span className="t-eyebrow">
              <Gift aria-hidden="true" />
              Бонусы для учителей
            </span>
            <h2 id="bonuses-heading" className="t-section-title">
              Возможные бонусы для учителей
            </h2>
            <p className="t-section-lead">
              Благодарность за рекомендацию клуба ученикам — на выбор учителя.
            </p>
          </header>
          <div className="t-grid t-grid--3">
            {SUMMER_CLUB_BONUSES.map(({ title, text, Icon }) => (
              <article key={title} className="sc-bonus-card">
                <div className="sc-bonus-card__icon">
                  <Icon aria-hidden="true" />
                </div>
                <h3 className="sc-bonus-card__title">{title}</h3>
                <p className="sc-bonus-card__text">{text}</p>
              </article>
            ))}
          </div>
          <p className="sc-bonuses-note">
            Формат благодарности обсуждается индивидуально: можно выбрать промокод, доступ к
            платформе или методические материалы.
          </p>
        </div>
      </section>

      <section id="help" className="t-section" aria-labelledby="help-heading">
        <div className="teachers-wrap">
          <header className="t-section-head">
            <h2 id="help-heading" className="t-section-title">
              Как учитель может помочь
            </h2>
          </header>
          <div className="t-help-grid">
            {HELP_ITEMS.map((item, index) => (
              <article key={item.title} className="t-help-card">
                <span className="t-help-card__num" aria-hidden="true">
                  {index + 1}
                </span>
                <div>
                  <h3 className="t-help-card__title">{item.title}</h3>
                  <p className="t-help-card__text">{item.text}</p>
                </div>
              </article>
            ))}
          </div>
        </div>
      </section>

      <section id="materials" className="t-section t-section--alt" aria-labelledby="materials-heading">
        <div className="teachers-wrap">
          <header className="t-section-head">
            <h2 id="materials-heading" className="t-section-title">
              Что можно прислать
            </h2>
          </header>
          <div className="t-chips" role="list">
            {MATERIAL_CHIPS.map((chip) => (
              <span key={chip} className="t-chip" role="listitem">
                <span className="t-chip__dot" aria-hidden="true" />
                {chip}
              </span>
            ))}
          </div>
          <p className="t-note">
            <Wrench aria-hidden="true" />
            <span>
              Материалы проходят проверку перед публикацией. Это нужно, чтобы база оставалась
              точной, понятной и полезной для учителей.
            </span>
          </p>
        </div>
      </section>

      <section className="t-section" aria-labelledby="process-heading">
        <div className="teachers-wrap">
          <header className="t-section-head">
            <h2 id="process-heading" className="t-section-title">
              Как всё устроено
            </h2>
          </header>
          <div className="t-steps">
            {STEPS.map((step, index) => (
              <article key={step.title} className="t-step">
                <span className="t-step__num" aria-hidden="true">
                  {index + 1}
                </span>
                <h3 className="t-step__title">{step.title}</h3>
                <p className="t-step__text">{step.text}</p>
              </article>
            ))}
          </div>
        </div>
      </section>

      <section className="t-section t-section--alt" aria-labelledby="audience-heading">
        <div className="teachers-wrap">
          <header className="t-section-head">
            <h2 id="audience-heading" className="t-section-title">
              Кому подойдёт участие
            </h2>
          </header>
          <ul className="t-audience">
            {AUDIENCE.map((item) => (
              <li key={item}>
                <span className="t-audience__mark" aria-hidden="true">
                  <Check />
                </span>
                {item}
              </li>
            ))}
          </ul>
        </div>
      </section>

      <section className="t-section t-section--tight">
        <div className="teachers-wrap">
          <div className="t-why">
            <h2 className="t-why__title">Почему мы собираем учителей вокруг платформы</h2>
            <p className="t-why__text">
              Хорошая образовательная платформа не может развиваться в отрыве от практики. Именно
              учителя каждый день видят реальные ошибки учеников, слабые места в темах, неудобные
              формулировки и нехватку материалов. Поэтому «Цифровой поток» развивается как проект, в
              котором важен голос профессионального сообщества.
            </p>
          </div>
        </div>
      </section>

      <section id="formats" className="t-section t-section--blue" aria-labelledby="formats-heading">
        <div className="teachers-wrap">
          <header className="t-section-head">
            <h2 id="formats-heading" className="t-section-title">
              Можно выбрать удобный формат
            </h2>
          </header>
          <div className="t-grid t-grid--4">
            {FORMATS.map((item) => (
              <article key={item.title} className="t-format-card">
                <span className="t-format-card__kicker">{item.kicker}</span>
                <h3 className="t-format-card__title">{item.title}</h3>
                <p className="t-format-card__text">{item.text}</p>
              </article>
            ))}
          </div>
        </div>
      </section>

      <section className="t-section" aria-labelledby="join-heading">
        <div className="teachers-wrap">
          <div className="t-cta">
            <h2 id="join-heading" className="t-cta__title">
              Хотите помочь платформе или стать частью сообщества?
            </h2>
            <p className="t-cta__text">
              Оставьте заявку или перейдите в сообщество учителей. Можно начать с простого сообщения:
              кто вы, что преподаёте и чем хотите поделиться.
            </p>
            <div className="t-cta__btns">
              <button
                type="button"
                className="t-btn t-btn--primary"
                onClick={() => scrollToSection("apply")}
              >
                Оставить заявку
              </button>
              <a
                href={TEACHERS_TELEGRAM_URL}
                className="t-btn t-btn--ghost"
                target="_blank"
                rel="noopener noreferrer"
              >
                <MessageCircle className="t-btn-arrow" aria-hidden="true" />
                Вступить в сообщество
              </a>
              <button
                type="button"
                className="t-btn t-btn--ghost"
                onClick={() => scrollToSection("apply")}
              >
                Предложить материал
              </button>
            </div>
          </div>
        </div>
      </section>

      <section id="apply" className="t-section t-section--alt" aria-labelledby="apply-heading">
        <div className="teachers-wrap">
          <div className="t-form-wrap">
            <div className="t-form-side">
              <h2 id="apply-heading" className="t-form-side__title">
                Оставить заявку
              </h2>
              <p className="t-form-side__text">
                Расскажите, кто вы и чем хотите помочь. Можно начать с одной задачи, идеи урока или
                короткого комментария — мы ответим и подскажем удобный формат участия.
              </p>
              <ul className="t-form-side__list">
                <li>
                  <Check aria-hidden="true" />
                  <span>Заявка бесплатна — без скрытых условий</span>
                </li>
                <li>
                  <Check aria-hidden="true" />
                  <span>Можно выбрать разовый или постоянный формат</span>
                </li>
                <li>
                  <Check aria-hidden="true" />
                  <span>
                    Или напишите в{" "}
                    <a href={TEACHERS_TELEGRAM_URL} target="_blank" rel="noopener noreferrer">
                      Telegram
                    </a>{" "}
                    /{" "}
                    <a href={TEACHERS_VK_URL} target="_blank" rel="noopener noreferrer">
                      ВКонтакте
                    </a>
                  </span>
                </li>
              </ul>
            </div>
            <ApplicationForm />
          </div>
        </div>
      </section>

      <section id="faq" className="t-section" aria-labelledby="faq-heading">
        <div className="teachers-wrap">
          <header className="t-section-head">
            <h2 id="faq-heading" className="t-section-title">
              Частые вопросы
            </h2>
          </header>
          <FaqAccordion />
        </div>
      </section>

      <footer className="t-pagefoot">
        <div className="teachers-wrap">
          <p>
            Сообщество «Цифровой поток»:{" "}
            <a href={TEACHERS_TELEGRAM_URL} target="_blank" rel="noopener noreferrer">
              Telegram
            </a>
            {" · "}
            <a href={TEACHERS_VK_URL} target="_blank" rel="noopener noreferrer">
              ВКонтакте
            </a>
            {" · "}
            <a href={SUMMER_CLUB_URL} target="_blank" rel="noopener noreferrer">
              Летний IT-клуб
            </a>
          </p>
        </div>
      </footer>
    </div>
  );
}
