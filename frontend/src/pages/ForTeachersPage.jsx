import { useCallback, useEffect, useId, useRef, useState } from "react";
import {
  BookOpen,
  Bug,
  CheckCircle2,
  Code2,
  FlaskConical,
  Lightbulb,
  MessageCircle,
  MessageSquareHeart,
  Palette,
  PenLine,
  School,
  Sparkles,
  Users,
  Wrench,
} from "lucide-react";
import {
  TEACHER_COMMUNITY_FEEDBACK_ENDPOINT,
  TEACHER_FEEDBACK_DRAFT_KEY,
  TEACHERS_TELEGRAM_CHANNEL_URL,
  TEACHERS_TELEGRAM_CHAT_URL,
} from "../config/teacherLinks";

const PAGE_TITLE = "Сообщество учителей — Цифровой поток";
const PAGE_DESCRIPTION =
  "Сообщество преподавателей платформы “Цифровой поток”: новости, отзывы, предложения, тестирование обновлений и участие в развитии проекта";

const FEEDBACK_TYPES = [
  { value: "review", label: "Отзыв о платформе" },
  { value: "feature", label: "Предложение новой функции" },
  { value: "bug", label: "Сообщение об ошибке" },
  { value: "testing", label: "Участие в тестировании" },
  { value: "development", label: "Хочу помочь с разработкой" },
  { value: "methodology", label: "Методическое сотрудничество" },
  { value: "other", label: "Другое" },
];

const TOPIC_CHIPS = [
  { label: "идея новой функции", type: "feature" },
  { label: "ошибка на платформе", type: "bug" },
  { label: "неудобство во время урока", type: "review" },
  { label: "пожелание по интерфейсу", type: "feature" },
  { label: "предложение по материалам", type: "methodology" },
  { label: "идея для интерактива", type: "feature" },
  { label: "отзыв после использования", type: "review" },
  { label: "предложение о сотрудничестве", type: "methodology" },
  { label: "участие в тестировании", type: "testing" },
  { label: "помощь в разработке", type: "development" },
];

const AUDIENCE_CARDS = [
  {
    title: "Репетиторам",
    text: "Расскажите, какие инструменты помогают проводить индивидуальные занятия и чего вам пока не хватает.",
    Icon: PenLine,
  },
  {
    title: "Школьным учителям",
    text: "Поделитесь опытом работы с классами, материалами, домашними заданиями и проверкой работ.",
    Icon: School,
  },
  {
    title: "Преподавателям курсов",
    text: "Предложите идеи для группового обучения, программ, интерактивов и совместной работы.",
    Icon: Users,
  },
  {
    title: "Авторам материалов",
    text: "Помогите сделать создание, хранение и использование учебных материалов удобнее.",
    Icon: BookOpen,
  },
];

const PARTICIPATE_CARDS = [
  {
    title: "Пользоваться платформой",
    text: "Проводить уроки, добавлять материалы и проверять, насколько удобно всё работает в реальной практике.",
    Icon: Sparkles,
  },
  {
    title: "Оставлять отзывы",
    text: "Рассказывать, какие функции оказались полезными, а какие требуют доработки.",
    Icon: MessageSquareHeart,
  },
  {
    title: "Предлагать идеи",
    text: "Делиться пожеланиями по урокам, расписанию, материалам, оплатам, журналу и другим разделам.",
    Icon: Lightbulb,
  },
  {
    title: "Тестировать обновления",
    text: "Пробовать новые функции раньше основного запуска и сообщать о найденных ошибках.",
    Icon: FlaskConical,
  },
  {
    title: "Присоединиться к разработке",
    text: "Помочь с программированием, дизайном, тестированием, методикой, текстами или развитием сообщества.",
    Icon: Code2,
  },
];

const DEV_DIRECTIONS = [
  { label: "frontend-разработка", Icon: Code2 },
  { label: "backend-разработка", Icon: Wrench },
  { label: "тестирование", Icon: Bug },
  { label: "UX/UI-дизайн", Icon: Palette },
  { label: "методическая работа", Icon: BookOpen },
  { label: "создание материалов", Icon: PenLine },
  { label: "тексты и инструкции", Icon: MessageCircle },
  { label: "развитие сообщества", Icon: Users },
];

