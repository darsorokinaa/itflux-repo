import { useEffect, useId, useRef, useState } from "react";
import { Link, useLocation } from "react-router-dom";
import { trackGoal } from "../utils/analytics";
import { ensureCsrfCookie, getCsrfToken } from "../utils/cabinetAuth";
import { readAcquisition } from "../cabinet/visitContext";
import SiteRequisites from "./SiteRequisites";
import { ACADEMY_CHANNELS } from "./academyChannels";
import {
  ACADEMY_CONSENT_VERSION,
  ACADEMY_SUCCESS_MESSAGE,
  SUBJECTS,
  collectAcquisition,
  validateAcademyForm,
} from "./academyLead";
import "./academy-landing.css";

const AUDIENCE = [
  "Для учеников 9 класса, которые сдают ОГЭ по информатике.",
  "Для учеников 10–11 классов, которые готовятся к ЕГЭ по информатике или к ЕГЭ по профильной математике.",
  "Для родителей, которым важно знать не только «занятие прошло», но и как продвигается ученик: результаты и разбор домашних работ преподаватель показывает и обсуждает с родителем.",
];

const STEPS = [
  ["Бесплатная диагностика.", "После заявки преподаватель выдаёт ученику на платформе набор ключевых заданий в формате экзамена. Мы вместе смотрим результат и составляем план: с каких тем начать и какой формат подходит — мини-группа или индивидуальные занятия."],
  ["Живое занятие.", "Встречаемся онлайн. Разбираем тему, решаем задания экзаменационного формата, работаем на интерактивах. Можно задать вопрос сразу, а не писать его в чат на 200 человек."],
  ["Практика на платформе.", "Между занятиями ученик решает задания, проходит тренажёры и домашнюю работу в личном кабинете."],
  ["Автопроверка ДЗ.", "Там, где ответ проверяется автоматически, результат виден сразу. На занятии мы разбираем не «сдайте тетрадь», а конкретные ошибки."],
  ["Пробники по ходу подготовки.", "Периодически пишем работу в формате экзамена, чтобы видеть динамику и привыкать ко времени."],
];

const FORMATS = [
  ["Мини-группа.", "Небольшой состав, чтобы было время на вопросы каждого. Расписание фиксированное. Подходит тем, кому нужна регулярность и живой разбор вместе с другими учениками."],
  ["Индивидуальные занятия.", "Темп и набор тем подстраиваются под ученика. Подходит, если пробелы неровные или удобнее своё расписание."],
  ["Интенсив.", "Короткий цикл занятий по одной теме или одному типу задания — например, по программированию во второй части ЕГЭ. Это не замена курсу до экзамена, а способ закрыть конкретный пробел."],
];

const FAQ = [
  ["Сколько осталось до экзамена, не поздно ли начинать?", "Сейчас ноябрь, до экзамена около полугода. Этого достаточно для системной подготовки, если заниматься регулярно. Если знаний почти нет, а цель очень высокая, диагностика как раз нужна для честного плана, а не для успокоения."],
  ["Это занятия на вашей платформе или просто созвон?", "Занятия живые, онлайн, с преподавателем. Практика, домашние работы и автопроверка проходят на платформе «Цифровой поток»."],
  ["Чем академия отличается от подписки для учителей на той же платформе?", "Платформа — инструмент для преподавателей и репетиторов. Академия — обучение для учеников: занятия, программа, проверка и сопровождение. Ученик не покупает кабинет учителя, а приходит учиться."],
  ["Группа или индивидуально?", "Если ученику полезна общая программа и ритм группы — мини-группа. Если пробелы очень разные или нужно своё расписание — индивидуально. Решение принимаем после диагностики, а не «потому что так дороже или дешевле»."],
  ["Что с домашней работой?", "Домашняя работа есть после занятий. Часть заданий проверяется автоматически, остальные проверяет преподаватель. Ошибки разбираем на следующем уроке."],
  ["Можно ли начать не с начала программы?", "Да. Мы смотрим на результат диагностики и на оставшееся до экзамена время и выстраиваем план от этого, а не от абстрактного сентября."],
  ["Будут ли Python, олимпиады и ВПР?", "Да, это в планах академии, но позже. Сейчас открываем подготовку к ОГЭ и ЕГЭ."],
  ["Как оплачивать?", "Способ оплаты, договор и расписание появятся при записи. На этом экране нет скрытых условий и обратного отсчёта «осталось 3 места»."],
  ["Нужно ли что-то устанавливать?", "Нужны компьютер или ноутбук, интернет и браузер. Для информатики на ЕГЭ понадобится привычная среда для практики программирования — как к этому подключиться, объясню перед стартом."],
];

