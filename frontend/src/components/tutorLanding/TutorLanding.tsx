/**
 * r103: лендинг для репетиторов на главной (макет /landing_tutors).
 * Цены и лимит учеников — из /api/cabinet/pricing/plans/ (TariffPlan).
 * Заглушки макета (отзывы, кейсы, видео, «Об авторе», отличия «Профи», PDF-лид-магнит)
 * не выводятся: реальных данных под них в репозитории/БД нет.
 */
import { Link } from "react-router-dom";
import {
  BarChart3,
  BookOpen,
  CalendarDays,
  CheckCheck,
  FileStack,
  Map,
  NotebookPen,
  PenLine,
} from "lucide-react";
import { fmtRub, useTariffPlans, yearDiscountPercent, type PublicPlan } from "./useTariffPlans";
import "./tutor-landing.css";
import imgBank from "./img/bank.webp";
import imgTextbook from "./img/textbook.webp";
import imgAuthor from "./img/author.webp";
import imgLessons from "./img/lessons.webp";
import imgInteractive from "./img/interactive.webp";
import imgGenerator from "./img/generator.webp";
import imgHomework from "./img/homework_autocheck.webp";
import imgReview from "./img/review.webp";
import imgJournal from "./img/journal.webp";

export const CONTACT_EMAIL = "itflux.academy@yandex.com";
const REGISTER_URL = `/cabinet/login?mode=register&next=${encodeURIComponent("/cabinet")}`;
const LANDING_SLUGS = ["start", "teacher", "pro"] as const;

type Props = { isTeacher?: boolean };

export default function TutorLanding({ isTeacher = false }: Props) {
  const { plans, failed } = useTariffPlans();
  const byslug = (s: string) => plans?.find((p) => p.slug === s);
  const landingPlans = LANDING_SLUGS.map(byslug).filter(Boolean) as PublicPlan[];
  const paid = landingPlans.filter((p) => Number(p.price_month) > 0);
  const minPaid = paid.length ? Math.min(...paid.map((p) => Number(p.price_month))) : null;
  const discount = paid.map(yearDiscountPercent).find((x) => x != null) ?? null;
  const startCta = isTeacher ? "/cabinet" : REGISTER_URL;

  return (
    <div className="tl">
      <TutorHero ctaTo={startCta} studentsTo={isTeacher ? "/cabinet/students" : `/cabinet/login?mode=register&next=${encodeURIComponent("/cabinet/students")}`} />
      <TutorFeatures />
      <TutorMaterials />
      <TutorAutocheck ctaTo={startCta} />
      {landingPlans.length === 3 ? (
        <TutorPricing plans={landingPlans} ctaTo={startCta} discount={discount} />
      ) : failed ? (
        <section className="tl-section tl-pricing" id="tarify">
          <h2 className="tl-h2">Тарифы</h2>
          <p className="tl-lead">
            <Link to="/pricing">Посмотреть тарифы и цены →</Link>
          </p>
        </section>
      ) : (
        <section className="tl-section tl-pricing tl-pricing--loading" id="tarify" aria-busy="true">
          <h2 className="tl-h2">Тарифы</h2>
        </section>
      )}
      <TutorFaq minPaid={minPaid} discount={discount} />
      <TutorFinalCta ctaTo={startCta} />
    </div>
  );
}

function TutorHero({ ctaTo, studentsTo }: { ctaTo: string; studentsTo: string }) {
  return (
    <section className="tl-hero" aria-labelledby="tl-hero-title">
      <div className="tl-hero__grid">
        <div>
          <span className="tl-pill">Для репетиторов и учителей математики и информатики</span>
          <h1 id="tl-hero-title" className="tl-h1">
            Доска, видеозвонки и всё для урока — <span>в одном месте</span>
          </h1>
          <p className="tl-hero__sub">
            Рабочее место для подготовки к ОГЭ и ЕГЭ: банк задач ФИПИ, генератор вариантов,
            автопроверка домашки и расписание.
          </p>
          <div className="tl-hero__actions">
            <Link className="tl-btn" to={ctaTo}>Попробовать бесплатно</Link>
            <Link className="tl-alt" to={studentsTo}>Добавить первого ученика →</Link>
          </div>
          <div className="tl-tags">
            <span>ОГЭ</span><span>ЕГЭ</span><span>Математика</span><span>Информатика</span>
          </div>
        </div>
        <HeroIllustration />
      </div>
    </section>
  );
}

