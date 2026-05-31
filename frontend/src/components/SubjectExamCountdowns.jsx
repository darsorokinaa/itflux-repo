import {
  createContext,
  useContext,
  useEffect,
  useMemo,
  useState,
} from "react";
import { Link } from "react-router-dom";

const JUNE = 5; // месяц 0-based (июнь)

/** День июня (1–30), начало экзамена 10:00. Существующие math / inf / history не менялись. */
const EXAM_DAY_EGE = {
  history: 1,
  lit: 1,
  chem: 1,
  rus: 4,
  math: 8,
  math_base: 8,
  inf: 18,
  phys: 11,
  bio: 15,
};

const EXAM_DAY_OGE = {
  history: 5,
  math: 2,
  math_base: 2,
  inf: 6,
  rus: 4,
  lit: 5,
  chem: 5,
  phys: 5,
  bio: 5,
};

function getExamDayOfMonth(level, subjectKey) {
  if (level === "ege") {
    return EXAM_DAY_EGE[subjectKey] ?? 18;
  }
  return EXAM_DAY_OGE[subjectKey] ?? 6;
}

/** Ближайшая дата экзамена в локальном времени устройства (июнь, 10:00). */
function getNextExamTimestamp(level, subjectKey) {
  const now = Date.now();
  const y0 = new Date().getFullYear();
  const day = getExamDayOfMonth(level, subjectKey);
  for (let y = y0; y <= y0 + 2; y += 1) {
    const t = new Date(y, JUNE, day, 10, 0, 0, 0).getTime();
    if (t > now) return t;
  }
  return new Date(y0 + 1, JUNE, day, 10, 0, 0, 0).getTime();
}

function pad2(n) {
  return String(n).padStart(2, "0");
}

function splitRemain(ms) {
  if (ms <= 0) {
    return { days: 0, hours: 0, minutes: 0, seconds: 0 };
  }
  const sec = Math.floor(ms / 1000);
  const days = Math.floor(sec / 86400);
  const hours = Math.floor((sec % 86400) / 3600);
  const minutes = Math.floor((sec % 3600) / 60);
  const seconds = sec % 60;
  return { days, hours, minutes, seconds };
}

function fmtInt(n) {
  return Math.round(n).toLocaleString("ru-RU");
}

const FOOTNOTE_PHRASE_STORAGE_KEY_V1 = "digital_flow_exam_footnote_comparison_v1";
const FOOTNOTE_SEED_STORAGE_KEY = "digital_flow_exam_footnote_hourly_v1";

/**
 * Сравнения по оставшимся секундам (числа пересчитываются от таймера).
 * У каждого браузера свой seed в localStorage; тип фразы — от seed + локального часа.
 */
const COMPARISON_FACTORIES = [
  (sec) =>
    `это как ${fmtInt(sec * (17 / 60))} раз моргнуть`,
  (sec) =>
    `это как посмотреть ${fmtInt(Math.floor(sec / 34))} коротких роликов подряд`,
  (sec) =>
    `это как ${(sec / 3600).toLocaleString("ru-RU", { maximumFractionDigits: 1 })} часов непрерывно болтать с друзьями`,
  (sec) =>
    `это как прослушать ${fmtInt(Math.floor(sec / 210))} песен Вани Дмитриенко подряд`,
  (sec) =>
    `это как непрерывно варить макароны ${fmtInt(Math.floor(sec / 600))} раз по 10 мин`,
  (sec) =>
    `это как пройти ${fmtInt((sec / 3600) * 5)} км без остановки пешком`,
  (sec) =>
    `это как прочитать примерно ${fmtInt(Math.floor(sec / 150))} страниц книги`,
  (sec) =>
    `это как вскипятить чайник ${fmtInt(Math.floor(sec / 420))} раз подряд`,
  (sec) =>
    `это как ${fmtInt(Math.floor(sec / 120))} двухминутных чисток зубов подряд`,
  (sec) =>
    `это как сделать ${fmtInt(Math.floor(sec / 45))} подходов планки по 45 секунд`,
  (sec) =>
    `это как написать «ну как ты?» ${fmtInt(Math.floor(sec / 5))} раз`,
  (sec) =>
    `это как сыграть ${fmtInt(Math.floor(sec / ( 3600)))} раз (по 2 часа) в Симс`,
  (sec) =>
    `это как посмотреть ${fmtInt(Math.floor(sec / (22 * 60)))} серий Рика и Морти`,
];