const EMPTY = {
  student_name: "",
  parent_name: "",
  grade: "",
  subject: "",
  contact: "",
  comment: "",
  consent: false,
  company_website: "",
};

function scrollToForm(event) {
  const target = document.getElementById("academy-form");
  if (!target) return;
  event.preventDefault();
  const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  target.scrollIntoView({ behavior: reduce ? "auto" : "smooth", block: "start" });
  const field = target.querySelector("input:not([name='company_website']), select, textarea");
  field?.focus({ preventScroll: true });
}

function FieldError({ id, children }) {
  if (!children) return null;
  return <p className="academy-error" id={id} role="alert">{children}</p>;
}

export default function AcademyLandingPage() {
  const { search } = useLocation();
  const formBase = useId();
  const [form, setForm] = useState(EMPTY);
  const [errors, setErrors] = useState({});
  const [sending, setSending] = useState(false);
  const [success, setSuccess] = useState("");
  const [formError, setFormError] = useState("");
  const successRef = useRef(null);

  useEffect(() => {
    if (success) successRef.current?.focus();
  }, [success]);

  const setField = (key, value) => {
    setForm((prev) => ({ ...prev, [key]: value }));
    setErrors((prev) => ({ ...prev, [key]: "" }));
  };

  const submit = async (event) => {
    event.preventDefault();
    const next = validateAcademyForm(form);
    setErrors(next);
    setFormError("");
    if (Object.keys(next).length) {
      document.getElementById(`${formBase}-${Object.keys(next)[0]}`)?.focus();
      return;
    }
    const acquisition = collectAcquisition({
      search,
      stored: readAcquisition(),
      referrer: typeof document !== "undefined" ? document.referrer : "",
    });
    setSending(true);
    try {
      await ensureCsrfCookie();
      const response = await fetch("/api/academy-leads/", {
        method: "POST",
        credentials: "same-origin",
        headers: {
          "Content-Type": "application/json",
          Accept: "application/json",
          "X-CSRFToken": getCsrfToken(),
        },
        body: JSON.stringify({
          student_name: form.student_name.trim(),
          parent_name: form.parent_name.trim(),
          grade: Number(form.grade),
          subject: form.subject,
          contact: form.contact.trim(),
          comment: form.comment.trim(),
          consent: true,
          consent_text_version: ACADEMY_CONSENT_VERSION,
          company_website: form.company_website,
          ...acquisition,
        }),
      });
      const data = await response.json().catch(() => ({}));
      if (response.status === 429) {
        setFormError(data.error || "Слишком много попыток. Попробуйте позже.");
        return;
      }
      if (!response.ok || !data.ok) {
        if (data.errors && typeof data.errors === "object") setErrors(data.errors);
        setFormError(data.error || "Не удалось отправить заявку. Попробуйте ещё раз.");
        return;
      }
      trackGoal("academy_lead_submit", { subject: form.subject, grade: form.grade });
      setSuccess(data.message || ACADEMY_SUCCESS_MESSAGE);
    } catch {
      setFormError("Нет связи с сервером. Попробуйте ещё раз.");
    } finally {
      setSending(false);
    }
  };

  return (
    <article className="academy">
      <div className="academy-wrap">
        <header className="academy-hero">
          <h1>Цифровой поток — онлайн-академия цифровых технологий</h1>
          <p className="academy-lead">
            Готовим к ОГЭ и ЕГЭ по информатике и к ЕГЭ по профильной математике. Занятия проходят на той же платформе, где учителя уже ведут уроки, выдают домашние работы и проверяют задания.
          </p>
          <p className="academy-lead">
            До экзамена сейчас около полугода. Этого достаточно, чтобы спокойно пройти программу, закрыть пробелы и привыкнуть к формату экзамена — если заниматься регулярно.
          </p>
          <a className="academy-btn" href="#academy-form" onClick={scrollToForm}>
            Записаться на бесплатную диагностику
          </a>
          <p className="academy-note">
            Диагностика показывает, какие задания уже получаются, а какие нужно подтянуть. После неё вы получите понятный план и сможете решить, подходит ли вам формат академии. Это не обязательство оплатить курс.
          </p>
        </header>

        <section className="academy-section" aria-labelledby="academy-who">
          <h2 id="academy-who">Для кого</h2>
          <ul className="academy-list">
            {AUDIENCE.map((item) => <li key={item}>{item}</li>)}
          </ul>
          <p>
            Пока мы запускаем именно подготовку к экзаменам. Позже академия будет расширяться: Python для школьников, олимпиадная информатика и подготовка к ВПР. Эти направления появятся отдельно, когда будут готовы программа и набор.
          </p>
        </section>

        <section className="academy-section" aria-labelledby="academy-offer">
          <h2 id="academy-offer">Оффер</h2>
          <p>
            Вы занимаетесь в мини-группе или индивидуально с преподавателем и сразу практикуетесь на интерактивах и тренажёрах платформы «Цифровой поток». Часть домашних заданий проверяется автоматически, остальные проверяет преподаватель, а разбор ошибок остаётся частью занятия — не нужно ждать неделю, чтобы понять, где сбой.
          </p>
          <p>
            Это не вебинар на сотню человек и не набор видеоуроков «в своём темпе без человека рядом». Это живые занятия и работа на платформе, которую я делаю как преподаватель — под реальные уроки, а не только под красивую витрину.
          </p>
        </section>

        <section className="academy-section" aria-labelledby="academy-how">
          <h2 id="academy-how">Как проходит обучение</h2>
          <ol className="academy-steps">
            {STEPS.map(([title, text], index) => (
              <li className="academy-step" key={title}>
                <span className="academy-step__n" aria-hidden="true">{index + 1}</span>
                <p><strong>{title}</strong> {text}</p>
              </li>
            ))}
          </ol>
          <p>
            Занятия идут на платформе <a href="https://itflux-academy.ru">itflux-academy.ru</a>. Отдельно устанавливать десяток сервисов не нужно: доска, материалы, задания и проверка собраны в одном месте.
          </p>
        </section>

        <section className="academy-section" aria-labelledby="academy-formats">
          <h2 id="academy-formats">Форматы</h2>
          <div className="academy-grid">
            {FORMATS.map(([title, text]) => (
              <article className="academy-card" key={title}>
                <h3>{title}</h3>
                <p>{text}</p>
              </article>
            ))}
          </div>
          <dl className="academy-prices">
            <div className="academy-price"><dt>Мини-группа</dt><dd>7 900 ₽ в месяц</dd></div>
            <div className="academy-price"><dt>Индивидуальное занятие</dt><dd>1 900 ₽ за 60 минут</dd></div>
            <div className="academy-price"><dt>Интенсив</dt><dd>7 500 ₽ за цикл из 4 занятий по 90 минут</dd></div>
          </dl>
        </section>

        <section className="academy-section" aria-labelledby="academy-program">
          <h2 id="academy-program">Программа</h2>
          <p>Программа опирается на актуальные требования ОГЭ и ЕГЭ. Ниже — краткий обзор, не полный кодификатор.</p>
          <div className="academy-grid">
            <article className="academy-card">
              <h3>ОГЭ по информатике</h3>
              <p>Единицы информации и кодирование, логика, графы и поиск путей, алгоритмы и исполнители, системы счисления, работа с файлами и поиском, электронные таблицы и короткие программы. Разбираем типовые ловушки и учимся оформлять решение так, как это нужно на экзамене.</p>
            </article>
            <article className="academy-card">
              <h3>ЕГЭ по информатике</h3>
              <p>Первая часть: модели и таблицы, логика, кодирование, системы счисления, комбинаторика, электронные таблицы, графы, теория игр, исполнители. Вторая часть: программирование на Python, обработка файлов и строк, эффективные решения для заданий с большими данными. Отдельно тренируем распределение времени на компьютерном экзамене.</p>
            </article>
            <article className="academy-card">
              <h3>ЕГЭ по профильной математике</h3>
              <p>База (уравнения, неравенства, функции, геометрия, вероятность) и задания высокого уровня. Идём не «по учебнику с первой главы», а от диагностики: сначала закрываем то, что даёт баллы и проседает чаще всего, затем наращиваем сложность.</p>
            </article>
          </div>
          <p>Конкретный порядок тем для каждого ученика или группы уточняется после диагностики. Если ученик подключается не с начала учебного года, мы не делаем вид, что впереди ещё полный год: честно смотрим, что успеваем за оставшееся время.</p>
        </section>

        <section className="academy-section" aria-labelledby="academy-teacher">
          <h2 id="academy-teacher">Преподаватель</h2>
          <p>Занятия веду я, Дарья Сорокина. Я практикующий преподаватель и автор платформы «Цифровой поток».</p>
          <p>Я собираю уроки, тренажёры и домашние работы так, как ими потом пользуюсь сама: чтобы задание можно было выдать, решить и проверить без лишней суеты. В академии ученики занимаются на этих же инструментах.</p>
          <p>Я не буду писать здесь чужие баллы и красивые регалии, которых нет в открытом доступе. Честный разговор о формате, нагрузке и плане подготовки важнее списка обещаний. Если после диагностики станет ясно, что за оставшееся время цель завышена, я скажу об этом прямо.</p>
        </section>

        <section className="academy-section" aria-labelledby="academy-diagnosis">
          <h2 id="academy-diagnosis">Первый шаг — бесплатная диагностика</h2>
          <p>До оплаты курса предлагаю пройти диагностику. Это не «пробный урок-продажа» и не тест ради оценки в журнал.</p>
          <p>На диагностике ученик решает задания в формате экзамена на платформе. Затем мы разбираем результат: что уже получается, где пробелы, сколько примерно времени нужно на подготовку и какой формат разумнее выбрать.</p>
          <p>После диагностики можно спокойно подумать и только потом принимать решение о занятиях.</p>
          <a className="academy-btn" href="#academy-form" onClick={scrollToForm}>Записаться на диагностику</a>
        </section>

        <section className="academy-section academy-form-section" id="academy-form" aria-labelledby="academy-form-title">
          <h2 id="academy-form-title">Записаться на диагностику</h2>
          {success ? (
            <div className="academy-success" role="status" tabIndex={-1} ref={successRef}>
              <p>{success}</p>
            </div>
          ) : (
            <form className="academy-form" onSubmit={submit} noValidate>
              <div className="academy-field">
                <label htmlFor={`${formBase}-student_name`}>Имя ученика</label>
                <input id={`${formBase}-student_name`} value={form.student_name} onChange={(event) => setField("student_name", event.target.value)} autoComplete="section-student name" maxLength={200} required aria-invalid={errors.student_name ? "true" : "false"} aria-describedby={errors.student_name ? `${formBase}-student_name-error` : undefined} />
                <FieldError id={`${formBase}-student_name-error`}>{errors.student_name}</FieldError>
              </div>
              <div className="academy-field">
                <label htmlFor={`${formBase}-parent_name`}>Имя родителя <span className="academy-optional">(необязательно)</span></label>
                <input id={`${formBase}-parent_name`} value={form.parent_name} onChange={(event) => setField("parent_name", event.target.value)} autoComplete="section-parent name" maxLength={200} />
              </div>
              <div className="academy-field">
                <label htmlFor={`${formBase}-grade`}>Класс</label>
                <select id={`${formBase}-grade`} value={form.grade} onChange={(event) => setField("grade", event.target.value)} required aria-invalid={errors.grade ? "true" : "false"} aria-describedby={errors.grade ? `${formBase}-grade-error` : undefined}>
                  <option value="">Выберите класс</option>
                  <option value="9">9</option>
                  <option value="10">10</option>
                  <option value="11">11</option>
                </select>
                <FieldError id={`${formBase}-grade-error`}>{errors.grade}</FieldError>
              </div>
              <div className="academy-field">
                <label htmlFor={`${formBase}-subject`}>Предмет</label>
                <select id={`${formBase}-subject`} value={form.subject} onChange={(event) => setField("subject", event.target.value)} required aria-invalid={errors.subject ? "true" : "false"} aria-describedby={errors.subject ? `${formBase}-subject-error` : undefined}>
                  <option value="">Выберите предмет</option>
                  {SUBJECTS.map((item) => (
                    <option key={item.value} value={item.value} disabled={form.grade !== "" && !item.grades.includes(Number(form.grade))}>{item.label}</option>
                  ))}
                </select>
                <FieldError id={`${formBase}-subject-error`}>{errors.subject}</FieldError>
              </div>
              <div className="academy-field">
                <label htmlFor={`${formBase}-contact`}>Контакт — Telegram @username или телефон</label>
                <input id={`${formBase}-contact`} value={form.contact} onChange={(event) => setField("contact", event.target.value)} autoComplete="tel" inputMode="text" maxLength={80} required aria-invalid={errors.contact ? "true" : "false"} aria-describedby={errors.contact ? `${formBase}-contact-error` : undefined} />
                <FieldError id={`${formBase}-contact-error`}>{errors.contact}</FieldError>
              </div>
              <div className="academy-field">
                <label htmlFor={`${formBase}-comment`}>Комментарий <span className="academy-optional">(необязательно)</span></label>
                <textarea id={`${formBase}-comment`} value={form.comment} onChange={(event) => setField("comment", event.target.value)} rows={4} maxLength={4000} placeholder="Цель и есть ли уже результаты пробников" />
                <FieldError id={`${formBase}-comment-error`}>{errors.comment}</FieldError>
              </div>
              <div className="academy-hp" aria-hidden="true">
                <label>
                  Компания
                  <input name="company_website" tabIndex={-1} autoComplete="off" value={form.company_website} onChange={(event) => setField("company_website", event.target.value)} />
                </label>
              </div>
              <label className="academy-consent">
                <input id={`${formBase}-consent`} type="checkbox" checked={form.consent} onChange={(event) => setField("consent", event.target.checked)} aria-invalid={errors.consent ? "true" : "false"} aria-describedby={errors.consent ? `${formBase}-consent-error` : undefined} />
                <span>
                  Нажимая кнопку, вы соглашаетесь с <Link to="/privacy">политикой обработки персональных данных</Link>.{" "}
                  <Link to="/offer">Публичная оферта</Link>.
                </span>
              </label>
              <FieldError id={`${formBase}-consent-error`}>{errors.consent}</FieldError>
              {formError ? <p className="academy-error" role="alert">{formError}</p> : null}
              <button className="academy-btn academy-submit" type="submit" disabled={sending}>
                {sending ? "Отправляем…" : "Записаться на диагностику"}
              </button>
            </form>
          )}
        </section>

        <section className="academy-section" aria-labelledby="academy-faq">
          <h2 id="academy-faq">Вопросы</h2>
          <div className="academy-faq">
            {FAQ.map(([question, answer]) => (
              <details key={question}>
                <summary>{question}</summary>
                <p>{answer}</p>
              </details>
            ))}
          </div>
        </section>

        <footer className="academy-foot">
          <h2>Цифровой поток — онлайн-академия цифровых технологий</h2>
          <ul className="academy-social">
            <li>Платформа: <a href="https://itflux-academy.ru">itflux-academy.ru</a></li>
            {ACADEMY_CHANNELS.map((channel) => (
              <li key={channel.id}>{channel.label}: <a href={channel.href}>{channel.text}</a></li>
            ))}
          </ul>
          <SiteRequisites />
          <nav className="academy-legal" aria-label="Документы">
            <Link to="/offer">Публичная оферта</Link>
            <Link to="/privacy">Политика обработки персональных данных</Link>
            <Link to="/contacts">Контакты</Link>
          </nav>
        </footer>
      </div>
    </article>
  );
}