/** Декоративная иллюстрация интерфейса (не данные). */
function HeroIllustration() {
  return (
    <div className="tl-app" aria-hidden="true">
      <div className="tl-app__bar"><i /><i /><i /><span>Урок · Информатика · ЕГЭ №8</span></div>
      <div className="tl-app__body">
        <div className="tl-app__side"><b className="on" /><b /><b /><b /></div>
        <div className="tl-app__board">
          <div className="tl-app__bt">ДОСКА</div>
          <div className="tl-app__task">
            <b>Задача 8</b>
            <div className="tl-ln" /><div className="tl-ln" style={{ width: "70%" }} />
            <div className="tl-code">for i in range(<em>n</em>):<br />&nbsp;&nbsp;s += i * 2</div>
          </div>
        </div>
        <div className="tl-app__vid">
          <div className="tl-cam"><div className="tl-av">У</div></div>
          <div className="tl-cam tl-cam--you"><div className="tl-av tl-av--y">Вы</div><span>Репетитор</span></div>
          <div className="tl-hw"><div>ДЗ · автопроверка</div><div className="tl-pr"><i style={{ width: "80%" }} /></div></div>
        </div>
      </div>
      <div className="tl-chip tl-chip--1">Вариант ОГЭ готов</div>
      <div className="tl-chip tl-chip--2">Ср, 17:00 · урок</div>
    </div>
  );
}

const FEATURES = [
  { t: "Банк задач ФИПИ", d: "Задачи из открытого банка ФИПИ по номерам КИМ ОГЭ и ЕГЭ.", I: BookOpen },
  { t: "Авторские задачи", d: "Добавляйте свои задачи и собирайте из них подборки.", I: PenLine },
  { t: "Автопроверка ДЗ", d: "Краткие ответы проверяются сразу после отправки, развёрнутые приходят вам на проверку.", I: CheckCheck },
  { t: "Генератор вариантов", d: "Варианты в формате КИМ за пару кликов, с ответами.", I: FileStack },
  { t: "Готовые планы ОГЭ и ЕГЭ", d: "Программа подготовки по неделям уже внутри платформы.", I: Map },
  { t: "Календарь и расписание", d: "Все уроки на одной неделе, ссылки на занятия рядом.", I: CalendarDays },
  { t: "Журнал", d: "Посещаемость, оценки и домашки по каждому ученику.", I: NotebookPen },
  { t: "Отчёты", d: "Прогресс по темам — удобно показать родителям.", I: BarChart3 },
];

function TutorFeatures() {
  return (
    <section className="tl-section" id="vozmozhnosti" aria-labelledby="tl-features-title">
      <h2 id="tl-features-title" className="tl-h2">Всё, что нужно для подготовки</h2>
      <p className="tl-lead">Не нужно держать пять вкладок: задачи, уроки и учёт учеников живут вместе.</p>
      <div className="tl-grid4">
        {FEATURES.map(({ t, d, I }) => (
          <article key={t} className="tl-card tl-feature">
            <span className="tl-feature__icon" aria-hidden><I size={22} strokeWidth={2.1} /></span>
            <h3>{t}</h3>
            <p>{d}</p>
          </article>
        ))}
      </div>
    </section>
  );
}

function Shot({ src, cap, w, h }: { src: string; cap: string; w: number; h: number }) {
  return (
    <figure className="tl-shot">
      <div className="tl-shot__bar" aria-hidden><i /><i /><i /></div>
      <img src={src} alt={cap} width={w} height={h} loading="lazy" decoding="async" />
      <figcaption>{cap}</figcaption>
    </figure>
  );
}