/** Уникальное целое на каждый локальный календарный час устройства. */
function localHourBucketFromMs(ms) {
  const t = new Date(ms);
  return (
    t.getFullYear() * 1_000_000 +
    (t.getMonth() + 1) * 10_000 +
    t.getDate() * 100 +
    t.getHours()
  );
}

function phraseIndexFromSeed(userSeed, hourBucket, cardSlot) {
  const n = COMPARISON_FACTORIES.length;
  let idx = (userSeed + hourBucket * 31 + cardSlot * 17) % n;
  if (idx < 0) idx += n;
  return idx;
}

function loadOrCreateUserFootnoteSeed() {
  try {
    const raw = localStorage.getItem(FOOTNOTE_SEED_STORAGE_KEY);
    if (raw) {
      const o = JSON.parse(raw);
      const s = Number(o.seed);
      if (Number.isInteger(s) && s > 0) return s;
    }
  } catch {
    /* ignore */
  }
  const seed = 1 + Math.floor(Math.random() * 999_999_999);
  try {
    localStorage.setItem(FOOTNOTE_SEED_STORAGE_KEY, JSON.stringify({ seed }));
    localStorage.removeItem(FOOTNOTE_PHRASE_STORAGE_KEY_V1);
  } catch {
    /* приватный режим и т.п. */
  }
  return seed;
}

function footnoteTextFor(secTotal, phraseIndex) {
  if (secTotal <= 0) {
    return "Экзамен уже идёт или прошёл — удачи на полях сражения с билетом.";
  }
  const idx = ((phraseIndex % COMPARISON_FACTORIES.length) + COMPARISON_FACTORIES.length) %
    COMPARISON_FACTORIES.length;
  return COMPARISON_FACTORIES[idx](secTotal);
}

const CONFIG = {
  ege: {
    math: { subject: "Математика (профильная)", dateLine: "8 июня · 10:00" },
    math_base: { subject: "Математика (базовая)", dateLine: "8 июня · 10:00" },
    inf: { subject: "Информатика", dateLine: "18 июня · 10:00" },
    history: { subject: "История", dateLine: "1 июня · 10:00" },
    rus: { subject: "Русский язык", dateLine: "4 июня · 10:00" },
    chem: { subject: "Химия", dateLine: "1 июня · 10:00" },
    phys: { subject: "Физика", dateLine: "11 июня · 10:00" },
    lit: { subject: "Литература", dateLine: "1 июня · 10:00" },
    bio: { subject: "Биология", dateLine: "15 июня · 10:00" },
  },
  oge: {
    math: { subject: "Математика", dateLine: "2 июня · 10:00" },
    math_base: { subject: "Математика", dateLine: "2 июня · 10:00" },
    inf: { subject: "Информатика", dateLine: "6 июня · 10:00" },
    history: { subject: "История", dateLine: "5 июня · 10:00" },
    rus: { subject: "Русский язык", dateLine: "4 июня · 10:00" },
    chem: { subject: "Химия", dateLine: "5 июня · 10:00" },
    phys: { subject: "Физика", dateLine: "5 июня · 10:00" },
    lit: { subject: "Литература", dateLine: "5 июня · 10:00" },
    bio: { subject: "Биология", dateLine: "5 июня · 10:00" },
  },
};

const COUNTDOWN_HEADLINE = "До экзамена осталось";

const PHRASE_SLOT = {
  math: 0,
  math_base: 0,
  inf: 1,
  history: 2,
  rus: 3,
  chem: 4,
  phys: 5,
  lit: 6,
  bio: 7,
};

const ExamCountdownContext = createContext(null);