const EMPTY_FORM = {
  feedbackType: "",
  name: "",
  contact: "",
  subjectArea: "",
  message: "",
  consent: false,
  website: "",
};

function trackTeachersEvent(eventName) {
  try {
    if (typeof window === "undefined") return;
    if (Array.isArray(window.dataLayer)) {
      window.dataLayer.push({ event: eventName });
    }
    if (typeof window.gtag === "function") {
      window.gtag("event", eventName);
    }
  } catch {
    /* analytics is optional */
  }
}

function usePageMeta() {
  useEffect(() => {
    const prevTitle = document.title;
    let meta = document.querySelector('meta[name="description"]');
    const created = !meta;
    if (!meta) {
      meta = document.createElement("meta");
      meta.setAttribute("name", "description");
      document.head.appendChild(meta);
    }
    const prevDescription = meta.getAttribute("content") || "";
    document.title = PAGE_TITLE;
    meta.setAttribute("content", PAGE_DESCRIPTION);

    const upsertOg = (property, content) => {
      let tag = document.querySelector(`meta[property="${property}"]`);
      if (!tag) {
        tag = document.createElement("meta");
        tag.setAttribute("property", property);
        document.head.appendChild(tag);
      }
      tag.setAttribute("content", content);
      return tag;
    };
    upsertOg("og:title", PAGE_TITLE);
    upsertOg("og:description", PAGE_DESCRIPTION);
    upsertOg("og:type", "website");

    return () => {
      document.title = prevTitle;
      if (created) meta.remove();
      else meta.setAttribute("content", prevDescription);
    };
  }, []);
}

function getCsrfToken() {
  const match = document.cookie.match(/(?:^|;\s*)csrftoken=([^;]+)/);
  return match ? decodeURIComponent(match[1]) : "";
}

function CommunityHeroArt() {
  return (
    <div className="tc-hero-art" aria-hidden="true">
      <div className="tc-hero-art__board">
        <div className="tc-hero-art__note tc-hero-art__note--a">
          <span className="tc-hero-art__avatar" />
          <span className="tc-hero-art__lines">
            <i /><i /><i />
          </span>
        </div>
        <div className="tc-hero-art__note tc-hero-art__note--b">
          <span className="tc-hero-art__avatar tc-hero-art__avatar--warm" />
          <span className="tc-hero-art__lines">
            <i /><i />
          </span>
        </div>
        <div className="tc-hero-art__chip">идея для урока</div>
        <div className="tc-hero-art__chip tc-hero-art__chip--soft">тест обновления</div>
        <div className="tc-hero-art__tablet">
          <span />
          <span />
          <span />
        </div>
      </div>
    </div>
  );
}