/* Цифры — из БД на 23.10.2026 (global, is_active), округлены вниз. */
const MATERIALS = [
  { n: "более 12 500", h: "заданий ФИПИ", p: "Открытый банк по математике и информатике, всегда бесплатно.", img: imgBank, cap: "Банк заданий", w: 1200, h2: 562 },
  { n: "более 1 650", h: "задач из учебников", p: "Тоже бесплатно, для отработки тем.", img: imgTextbook, cap: "Задачи из учебников", w: 1200, h2: 614 },
  { n: "более 2 500", h: "авторских задач «Цифрового потока»", p: "Свои задачи, которых нет в открытом банке.", img: imgAuthor, cap: "Авторские задачи", w: 1200, h2: 618 },
  { n: "57", h: "готовых уроков", p: "Можно взять урок целиком и провести его с учеником.", img: imgLessons, cap: "Каталог уроков", w: 1200, h2: 480 },
  { n: "26", h: "интерактивов", p: "Задания, которые ученик выполняет прямо на платформе.", img: imgInteractive, cap: "Интерактив", w: 1200, h2: 613 },
  { n: "", h: "Генератор вариантов", p: "Соберите вариант в формате экзамена за пару кликов.", img: imgGenerator, cap: "Генератор вариантов", w: 1200, h2: 619 },
];

function TutorMaterials() {
  return (
    <section className="tl-section" id="materialy" aria-labelledby="tl-materials-title">
      <h2 id="tl-materials-title" className="tl-h2">Всё для подготовки к ОГЭ и ЕГЭ уже внутри</h2>
      <p className="tl-lead">Не нужно собирать задачи по разным сайтам: банк, уроки и варианты в одном кабинете.</p>
      <div className="tl-grid3">
        {MATERIALS.map((m) => (
          <article key={m.h} className="tl-card tl-mat">
            <Shot src={m.img} cap={m.cap} w={m.w} h={m.h2} />
            <div className="tl-mat__body">
              {m.n ? <b className="tl-num">{m.n}</b> : null}
              <h3>{m.h}</h3>
              <p>{m.p}</p>
            </div>
          </article>
        ))}
      </div>
      <div className="tl-center"><a className="tl-btn" href="/zadaniya">Посмотреть задания</a></div>
    </section>
  );
}

function TutorAutocheck({ ctaTo }: { ctaTo: string }) {
  return (
    <section className="tl-section" id="avtoproverka" aria-labelledby="tl-autocheck-title">
      <h2 id="tl-autocheck-title" className="tl-h2">Домашку проверяет платформа, а не Вы</h2>
      <p className="tl-lead">Выдайте задания ученику, и ответы проверятся автоматически.</p>
      <div className="tl-grid3">
        <article className="tl-card tl-step">
          <span className="tl-step__n">1</span>
          <p>Задания с кратким ответом проверяются сразу после отправки домашки. Если нужен развёрнутый ответ, платформа отдельно подскажет, что его надо проверить Вам.</p>
          <div className="tl-step__v"><Shot src={imgHomework} cap="Домашнее задание · демо-данные" w={1200} h={615} /></div>
        </article>
        <article className="tl-card tl-step">
          <span className="tl-step__n">2</span>
          <p>Ответ засчитывается и с точкой, и с запятой: 0.5 и 0,5 — одно и то же.</p>
          <div className="tl-step__v">
            <figure className="tl-shot tl-eq" aria-label="0.5 и 0,5 засчитываются одинаково">
              <div className="tl-eq__b"><span><em>0.5</em><i>✓</i></span><b>=</b><span><em>0,5</em><i>✓</i></span></div>
              <figcaption>иллюстрация</figcaption>
            </figure>
          </div>
        </article>
        <article className="tl-card tl-step">
          <span className="tl-step__n">3</span>
          <p>Все сданные работы собраны в разделе «Проверка». Результаты по ученикам, группам и темам видны в журнале и отчётах (на платных тарифах). Ученик видит свои результаты в кабинете.</p>
          <div className="tl-step__v">
            <Shot src={imgReview} cap="Раздел «Проверка»" w={1200} h={480} />
            <Shot src={imgJournal} cap="Журнал · на платных тарифах" w={1200} h={531} />
          </div>
        </article>
      </div>
      <div className="tl-center"><Link className="tl-btn" to={ctaTo}>Попробовать бесплатно</Link></div>
    </section>
  );
}