/** Один интервал на все таймеры до экзамена; оборачивает страницу варианта (или др. потребителей). */
export function SubjectExamCountdownProvider({ level, children }) {
  const valid = level === "ege" || level === "oge";
  const [now, setNow] = useState(() => Date.now());
  const [footnoteSeed] = useState(loadOrCreateUserFootnoteSeed);

  useEffect(() => {
    if (!valid) return undefined;
    const id = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(id);
  }, [valid]);

  const value = useMemo(() => {
    if (!valid) return { valid: false };
    return {
      valid: true,
      level,
      now,
      footnoteSeed,
      hourBucket: localHourBucketFromMs(now),
      levelLabel: level === "ege" ? "ЕГЭ" : "ОГЭ",
      cfg: CONFIG[level],
    };
  }, [valid, level, now, footnoteSeed]);

  return (
    <ExamCountdownContext.Provider value={value}>
      {children}
    </ExamCountdownContext.Provider>
  );
}

function CountdownCard({ subject, dateLine, targetTs, accent, now, levelLabel, footnotePhraseIndex }) {
  const remainMs = targetTs - now;
  const { days, hours, minutes, seconds } = splitRemain(remainMs);
  const secTotal = Math.max(0, Math.floor(remainMs / 1000));
  const parts = [
    { value: days, label: "дн" },
    { value: pad2(hours), label: "час" },
    { value: pad2(minutes), label: "мин" },
    { value: pad2(seconds), label: "сек" },
  ];

  const footnote = footnoteTextFor(secTotal, footnotePhraseIndex);

  return (
    <details
      className={`subject-exam-countdown-card subject-exam-countdown-card--${accent} subject-exam-countdown-card--foldable`}
      role="group"
      aria-label={`${subject}, ${levelLabel}, экзамен ${dateLine}. ${COUNTDOWN_HEADLINE}`}
    >
      <summary className="subject-exam-countdown-card__summary">
        <span className="subject-exam-countdown-card__badge">{subject}</span>
        <span className="subject-exam-countdown-card__summary-main">
          <span className="subject-exam-countdown-card__date">{dateLine}</span>
          <span className="subject-exam-countdown-card__summary-days">
            {days}
            {" "}
            дн
          </span>
        </span>
        <span className="subject-exam-countdown-card__summary-chevron" aria-hidden>
          ▾
        </span>
      </summary>
      <div className="subject-exam-countdown-card__fold-body" role="timer">
        <h3 className="subject-exam-countdown-card__title">{COUNTDOWN_HEADLINE}</h3>
        <div className="subject-exam-countdown-card__grid">
          {parts.map((p) => (
            <div key={p.label} className="subject-exam-countdown-card__cell">
              <span className="subject-exam-countdown-card__value">{p.value}</span>
              <span className="subject-exam-countdown-card__unit">{p.label}</span>
            </div>
          ))}
        </div>
        <p className="subject-exam-countdown-card__footnote" role="note">
          <span className="subject-exam-countdown-card__footnote-mark" aria-hidden="true">
            *
          </span>
          <span className="subject-exam-countdown-card__footnote-text">{footnote}</span>
        </p>
      </div>
    </details>
  );
}

/** Таймер для одного предмета (на странице варианта — текущий предмет). */
export function SubjectExamCountdownCard({ subjectKey }) {
  const ctx = useContext(ExamCountdownContext);
  if (!ctx?.valid) return null;
  const { cfg, now, levelLabel, footnoteSeed, hourBucket, level } = ctx;
  const c = cfg[subjectKey];
  if (!c) return null;
  const targetTs = getNextExamTimestamp(level, subjectKey);
  const slot =
    PHRASE_SLOT[subjectKey] ??
    (subjectKey.split("").reduce((a, c) => a + c.charCodeAt(0), 0) % COMPARISON_FACTORIES.length);
  const footnotePhraseIndex = phraseIndexFromSeed(footnoteSeed, hourBucket, slot);

  return (
    <CountdownCard
      subject={c.subject}
      dateLine={c.dateLine}
      targetTs={targetTs}
      accent={subjectKey}
      now={now}
      levelLabel={levelLabel}
      footnotePhraseIndex={footnotePhraseIndex}
    />
  );
}