function FeedbackForm({ formRef, form, setForm, onTypeChange }) {
  const formId = useId();
  const messageRef = useRef(null);
  const successRef = useRef(null);
  const [status, setStatus] = useState("idle");
  const [submitError, setSubmitError] = useState("");
  const [fieldErrors, setFieldErrors] = useState({});
  const [submitting, setSubmitting] = useState(false);
  const startedRef = useRef(false);
  const pendingFocusRef = useRef(false);

  useEffect(() => {
    if (status === "idle" && pendingFocusRef.current) {
      pendingFocusRef.current = false;
      messageRef.current?.focus();
    }
  }, [status, form.feedbackType]);

  useEffect(() => {
    if (formRef) {
      formRef.current = {
        focusMessage: () => {
          if (status === "success") {
            pendingFocusRef.current = true;
            setStatus("idle");
            return;
          }
          messageRef.current?.focus();
        },
        setType: (value) => {
          if (status === "success") {
            pendingFocusRef.current = true;
            setStatus("idle");
          }
          setSubmitError("");
          setForm((prev) => ({ ...prev, feedbackType: value }));
          onTypeChange?.(value);
        },
      };
    }
  }, [formRef, setForm, onTypeChange, status]);

  const markStarted = () => {
    if (startedRef.current) return;
    startedRef.current = true;
    trackTeachersEvent("teachers_feedback_form_start");
  };

  const validate = () => {
    const next = {};
    if (!form.feedbackType) next.feedbackType = "Выберите тип обращения";
    if (!form.message.trim()) next.message = "Напишите сообщение";
    if (form.contact.trim() && !form.consent) {
      next.consent = "Чтобы оставить контакт, отметьте согласие";
    }
    setFieldErrors(next);
    return Object.keys(next).length === 0;
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    setSubmitError("");
    if (!validate()) return;
    if (submitting) return;

    setSubmitting(true);
    const payload = {
      feedbackType: form.feedbackType,
      name: form.name.trim(),
      contact: form.contact.trim(),
      subjectArea: form.subjectArea.trim(),
      message: form.message.trim(),
      consent: Boolean(form.consent),
      website: form.website,
    };

    try {
      if (!getCsrfToken()) {
        await fetch("/api/csrf/", { credentials: "same-origin" });
      }
      const csrf = getCsrfToken();
      const res = await fetch(TEACHER_COMMUNITY_FEEDBACK_ENDPOINT, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Accept: "application/json",
          ...(csrf ? { "X-CSRFToken": csrf } : {}),
        },
        credentials: "same-origin",
        body: JSON.stringify(payload),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        throw new Error(data.error || data.detail || "Не удалось отправить сообщение");
      }
      try {
        localStorage.removeItem(TEACHER_FEEDBACK_DRAFT_KEY);
      } catch {
        /* ignore */
      }
      trackTeachersEvent("teachers_feedback_submit");
      setStatus("success");
      setForm(EMPTY_FORM);
      setFieldErrors({});
      window.setTimeout(() => successRef.current?.focus(), 40);
    } catch (err) {
      try {
        localStorage.setItem(TEACHER_FEEDBACK_DRAFT_KEY, JSON.stringify(payload));
      } catch {
        /* ignore */
      }
      setStatus("error");
      setSubmitError(
        err instanceof Error
          ? err.message
          : "Не удалось отправить сообщение. Попробуйте ещё раз или напишите в Учительской",
      );
    } finally {
      setSubmitting(false);
    }
  };

  if (status === "success") {
    return (
      <div
        className="tc-form-state"
        role="status"
        aria-live="polite"
        tabIndex={-1}
        ref={successRef}
      >
        <div className="tc-form-state__icon" aria-hidden="true">
          <CheckCircle2 />
        </div>
        <h3 className="tc-form-state__title">
          Спасибо! Ваше сообщение отправлено. Именно такие отзывы помогают развивать платформу
        </h3>
        <button
          type="button"
          className="tc-btn tc-btn--secondary"
          onClick={() => {
            setStatus("idle");
            startedRef.current = false;
          }}
        >
          Написать ещё
        </button>
      </div>
    );
  }

  return (
    <form className="tc-form" onSubmit={handleSubmit} noValidate>
      <div className="tc-form__field">
        <label htmlFor={`${formId}-type`}>Тип обращения</label>
        <select
          id={`${formId}-type`}
          value={form.feedbackType}
          onChange={(e) => {
            markStarted();
            setForm((prev) => ({ ...prev, feedbackType: e.target.value }));
            onTypeChange?.(e.target.value);
          }}
          required
          aria-invalid={Boolean(fieldErrors.feedbackType)}
        >
          <option value="">Выберите вариант</option>
          {FEEDBACK_TYPES.map((item) => (
            <option key={item.value} value={item.value}>{item.label}</option>
          ))}
        </select>
        {fieldErrors.feedbackType ? (
          <p className="tc-form__error" role="alert">{fieldErrors.feedbackType}</p>
        ) : null}
      </div>

      <div className="tc-form__row">
        <div className="tc-form__field">
          <label htmlFor={`${formId}-name`}>Имя <span className="tc-form__optional">необязательно</span></label>
          <input
            id={`${formId}-name`}
            type="text"
            autoComplete="name"
            value={form.name}
            onChange={(e) => {
              markStarted();
              setForm((prev) => ({ ...prev, name: e.target.value }));
            }}
            maxLength={200}
          />
        </div>
        <div className="tc-form__field">
          <label htmlFor={`${formId}-contact`}>
            Как с вами связаться <span className="tc-form__optional">необязательно</span>
          </label>
          <input
            id={`${formId}-contact`}
            type="text"
            autoComplete="email"
            value={form.contact}
            onChange={(e) => {
              markStarted();
              setForm((prev) => ({ ...prev, contact: e.target.value }));
            }}
            maxLength={255}
            placeholder="Telegram, электронная почта или другой удобный способ"
          />
        </div>
      </div>

      <div className="tc-form__field">
        <label htmlFor={`${formId}-subject`}>
          Предмет или направление <span className="tc-form__optional">необязательно</span>
        </label>
        <input
          id={`${formId}-subject`}
          type="text"
          value={form.subjectArea}
          onChange={(e) => {
            markStarted();
            setForm((prev) => ({ ...prev, subjectArea: e.target.value }));
          }}
          maxLength={200}
          placeholder="Математика, информатика, начальная школа, программирование"
        />
      </div>

      <div className="tc-form__field">
        <label htmlFor={`${formId}-message`}>Сообщение</label>
        <textarea
          id={`${formId}-message`}
          ref={messageRef}
          rows={6}
          required
          value={form.message}
          onChange={(e) => {
            markStarted();
            setForm((prev) => ({ ...prev, message: e.target.value }));
          }}
          maxLength={5000}
          placeholder="Расскажите, что вы заметили, что хотелось бы изменить или чем вы готовы помочь"
          aria-invalid={Boolean(fieldErrors.message)}
        />
        {fieldErrors.message ? (
          <p className="tc-form__error" role="alert">{fieldErrors.message}</p>
        ) : null}
      </div>

      <label className="tc-form__check">
        <input
          type="checkbox"
          checked={form.consent}
          onChange={(e) => {
            markStarted();
            setForm((prev) => ({ ...prev, consent: e.target.checked }));
          }}
        />
        <span>
          Если оставляю контактные данные, соглашаюсь на их обработку для ответа на обращение
        </span>
      </label>
      {fieldErrors.consent ? (
        <p className="tc-form__error" role="alert">{fieldErrors.consent}</p>
      ) : null}

      {/* honeypot */}
      <div className="tc-form__hp" aria-hidden="true">
        <label htmlFor={`${formId}-website`}>Сайт</label>
        <input
          id={`${formId}-website`}
          tabIndex={-1}
          autoComplete="off"
          value={form.website}
          onChange={(e) => setForm((prev) => ({ ...prev, website: e.target.value }))}
        />
      </div>

      {status === "error" && submitError ? (
        <p className="tc-form__banner" role="alert" aria-live="assertive">
          {submitError.includes("Попробуйте")
            ? submitError
            : `${submitError}. Попробуйте ещё раз или напишите в Учительской.`}
        </p>
      ) : null}

      <button type="submit" className="tc-btn tc-btn--primary" disabled={submitting}>
        {submitting ? "Отправка…" : "Отправить сообщение"}
      </button>
    </form>
  );
}