function studentsLine(p: PublicPlan) {
  const n = p.limits?.students;
  return n == null ? "Без ограничений по ученикам" : `До ${fmtRub(n)} учеников`;
}

function TutorPricing({ plans, ctaTo, discount }: { plans: PublicPlan[]; ctaTo: string; discount: number | null }) {
  return (
    <section className="tl-section tl-pricing" id="tarify" aria-labelledby="tl-pricing-title">
      <h2 id="tl-pricing-title" className="tl-h2">Тарифы</h2>
      <p className="tl-lead">Начните бесплатно — платный тариф подключите, когда будет удобно.</p>
      <div className="tl-plans">
        {plans.map((p) => {
          const free = !(Number(p.price_month) > 0);
          const hot = p.slug === "teacher";
          const bullets = free
            ? ["Задания ФИПИ", "Учебники", "Генератор вариантов", studentsLine(p)]
            : ["Полный доступ к материалам «Цифрового потока»", studentsLine(p), "Видеозвонки и доска", "Журнал и отчёты"];
          return (
            <article key={p.slug} className={`tl-card tl-plan${hot ? " tl-plan--hot" : ""}`} data-plan={p.slug}>
              {hot && <span className="tl-badge">Популярный</span>}
              <div className="tl-plan__name">{p.name}</div>
              <div className="tl-plan__price">
                {fmtRub(p.price_month)} ₽{free ? null : <small> /мес</small>}
              </div>
              <div className="tl-plan__sub">
                {free ? "навсегда" : Number(p.price_year) > 0 ? `${fmtRub(p.price_year)} ₽ за год` : "\u00a0"}
              </div>
              <ul>{bullets.map((b) => <li key={b}>{b}</li>)}</ul>
              {free ? (
                <Link className="tl-btn tl-btn--ghost" to={ctaTo}>Попробовать бесплатно</Link>
              ) : (
                <Link className={`tl-btn${hot ? "" : " tl-btn--ghost"}`} to="/pricing">Выбрать тариф</Link>
              )}
            </article>
          );
        })}
      </div>
      {discount != null && <div className="tl-year">−{discount}% при оплате за год</div>}
      <p className="tl-pricing__more"><Link to="/pricing">Подробное сравнение тарифов, тариф «Школа» →</Link></p>
    </section>
  );
}

function TutorFaq({ minPaid, discount }: { minPaid: number | null; discount: number | null }) {
  const priceAnswer =
    "Да, тариф «Старт» бесплатный." +
    (minPaid != null ? ` Платные тарифы — от ${fmtRub(minPaid)} ₽/мес` : "") +
    (minPaid != null && discount != null ? `, при оплате за год −${discount}%.` : minPaid != null ? "." : "");
  const items = [
    { q: "Это бесплатно?", a: priceAnswer },
    { q: "Нужно ли что-то устанавливать?", a: "Нет, всё работает в браузере — и у вас, и у ученика." },
    { q: "Откуда задачи?", a: "Из открытого банка ФИПИ, плюс вы можете добавлять свои авторские задачи." },
    { q: "Подходит для групп в школе?", a: "Да, журнал и отчёты работают и для класса." },
  ];
  return (
    <section className="tl-section tl-faq" id="faq" aria-labelledby="tl-faq-title">
      <h2 id="tl-faq-title" className="tl-h2">Частые вопросы</h2>
      {items.map((it) => (
        <details key={it.q} className="tl-details">
          <summary>{it.q}</summary>
          <p>{it.a}</p>
        </details>
      ))}
    </section>
  );
}

function TutorFinalCta({ ctaTo }: { ctaTo: string }) {
  return (
    <section className="tl-section">
      <div className="tl-final">
        <h2 className="tl-h2">Добавьте первого ученика сегодня</h2>
        <p>Бесплатный тариф «Старт» — без карты.</p>
        <Link className="tl-btn tl-btn--lime" to={ctaTo}>Попробовать бесплатно</Link>
        <p className="tl-final__mail">
          Вопросы: <a href={`mailto:${CONTACT_EMAIL}`}>{CONTACT_EMAIL}</a>
        </p>
      </div>
    </section>
  );
}