function ruPlural(n, forms) {
  const nn = Math.abs(n) % 100;
  const n1 = Math.abs(n) % 10;
  if (nn > 10 && nn < 20) return forms[2];
  if (n1 === 1) return forms[0];
  if (n1 >= 2 && n1 <= 4) return forms[1];
  return forms[2];
}

function parseDateParts(dateLine) {
  const chunks = dateLine.split("·").map((s) => s.trim()).filter(Boolean);
  if (chunks.length >= 2) return { calendar: chunks[0], timeSlot: chunks[1] };
  const m = dateLine.match(/^(.+\S)\s*·\s*(\d{1,2}:\d{2})/u);
  if (m) return { calendar: m[1].trim(), timeSlot: m[2].trim() };
  return { calendar: dateLine, timeSlot: "10:00" };
}

/**
 * Компактный таймер до экзамена (отдельный блок на странице выбора предмета).
 */
export function SubjectExamCountdownCompactCard({
  level,
  subjectKey,
  to,
  locked,
  onLockedClick,
}) {
  const valid = level === "ege" || level === "oge";
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    if (!valid) return undefined;
    const id = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(id);
  }, [valid]);

  if (!valid) return null;
  const row = CONFIG[level]?.[subjectKey];
  if (!row) return null;

  const targetTs = getNextExamTimestamp(level, subjectKey);
  const remainMs = Math.max(0, targetTs - now);
  const { days, hours, minutes, seconds } = splitRemain(remainMs);

  const { calendar, timeSlot } = parseDateParts(row.dateLine);
  const levelBadge = level === "ege" ? "ЕГЭ · 11 класс" : "ОГЭ · 9 класс";

  const daysLabel = ruPlural(days, ["день", "дня", "дней"]);
  const hourLabel = ruPlural(hours, ["час", "часа", "часов"]);
  const minShort = ruPlural(minutes, ["мин", "мин", "мин"]);
  const secShort = ruPlural(seconds, ["сек", "сек", "сек"]);

  const dateLinePretty = `${calendar} · начало в ${timeSlot}`;

  return (
    <article
      className={`sc-ec-compact sc-ec-compact--${subjectKey}`}
      aria-label={`${row.subject}: до экзамена осталось`}
    >
      <header className="sc-ec-compact-top">
        <span className="sc-ec-compact-subject">{row.subject}</span>
        <span className="sc-ec-compact-exam">{levelBadge}</span>
      </header>

      <p className="sc-ec-compact-datetime">{dateLinePretty}</p>

      <div className="sc-ec-compact-count" role="timer" aria-live="polite">
        <div className="sc-ec-compact-seg sc-ec-compact-seg--days">
          <strong>{days}</strong>
          <span className="sc-ec-compact-unit">{daysLabel}</span>
        </div>
        <span className="sc-ec-compact-pipe" aria-hidden>
          |
        </span>
        <div className="sc-ec-compact-seg">
          <strong>{hours}</strong>
          <span className="sc-ec-compact-unit">{hourLabel}</span>
        </div>
        <span className="sc-ec-compact-pipe" aria-hidden>
          |
        </span>
        <div className="sc-ec-compact-seg">
          <strong>{pad2(minutes)}</strong>
          <span className="sc-ec-compact-unit">{minShort}</span>
        </div>
        <span className="sc-ec-compact-pipe" aria-hidden>
          |
        </span>
        <div className="sc-ec-compact-seg">
          <strong>{pad2(seconds)}</strong>
          <span className="sc-ec-compact-unit">{secShort}</span>
        </div>
      </div>

      {locked ? (
        <Link
          to={to}
          className="sc-ec-compact-cta"
          onClick={onLockedClick}
          aria-disabled="true"
        >
          Перейти к подготовке
        </Link>
      ) : (
        <Link to={to} className="sc-ec-compact-cta">
          Перейти к подготовке
        </Link>
      )}
    </article>
  );
}