export default function ForTeachersPage() {
  usePageMeta();
  const formApiRef = useRef(null);
  const formSectionRef = useRef(null);
  const [form, setForm] = useState(EMPTY_FORM);

  const scrollToForm = useCallback((feedbackType) => {
    if (feedbackType) {
      setForm((prev) => ({ ...prev, feedbackType }));
      formApiRef.current?.setType?.(feedbackType);
    }
    formSectionRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
    window.setTimeout(() => formApiRef.current?.focusMessage?.(), 350);
  }, []);

  return (
    <div className="teachers-page teachers-page--community">
      <section className="tc-hero" aria-labelledby="tc-hero-title">
        <div className="teachers-wrap tc-hero__grid">
          <div className="tc-hero__copy">
            <p className="tc-eyebrow">Сообщество учителей</p>
            <h1 id="tc-hero-title" className="tc-hero__title">
              Цифровой поток создаётся вместе с учителями
            </h1>
            <p className="tc-hero__lead">
              Здесь можно следить за развитием платформы, делиться опытом, предлагать новые функции,
              участвовать в тестировании и помогать делать цифровые уроки удобнее.
            </p>
            <div className="tc-hero__actions">
              <a
                className="tc-btn tc-btn--primary"
                href={TEACHERS_TELEGRAM_CHANNEL_URL}
                target="_blank"
                rel="noopener noreferrer"
                onClick={() => trackTeachersEvent("teachers_main_channel_click")}
              >
                Перейти в основной канал
              </a>
              <a
                className="tc-btn tc-btn--secondary"
                href={TEACHERS_TELEGRAM_CHAT_URL}
                target="_blank"
                rel="noopener noreferrer"
                onClick={() => trackTeachersEvent("teachers_community_click")}
              >
                Присоединиться к Учительской
              </a>
            </div>
            <p className="tc-hero__hint">
              Новости платформы, полезные материалы и общение с преподавателями.
            </p>
          </div>
          <CommunityHeroArt />
        </div>
      </section>

      <section className="tc-section" aria-labelledby="tc-audience-title">
        <div className="teachers-wrap">
          <h2 id="tc-audience-title" className="tc-section__title">Здесь рады разным учителям</h2>
          <p className="tc-section__lead">
            Неважно, работаете вы в школе, ведёте индивидуальные занятия, обучаете группы или только
            начинаете преподавать. Для развития платформы важен реальный опыт каждого учителя.
            Присоединиться может преподаватель любого предмета и формата работы.
          </p>
          <div className="tc-card-grid tc-card-grid--4">
            {AUDIENCE_CARDS.map(({ title, text, Icon }) => (
              <article key={title} className="tc-card">
                <div className="tc-card__icon" aria-hidden="true"><Icon size={22} /></div>
                <h3 className="tc-card__title">{title}</h3>
                <p className="tc-card__text">{text}</p>
              </article>
            ))}
          </div>
        </div>
      </section>

      <section className="tc-section tc-section--soft" aria-labelledby="tc-participate-title">
        <div className="teachers-wrap">
          <h2 id="tc-participate-title" className="tc-section__title">Как можно участвовать в развитии</h2>
          <p className="tc-section__lead">
            Участие не обязательно предполагает технические навыки. Даже короткий отзыв после урока
            помогает понять, что стоит улучшить.
          </p>
          <div className="tc-card-grid tc-card-grid--participate">
            {PARTICIPATE_CARDS.map(({ title, text, Icon }) => (
              <article key={title} className="tc-card">
                <div className="tc-card__icon" aria-hidden="true"><Icon size={22} /></div>
                <h3 className="tc-card__title">{title}</h3>
                <p className="tc-card__text">{text}</p>
              </article>
            ))}
          </div>
        </div>
      </section>

      <section className="tc-section" aria-labelledby="tc-topics-title">
        <div className="teachers-wrap">
          <h2 id="tc-topics-title" className="tc-section__title">Можно написать о том, что важно именно вам</h2>
          <div className="tc-chips" role="list">
            {TOPIC_CHIPS.map((chip) => (
              <button
                key={chip.label}
                type="button"
                className="tc-chip"
                role="listitem"
                onClick={() => scrollToForm(chip.type)}
              >
                {chip.label}
              </button>
            ))}
          </div>
          <p className="tc-section__note">
            Нажмите тему, чтобы сразу выбрать её в форме ниже.
          </p>
        </div>
      </section>

      <section
        className="tc-section tc-section--form"
        id="feedback"
        ref={formSectionRef}
        aria-labelledby="tc-form-title"
      >
        <div className="teachers-wrap tc-form-layout">
          <div>
            <h2 id="tc-form-title" className="tc-section__title">Поделиться идеей или отзывом</h2>
            <p className="tc-section__lead">
              Можно написать подробно или оставить несколько предложений. Каждое сообщение будет прочитано.
            </p>
          </div>
          <FeedbackForm
            formRef={formApiRef}
            form={form}
            setForm={setForm}
          />
        </div>
      </section>

      <section className="tc-section tc-section--dev" aria-labelledby="tc-dev-title">
        <div className="teachers-wrap">
          <div className="tc-dev">
            <div>
              <h2 id="tc-dev-title" className="tc-section__title">Хотите помочь развивать проект?</h2>
              <p className="tc-section__lead">
                Цифровой поток развивается постепенно, вместе с преподавателями, разработчиками,
                дизайнерами и авторами образовательных материалов. Можно присоединиться к тестированию,
                предложить профессиональную помощь или рассказать, в каком направлении вам было бы
                интересно участвовать.
              </p>
              <button
                type="button"
                className="tc-btn tc-btn--primary"
                onClick={() => {
                  trackTeachersEvent("teachers_development_interest_click");
                  scrollToForm("development");
                }}
              >
                Рассказать, чем я могу помочь
              </button>
            </div>
            <ul className="tc-dev__list">
              {DEV_DIRECTIONS.map(({ label, Icon }) => (
                <li key={label}>
                  <Icon size={18} aria-hidden="true" />
                  <span>{label}</span>
                </li>
              ))}
            </ul>
          </div>
        </div>
      </section>

      <section className="tc-section" aria-labelledby="tc-telegram-title">
        <div className="teachers-wrap">
          <h2 id="tc-telegram-title" className="tc-section__title">Telegram-сообщество</h2>
          <p className="tc-section__lead">
            Можно начать с канала, познакомиться с проектом, а затем присоединиться к обсуждению.
          </p>
          <div className="tc-tg-grid">
            <article className="tc-tg-card">
              <h3 className="tc-tg-card__title">Цифровой поток</h3>
              <p className="tc-tg-card__text">
                Новости платформы, обновления, новые возможности и полезные материалы.
              </p>
              <p className="tc-tg-card__handle">@itfluxacademy</p>
              <a
                className="tc-btn tc-btn--primary"
                href={TEACHERS_TELEGRAM_CHANNEL_URL}
                target="_blank"
                rel="noopener noreferrer"
                onClick={() => trackTeachersEvent("teachers_main_channel_click")}
              >
                Открыть канал
              </a>
            </article>
            <article className="tc-tg-card tc-tg-card--warm">
              <h3 className="tc-tg-card__title">Учительская</h3>
              <p className="tc-tg-card__text">
                Обсуждение платформы, обмен опытом, отзывы, предложения и общение с преподавателями.
              </p>
              <a
                className="tc-btn tc-btn--secondary"
                href={TEACHERS_TELEGRAM_CHAT_URL}
                target="_blank"
                rel="noopener noreferrer"
                onClick={() => trackTeachersEvent("teachers_community_click")}
              >
                Присоединиться
              </a>
            </article>
          </div>
        </div>
      </section>

      <section className="tc-section tc-section--final" aria-labelledby="tc-final-title">
        <div className="teachers-wrap tc-final">
          <h2 id="tc-final-title" className="tc-section__title">
            Платформа становится лучше благодаря реальным урокам
          </h2>
          <p className="tc-section__lead">
            Иногда важная доработка начинается с одного сообщения: неудобно переключать материалы,
            не хватает инструмента на доске, сложно найти нужную работу или хочется по-другому
            организовать расписание. Такие наблюдения помогают понимать, что действительно нужно учителям.
          </p>
          <div className="tc-hero__actions">
            <button
              type="button"
              className="tc-btn tc-btn--primary"
              onClick={() => scrollToForm()}
            >
              Оставить отзыв
            </button>
            <a
              className="tc-btn tc-btn--secondary"
              href={TEACHERS_TELEGRAM_CHAT_URL}
              target="_blank"
              rel="noopener noreferrer"
              onClick={() => trackTeachersEvent("teachers_community_click")}
            >
              Перейти в Учительскую
            </a>
          </div>
        </div>
      </section>
    </div>
  );
}
