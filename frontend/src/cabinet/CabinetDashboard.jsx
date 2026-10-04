import { useEffect, useMemo, useState } from "react";
import { Link, useNavigate, useOutletContext } from "react-router-dom";
import { displayName } from "../pages/CabinetAuthPage";
import { mapApiStudent } from "./cabinetMappers";
import { CabinetEmptyState } from "./CabinetSectionUi";
import CabinetIcon from "./CabinetIcons";
import CabinetModal from "./components/CabinetModal";
import HomeworkAssignModal from "./components/HomeworkAssignModal";
import TeacherOnboardingCard from "./components/TeacherOnboardingCard";
import LessonPreviewModal from "../components/LessonPreviewModal";
import InterestingPreviewModal from "../components/InterestingPreviewModal";
import { formatUsageItemFrac } from "./storageFormat";
import "../styles/material-access.css";
import { closeConnectionCheck } from "./connectionCheck/openConnectionCheck";
import { trackActivationIntent } from "./activationAnalytics";
import {
  fetchBillingDashboard,
  fetchDashboard,
  fetchStudents,
  normalizeCabinetList,
} from "../utils/cabinetAuth";
import { readLastVariant, readRecentLessons } from "../utils/recentLessons";
import {
  chooseNote,
  localIso,
  readMemory,
  rememberDailyNote,
  rememberSpotlight,
  writeMemory,
} from "./dashboardEngagement";
import { formatMoney } from "./billing/billingFormat";
import { PAYMENTS_ENABLED } from "./featureFlags";
import "./styles/teacher-dashboard.css";

const PERSONAL_TYPES = new Set(["personal", "blocked"]);
const AVATAR_TONES = [
  { bg: "#e9effc", color: "#7694ca" },
  { bg: "#f3ecfa", color: "#a085b9" },
  { bg: "#edf3e6", color: "#8da574" },
  { bg: "#fcefe4", color: "#c69b78" },
  { bg: "#e8f3f4", color: "#79a3a7" },
];
const COVER_TONES = ["blue", "lilac", "green"];
const MEDAL_TONES = ["blue", "gold", "purple"];
const MEDAL_GLYPH = {
  "ach-lessons-1": "cap",
  "ach-lessons-10": "flame",
  "ach-lessons-50": "trophy",
  "ach-lessons-100": "trophy",
  "ach-tasks-100": "check",
  "ach-tasks-500": "check",
  "ach-tasks-1000": "check",
  "ach-homework-clear": "check",
  "ach-interactive": "wand",
};

function MedalGlyph({ name }) {
  const props = {
    viewBox: "0 0 24 24",
    fill: "none",
    stroke: "currentColor",
    strokeWidth: "1.7",
    strokeLinecap: "round",
    strokeLinejoin: "round",
    "aria-hidden": true,
  };
  if (name === "cap") {
    return (
      <svg {...props}>
        <path d="M21.42 10.92a1 1 0 0 0-.02-1.84L12.83 5.18a2 2 0 0 0-1.66 0L2.6 9.08a1 1 0 0 0 0 1.83l8.57 3.91a2 2 0 0 0 1.66 0z" />
        <path d="M22 10v6" />
        <path d="M6 12.5V16a6 3 0 0 0 12 0v-3.5" />
      </svg>
    );
  }
  if (name === "flame") {
    return (
      <svg {...props}>
        <path d="M8.5 14.5A2.5 2.5 0 0 0 11 12c0-1.5-1-2-1-3.5 0-1.5 1.5-2.5 2.5-3.5 1 2 2.5 3 2.5 5.5a2.5 2.5 0 0 0 2.5 2.5c1.5 0 2.5-1 2.5-2.5 0 4-3 7-7 7s-7-3-7-6c0 1.5 1 2.5 2.5 2.5z" />
      </svg>
    );
  }
  if (name === "trophy") {
    return (
      <svg {...props}>
        <path d="M8 21h8" />
        <path d="M12 17v4" />
        <path d="M7 4h10v5a5 5 0 0 1-10 0z" />
        <path d="M17 5h2a2 2 0 0 1 0 4h-2" />
        <path d="M7 5H5a2 2 0 0 0 0 4h2" />
      </svg>
    );
  }
  if (name === "wand") {
    return (
      <svg {...props}>
        <path d="m15 4 5 5" />
        <path d="m13 6 5 5-9 9H4v-5z" />
        <path d="M5 3v3" />
        <path d="M3.5 4.5h3" />
        <path d="M19 14v2" />
        <path d="M18 15h2" />
      </svg>
    );
  }
  if (name === "book") {
    return (
      <svg {...props}>
        <path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20" />
        <path d="M6.5 2H20v20H6.5A2.5 2.5 0 0 1 4 19.5v-15A2.5 2.5 0 0 1 6.5 2z" />
      </svg>
    );
  }
  return (
    <svg {...props}>
      <circle cx="12" cy="12" r="9" />
      <path d="m8.5 12.5 2.5 2.5 4.5-5" />
    </svg>
  );
}

function greetingForHour(hour) {
  if (isNightHour(hour)) return { text: "Доброй ночи", emoji: "🌙", period: "night" };
  if (hour < 12) return { text: "Доброе утро", emoji: "☀️", period: "morning" };
  if (hour < 18) return { text: "Добрый день", emoji: "🌤️", period: "day" };
  return { text: "Добрый вечер", emoji: "🌆", period: "evening" };
}

function isNightHour(hour) {
  return hour >= 22 || hour < 6;
}

function formatEventTime(isoString) {
  if (!isoString) return "";
  return new Date(isoString).toLocaleTimeString("ru-RU", {
    hour: "2-digit",
    minute: "2-digit",
  });
}

function formatEventRange(startIso, endIso) {
  const start = formatEventTime(startIso);
  const end = formatEventTime(endIso);
  if (start && end) return `${start}–${end}`;
  return start || end;
}

function pluralRu(n, one, few, many) {
  const abs = Math.abs(n) % 100;
  const n1 = abs % 10;
  if (abs > 10 && abs < 20) return many;
  if (n1 === 1) return one;
  if (n1 >= 2 && n1 <= 4) return few;
  return many;
}

function capitalize(text) {
  const value = String(text || "");
  return value ? value.charAt(0).toUpperCase() + value.slice(1) : "";
}

function initials(name) {
  const parts = String(name || "").trim().split(/\s+/).filter(Boolean);
  if (!parts.length) return "У";
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return `${parts[0].charAt(0)}${parts[1].charAt(0)}`.toUpperCase();
}

function formatSubmittedAgo(isoString) {
  if (!isoString) return "";
  const d = new Date(isoString);
  const mins = Math.max(0, Math.round((Date.now() - d.getTime()) / 60000));
  if (mins < 1) return "только что";
  if (mins < 60) return `${mins} ${pluralRu(mins, "минуту", "минуты", "минут")} назад`;
  const hours = Math.round(mins / 60);
  if (hours < 24) return `${hours} ${pluralRu(hours, "час", "часа", "часов")} назад`;
  const days = Math.round(hours / 24);
  if (days === 1) return "вчера";
  return d.toLocaleDateString("ru-RU", { day: "numeric", month: "short" });
}

function dayKeyFromDate(date) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function dayKeyFromIso(isoString) {
  if (!isoString) return "";
  return dayKeyFromDate(new Date(isoString));
}

function shiftDate(date, days) {
  const next = new Date(date);
  next.setDate(next.getDate() + days);
  return next;
}

function weekDates(anchor) {
  const start = new Date(anchor);
  start.setHours(12, 0, 0, 0);
  start.setDate(start.getDate() - ((start.getDay() + 6) % 7));
  return Array.from({ length: 7 }, (_, index) => shiftDate(start, index));
}

function toneFor(name) {
  const text = String(name || "");
  let hash = 0;
  for (let index = 0; index < text.length; index += 1) {
    hash = (hash + text.charCodeAt(index)) % AVATAR_TONES.length;
  }
  return AVATAR_TONES[hash];
}

function weekdayShort(date) {
  return date.toLocaleDateString("ru-RU", { weekday: "short" }).replace(".", "");
}

function mapReview(item) {
  return {
    id: item.id,
    title: item.title || "Работа",
    studentName: item.student_name || "Ученик",
    subject: item.subject_label || "",
    submittedAt: item.submitted_at || item.created_at,
    avatarUrl: item.avatar_url || "",
    href: item.id ? `/cabinet/review/${item.id}` : "/cabinet/review",
  };
}

function ReviewAvatar({ name, src }) {
  const [failed, setFailed] = useState(false);
  const url = src && !failed ? mediaUrl(src) : null;
  const tone = toneFor(name);
  return (
    <span
      className="td-avatar"
      style={url ? undefined : { background: tone.bg, color: tone.color }}
      aria-hidden="true"
    >
      {url ? <img src={url} alt="" onError={() => setFailed(true)} /> : initials(name)}
    </span>
  );
}

function mapEvent(ev, now) {
  const startsAt = ev.starts_at ? new Date(ev.starts_at) : null;
  const endsAt = ev.ends_at ? new Date(ev.ends_at) : null;
  const isPersonal = PERSONAL_TYPES.has(ev.event_type);
  const isCurrent = Boolean(startsAt && endsAt && startsAt <= now && endsAt >= now);
  const isDone = ev.status === "done" || ev.status === "completed"
    || Boolean(endsAt && endsAt < now);
  const travel = Number(ev.travel_before_minutes) || Number(ev.travel_after_minutes) || 0;
  const subject = isPersonal
    ? (ev.title || "Личное")
    : (ev.student_subject_label || ev.title || "Урок");
  const studentName = isPersonal
    ? "Личное"
    : (ev.student_name || ev.group_title || ev.audience || ev.title || "Урок");
  const topic = isPersonal
    ? (ev.description || "")
    : (ev.topic || ev.subtopic || "");
  return {
    id: ev.id,
    startsAt: ev.starts_at,
    endsAt: ev.ends_at,
    time: formatEventTime(ev.starts_at),
    timeRange: formatEventRange(ev.starts_at, ev.ends_at),
    studentName,
    subject,
    topic,
    hasTravel: travel > 0,
    isPersonal,
    isCurrent,
    isDone,
    isOnline: ev.format === "online" || ev.format === "Онлайн",
    hasMaterial: Boolean(
      String(ev.materials || "").trim()
      || ev.lesson
      || ev.lesson_plan_item,
    ),
  };
}

function eventHref(event) {
  return event?.id
    ? `/cabinet/schedule?event=${encodeURIComponent(event.id)}`
    : "/cabinet/schedule";
}

function materialsHref(event) {
  return event?.id
    ? `/lessons?for_event=${encodeURIComponent(event.id)}`
    : "/lessons";
}

function minutesUntil(isoString) {
  if (!isoString) return null;
  return Math.round((new Date(isoString).getTime() - Date.now()) / 60000);
}

function liveClock(event, todayKey) {
  if (!event?.timeRange) return "";
  if (event.isCurrent && event.endsAt) {
    const mins = Math.max(0, Math.round((new Date(event.endsAt).getTime() - Date.now()) / 60000));
    return `${event.timeRange} · ещё ${mins} ${pluralRu(mins, "минуту", "минуты", "минут")}`;
  }
  const eventKey = dayKeyFromIso(event.startsAt);
  if (eventKey && todayKey && eventKey !== todayKey) {
    const when = new Date(event.startsAt).toLocaleDateString("ru-RU", { day: "numeric", month: "short" });
    return `${event.timeRange} · ${when}`;
  }
  const soon = formatCountdown(event.startsAt, false);
  if (!soon || soon === event.time || event.timeRange.startsWith(soon)) return event.timeRange;
  return `${event.timeRange} · ${soon}`;
}

function formatCountdown(isoString, isCurrent) {
  if (isCurrent) return "Идёт сейчас";
  const mins = minutesUntil(isoString);
  if (mins == null) return "";
  if (mins <= 0) return "Скоро";
  if (mins < 60) return `Через ${mins} ${pluralRu(mins, "минуту", "минуты", "минут")}`;
  const hours = Math.floor(mins / 60);
  const rest = mins % 60;
  if (hours < 12) {
    return rest
      ? `Через ${hours} ч ${rest} мин`
      : `Через ${hours} ${pluralRu(hours, "час", "часа", "часов")}`;
  }
  return formatEventTime(isoString);
}

function HelloMark({ period }) {
  if (period === "night") {
    return (
      <svg className="td-hello-sun" viewBox="0 0 24 24" aria-hidden="true">
        <path d="M21 14.5A8.5 8.5 0 1 1 9.5 3 7 7 0 0 0 21 14.5z" />
      </svg>
    );
  }
  return (
    <svg className="td-hello-sun" viewBox="0 0 24 24" aria-hidden="true">
      <circle cx="12" cy="12" r="4" />
      <path d="M12 2v2" />
      <path d="M12 20v2" />
      <path d="m4.93 4.93 1.41 1.41" />
      <path d="m17.66 17.66 1.41 1.41" />
      <path d="M2 12h2" />
      <path d="M20 12h2" />
      <path d="m6.34 17.66-1.41 1.41" />
      <path d="m19.07 4.93-1.41 1.41" />
    </svg>
  );
}

function mediaUrl(url) {
  if (!url) return null;
  const idx = String(url).indexOf("/media/");
  if (idx >= 0) return url.slice(idx);
  return url;
}

function SuggestedMaterials({ items, onOpen, continueItems }) {
  const cards = (items || []).slice(0, 3);
  if (!cards.length && !continueItems?.length) return null;
  return (
    <section className="td-panel td-resources" aria-labelledby="td-resources-title">
      <div className="td-panel__head">
        <div>
          <h2 id="td-resources-title">Вам пригодится</h2>
          <p>Подобрано для ближайших уроков</p>
        </div>
        <Link to="/lessons" className="td-text-link">
          В каталог
          <CabinetIcon name="arrow" />
        </Link>
      </div>
      {cards.length ? (
        <div className="td-resource-grid">
          {cards.map((item, index) => {
            const cover = mediaUrl(item.cover_url);
            const kind = item.kind_label || (item.kind === "interesting" ? "Тренажёр" : "Готовый урок");
            return (
              <article key={`${item.kind}-${item.id}`} className="td-resource">
                <button
                  type="button"
                  className={`td-resource__cover is-${COVER_TONES[index % COVER_TONES.length]}${cover ? " has-image" : ""}`}
                  style={cover ? { backgroundImage: `url("${cover}")` } : undefined}
                  onClick={() => onOpen(item)}
                  aria-label={`Открыть ${item.title}`}
                >
                  {cover ? null : <span className="td-resource__formula">{String(item.title || "").slice(0, 12)}</span>}
                </button>
                <p className="td-resource__type">{kind}</p>
                <button type="button" className="td-resource__title" onClick={() => onOpen(item)}>
                  {item.title}
                </button>
                {item.reason ? <p className="td-resource__meta">{item.reason}</p> : null}
              </article>
            );
          })}
        </div>
      ) : null}
      {continueItems?.length ? (
        <div className="td-continue">
          {continueItems.map((item) => (
            <Link key={item.key} to={item.href} className="td-text-link">
              {item.title || item.label}
              <CabinetIcon name="arrow" />
            </Link>
          ))}
        </div>
      ) : null}
    </section>
  );
}

function SavingsPanel({ time }) {
  const [open, setOpen] = useState(false);
  if (!time) return null;
  const parts = time.parts || [];
  return (
    <section className="td-panel td-savings" aria-labelledby="td-savings-title">
      <div className="td-panel__head">
        <h2 id="td-savings-title">Вы сэкономили</h2>
        <button
          type="button"
          className="td-icon-btn"
          aria-expanded={open}
          aria-label="Как рассчитывается сэкономленное время"
          onClick={() => setOpen((value) => !value)}
        >
          <CabinetIcon name="help" />
        </button>
      </div>
      <div className="td-savings__top">
        <div>
          <div className="td-savings__value">{time.value}</div>
          <p className="td-savings__period">{time.scope}</p>
        </div>
        <div className="td-savings__clock" aria-hidden="true">
          <CabinetIcon name="clock" />
        </div>
      </div>
      {parts.length ? (
        <div className="td-time-bar" aria-hidden="true">
          {parts.map((part, index) => (
            <span
              key={part.key || part.label}
              className={index % 2 ? "is-lime" : ""}
              style={{ flex: Number(part.count) || 1 }}
            />
          ))}
        </div>
      ) : null}
      {parts.length ? (
        <div className="td-time-detail">
          {parts.map((part, index) => (
            <div key={part.key || part.label}>
              <span className={`td-legend${index % 2 ? " is-lime" : ""}`} />
              {part.label}
              <strong>{part.value}</strong>
            </div>
          ))}
        </div>
      ) : null}
      {open ? <p className="td-savings__note">{time.note || time.hint}</p> : null}
    </section>
  );
}

function AchievementsPanel({ board, userId }) {
  const achievements = board?.achievements;
  const [easterOpen, setEasterOpen] = useState(false);
  const todayIso = useMemo(() => localIso(new Date()), []);

  useEffect(() => {
    const easter = board?.easter;
    if (!easter || userId == null) return;
    if (readMemory(userId).seenAt?.[easter.id]) setEasterOpen(true);
  }, [board?.easter, userId]);

  if (!achievements) return null;
  const unlocked = (achievements.items || []).filter((item) => !item.locked);
  const locked = (achievements.items || []).filter((item) => item.locked);
  const shown = [...unlocked, ...locked].slice(0, 3);
  const milestone = achievements.milestone;

  const openEaster = () => {
    const easter = board?.easter;
    if (!easter || easterOpen) return;
    setEasterOpen(true);
    const next = rememberSpotlight(readMemory(userId), {
      kind: "easter",
      id: easter.id,
      cooldown_days: easter.cooldown_days,
      title: easter.title,
    }, todayIso);
    writeMemory(userId, next);
  };

  return (
    <section className="td-panel td-achievements" aria-labelledby="td-achievements-title">
      <div className="td-panel__head">
        <h2 id="td-achievements-title">Ваши достижения</h2>
        <span className="td-achievements__mark" aria-hidden="true">
          <MedalGlyph name="trophy" />
        </span>
      </div>
      {board.streak ? <p className="td-streak">{board.streak.label}. {board.streak.hint}</p> : null}
      {shown.length ? (
        <div className="td-medals">
          {shown.map((item, index) => (
            <div key={item.id} className={`td-medal-item${item.locked ? " is-locked" : ""}`}>
              <span className={`td-medal is-${MEDAL_TONES[index % MEDAL_TONES.length]}`} aria-hidden="true">
                <MedalGlyph name={MEDAL_GLYPH[item.id] || "check"} />
              </span>
              <span>{item.title}</span>
            </div>
          ))}
        </div>
      ) : null}
      {milestone ? (
        <>
          <div className="td-goal">
            <span>{milestone.title}</span>
            <strong>{milestone.current} / {milestone.target}</strong>
          </div>
          <div
            className="td-goal__track"
            role="progressbar"
            aria-valuemin={0}
            aria-valuemax={100}
            aria-valuenow={milestone.percent}
            aria-label={`${milestone.title}: ${milestone.current} из ${milestone.target}`}
          >
            <span style={{ width: `${milestone.percent}%` }} />
          </div>
        </>
      ) : null}
      {board.easter ? (
        <>
          <button type="button" className="td-easter" onClick={openEaster} disabled={easterOpen}>
            {easterOpen ? (board.easter.title || "Открыто") : "Здесь спрятана маленькая пасхалка"}
          </button>
          {easterOpen && board.easter.body ? <p className="td-streak">{board.easter.body}</p> : null}
        </>
      ) : null}
    </section>
  );
}

function MotivationBar({ daily, userId }) {
  const todayIso = useMemo(() => localIso(new Date()), []);
  const candidates = daily?.candidates || [];
  const [memory, setMemory] = useState(() => readMemory(userId));
  const chosen = useMemo(
    () => chooseNote(candidates, memory, todayIso),
    [candidates, memory, todayIso],
  );
  const [index, setIndex] = useState(0);

  useEffect(() => {
    const found = candidates.findIndex((item) => item.id === chosen?.id);
    setIndex(found >= 0 ? found : 0);
  }, [candidates, chosen?.id]);

  useEffect(() => {
    if (!chosen || userId == null) return;
    const current = readMemory(userId);
    if (current.noteToday?.date === todayIso && current.noteToday?.id === chosen.id) return;
    const next = rememberDailyNote(current, chosen, todayIso);
    writeMemory(userId, next);
    setMemory(next);
  }, [chosen, userId, todayIso]);

  const text = candidates[index]?.text || chosen?.text;
  if (!text) return null;

  return (
    <aside className="td-quote" aria-label="Мотивационная фраза">
      <div className="td-quote__icon" aria-hidden="true">
        <CabinetIcon name="spark" />
      </div>
      <div>
        <small>Небольшое напоминание для вас</small>
        <p>{text}</p>
      </div>
      {candidates.length > 1 ? (
        <button
          type="button"
          className="td-icon-btn"
          aria-label="Другая мотивационная фраза"
          onClick={() => setIndex((value) => (value + 1) % candidates.length)}
        >
          <CabinetIcon name="flip" />
        </button>
      ) : null}
    </aside>
  );
}

function DashboardLimits({ items }) {
  const rows = items || [];
  if (!rows.length) return null;
  const exhausted = rows.some((item) => item.exhausted && !item.unlimited);

  return (
    <section className="td-panel td-limits">
      <div className="td-panel__head">
        <h2>Лимиты тарифа</h2>
        <Link to="/cabinet/upgrade" className="td-text-link">Тарифы</Link>
      </div>
      {rows.length === 0 ? (
        <p className="td-empty">Данных по лимитам пока нет.</p>
      ) : (
        <div className="td-limits__list">
          {rows.map((item) => {
            const unlimited = Boolean(item.unlimited);
            const percent = Math.min(100, Math.max(0, Number(item.percent) || 0));
            const full = Boolean(item.exhausted);
            const near = Boolean(item.near_limit) || (!unlimited && !full && percent >= 80);
            const frac = formatUsageItemFrac(item);
            return (
              <div
                key={item.key || item.label}
                className={`td-limit${full ? " is-full" : ""}${near ? " is-near" : ""}`}
              >
                <span className="td-limit__top">
                  <span>{item.label}</span>
                  <strong>{frac}</strong>
                </span>
                {unlimited ? (
                  <span className="td-limit__open">без лимита</span>
                ) : (
                  <span
                    className="td-limit__bar"
                    role="progressbar"
                    aria-valuemin={0}
                    aria-valuemax={100}
                    aria-valuenow={percent}
                    aria-label={`${item.label}: ${percent}%`}
                  >
                    <span style={{ width: `${percent}%` }} />
                  </span>
                )}
              </div>
            );
          })}
        </div>
      )}
      {exhausted ? (
        <Link to="/cabinet/upgrade" className="td-limit__warn">
          Лимит исчерпан — посмотреть тарифы
        </Link>
      ) : null}
    </section>
  );
}

function DashboardSkeleton() {
  return (
    <main className="td-page">
      <div className="td-content" style={{ display: "grid", gap: 18 }}>
        <div className="td-skel" />
        <div className="td-skel" />
        <div className="td-skel" />
      </div>
    </main>
  );
}

export default function CabinetDashboard() {
  const { user, usageItems, subscriptionLoading } = useOutletContext();
  const navigate = useNavigate();
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [homeworkTarget, setHomeworkTarget] = useState(null);
  const [studentPickerOpen, setStudentPickerOpen] = useState(false);
  const [pickerStudents, setPickerStudents] = useState([]);
  const [pickerValue, setPickerValue] = useState("");
  const [assignLoading, setAssignLoading] = useState(false);
  const [billingDash, setBillingDash] = useState(null);
  const [previewItem, setPreviewItem] = useState(null);
  const [selectedDay, setSelectedDay] = useState(() => {
    const date = new Date();
    date.setHours(12, 0, 0, 0);
    return date;
  });
  const firstName = displayName(user).split(" ")[0];

  const openHomeworkAssign = async (student) => {
    if (student?.id) {
      setHomeworkTarget({ student: { id: student.id, name: student.name || student.studentName || student.student_name } });
      return;
    }
    setAssignLoading(true);
    try {
      const raw = await fetchStudents({ status: "active" });
      const list = normalizeCabinetList(raw).map(mapApiStudent);
      if (!list.length) {
        navigate("/cabinet/students?invite=1");
        return;
      }
      if (list.length === 1) {
        setHomeworkTarget({ student: list[0] });
        return;
      }
      setPickerStudents(list);
      setPickerValue(list[0].id);
      setStudentPickerOpen(true);
    } catch {
      navigate("/cabinet/students");
    } finally {
      setAssignLoading(false);
    }
  };

  const confirmStudentPick = () => {
    const student = pickerStudents.find((s) => s.id === pickerValue);
    if (!student) return;
    setStudentPickerOpen(false);
    setHomeworkTarget({ student });
  };

  useEffect(() => {
    let cancelled = false;
    const loadDashboard = async ({ soft = false } = {}) => {
      if (!soft) setLoading(true);
      try {
        const payload = await fetchDashboard();
        if (!cancelled) {
          setData(payload);
          setError(null);
        }
      } catch (err) {
        if (!cancelled) setError(err.message || "Не удалось загрузить данные");
      } finally {
        if (!cancelled) setLoading(false);
      }
    };
    loadDashboard();
    if (PAYMENTS_ENABLED) {
      fetchBillingDashboard()
        .then((payload) => { if (!cancelled) setBillingDash(payload); })
        .catch(() => {});
    }
    const onFocus = () => loadDashboard({ soft: true });
    const onVisibility = () => {
      if (document.visibilityState === "visible") loadDashboard({ soft: true });
    };
    window.addEventListener("focus", onFocus);
    document.addEventListener("visibilitychange", onVisibility);
    return () => {
      cancelled = true;
      window.removeEventListener("focus", onFocus);
      document.removeEventListener("visibilitychange", onVisibility);
    };
  }, []);

  const today = useMemo(() => new Date(), []);
  const todayKey = dayKeyFromDate(today);
  const selectedKey = dayKeyFromDate(selectedDay);
  const lessonDays = useMemo(
    () => new Set(
      data?.calendar_lesson_days != null
        ? data.calendar_lesson_days
        : (data?.calendar_event_days || [])
    ),
    [data?.calendar_lesson_days, data?.calendar_event_days],
  );

  const todayEvents = useMemo(
    () => (data?.today_events || [])
      .map((ev) => mapEvent(ev, today))
      .sort((a, b) => String(a.startsAt).localeCompare(String(b.startsAt))),
    [data?.today_events, today],
  );

  const knownEvents = useMemo(() => {
    const upcoming = (data?.upcoming_events || []).map((ev) => mapEvent(ev, today));
    const byId = new Map();
    [...todayEvents, ...upcoming].forEach((event) => {
      byId.set(event.id || `${event.startsAt}-${event.studentName}`, event);
    });
    return [...byId.values()];
  }, [todayEvents, data?.upcoming_events, today]);

  const nextEvent = useMemo(() => {
    const todayLessons = todayEvents.filter((event) => !event.isPersonal);
    const upcomingLesson = knownEvents.find((event) => !event.isPersonal && !event.isDone);
    return todayLessons.find((event) => event.isCurrent)
      || todayLessons.find((event) => !event.isDone)
      || upcomingLesson
      || null;
  }, [todayEvents, knownEvents]);

  const pendingReviews = useMemo(
    () => (data?.pending_reviews || []).map(mapReview),
    [data?.pending_reviews],
  );

  const suggestedMaterials = data?.suggested_materials || [];
  const onboarding = data?.onboarding || null;
  const onboardingVisible = Boolean(onboarding?.visible);
  const lessonsCount = data?.today_lessons_count
    ?? todayEvents.filter((event) => !event.isPersonal).length;
  const reviewsCount = data?.pending_reviews_count ?? pendingReviews.length;
  const debtTotal = Number(billingDash?.debt_total) || 0;
  const board = data?.engagement?.board || null;

  const todayLessons = todayEvents.filter((event) => !event.isPersonal);
  const remainingLessons = todayLessons.filter((event) => !event.isDone).length;
  const lessonsFinished = todayLessons.length > 0 && remainingLessons === 0;
  const quietLead = lessonsFinished
    ? "На сегодня уроки уже прошли"
    : "Сегодня занятий нет";
  const greeting = greetingForHour(today.getHours());
  const night = isNightHour(today.getHours());
  const dateLine = capitalize(today.toLocaleDateString("ru-RU", {
    weekday: "long",
    day: "numeric",
    month: "long",
  }));
  const lessonWord = pluralRu(lessonsCount, "урок", "урока", "уроков");
  const todaySummary = lessonsCount === 0
    ? "Сегодня без занятий. Всё нужное — под рукой."
    : `Сегодня ${lessonsCount} ${lessonWord}. Всё нужное — под рукой.`;

  const week = useMemo(() => weekDates(selectedDay), [selectedDay]);
  const dayEvents = knownEvents
    .filter((event) => dayKeyFromIso(event.startsAt) === selectedKey)
    .sort((a, b) => String(a.startsAt).localeCompare(String(b.startsAt)));
  const dayLessons = dayEvents.filter((event) => !event.isPersonal);
  const selectedCaption = capitalize(selectedDay.toLocaleDateString("ru-RU", {
    day: "numeric",
    month: "long",
    weekday: "long",
  }));

  const continueItems = useMemo(() => {
    const items = [];
    const recentLesson = readRecentLessons()[0] || null;
    const lastVariant = readLastVariant();
    if (recentLesson) {
      items.push({
        key: "material",
        label: "Последний материал",
        title: recentLesson.title || recentLesson.slug,
        href: `/lessons?preview=${encodeURIComponent(recentLesson.slug)}`,
      });
    }
    if (lastVariant) {
      items.push({
        key: "variant",
        label: "Незавершённый вариант",
        title: "Открыть собранный вариант",
        href: `/${encodeURIComponent(lastVariant.level)}/${encodeURIComponent(lastVariant.subject)}/variant/${encodeURIComponent(lastVariant.variantId)}`,
      });
    }
    return items.slice(0, 2);
  }, []);

  const openCreateLesson = () => {
    trackActivationIntent("lesson_creation_started", { source: "dashboard_quick" });
    navigate("/cabinet/schedule?create=1");
  };

  if (loading) return <DashboardSkeleton />;

  if (error && !data) {
    return (
      <CabinetEmptyState
        icon="alert"
        title="Не удалось загрузить данные"
        text={error}
      />
    );
  }

  const liveClass = nextEvent?.isPersonal
    ? "td-panel td-live is-personal"
    : nextEvent?.isCurrent
      ? "td-panel td-live"
      : "td-panel td-live is-next";
  const shownReviews = pendingReviews.slice(0, 3);

  return (
    <main className="td-page">
      <div className="td-content">
        <section className="td-welcome" aria-labelledby="td-greeting">
          <div>
            <div className="td-eyebrow">
              <CabinetIcon name="calendar" />
              {dateLine}
            </div>
            <h1 id="td-greeting">
              {greeting.text}, {firstName}! <HelloMark period={greeting.period} />
            </h1>
            <p className="td-welcome__lead">{todaySummary}</p>
          </div>
          <button type="button" className="td-btn" onClick={openCreateLesson}>
            <CabinetIcon name="plus" />
            Добавить занятие
          </button>
        </section>

        {night ? (
          <p className="td-night" role="status">Рекомендуем отдохнуть! Встретимся завтра!</p>
        ) : null}

        {onboardingVisible ? <TeacherOnboardingCard onboarding={onboarding} /> : null}

        <div className="td-grid">
            {nextEvent ? (
              <section className={liveClass} aria-labelledby="td-live-title">
                <div className="td-live__top">
                  <span className="td-live__label">
                    {nextEvent.isCurrent && !nextEvent.isPersonal ? <span className="td-live__dot" /> : null}
                    {nextEvent.isPersonal
                      ? "Личное"
                      : nextEvent.isCurrent
                        ? "Сейчас идёт урок"
                        : "Ближайший урок"}
                  </span>
                  <span className="td-live__meta">
                    {!nextEvent.isPersonal && nextEvent.subject ? (
                      <span className="td-live__subject">
                        {nextEvent.subject}
                        {nextEvent.hasTravel ? " · в пути" : ""}
                      </span>
                    ) : null}
                    <span className="td-live__time">
                      <CabinetIcon name="clock" />
                      {liveClock(nextEvent, todayKey)}
                    </span>
                  </span>
                </div>
                <div className="td-live__copy">
                  <h2 id="td-live-title">
                    {nextEvent.isPersonal ? nextEvent.subject : (nextEvent.topic || nextEvent.subject || "Урок")}
                  </h2>
                  {!nextEvent.isPersonal ? (
                    <div className="td-live__student">
                      <span className="td-mini">{initials(nextEvent.studentName)}</span>
                      {nextEvent.studentName}
                    </div>
                  ) : null}
                </div>
                {!nextEvent.isPersonal ? (
                  <div className="td-live__art" aria-hidden="true">
                    <div className="td-live__rule" />
                    <div className="td-live__rule is-short" />
                    <span>{nextEvent.isCurrent ? "Сейчас" : "Далее"}</span>
                  </div>
                ) : null}
                <div className="td-live__bottom">
                  <Link
                    to={eventHref(nextEvent)}
                    className={nextEvent.isPersonal ? "td-btn td-btn--blue" : "td-btn td-btn--lime"}
                    onClick={() => { if (nextEvent.isCurrent) closeConnectionCheck(); }}
                  >
                    {nextEvent.isPersonal ? "В расписании" : "Открыть урок"}
                    <CabinetIcon name="arrow" />
                  </Link>
                  {!nextEvent.isPersonal ? (
                    <Link to={materialsHref(nextEvent)} className="td-live__materials">
                      <CabinetIcon name="note" />
                      Материалы урока
                    </Link>
                  ) : null}
                </div>
              </section>
            ) : (
              <section className="td-panel td-live is-empty">
                <h2>{quietLead}</h2>
                <p>{lessonsFinished ? "Ближайших занятий больше нет." : "Здесь появится ближайшее занятие."}</p>
                <button type="button" className="td-btn td-btn--blue" onClick={openCreateLesson}>
                  Добавить занятие
                </button>
              </section>
            )}

          <div className="td-band">
            <section className="td-panel td-schedule" aria-labelledby="td-schedule-title">
              <div className="td-panel__head">
                <div>
                  <h2 id="td-schedule-title">
                    План на день
                    <span className="td-chip">
                      {dayLessons.length} {pluralRu(dayLessons.length, "урок", "урока", "уроков")}
                    </span>
                  </h2>
                  <p>{selectedCaption}</p>
                </div>
                <div className="td-schedule__controls">
                  <button
                    type="button"
                    className={`td-today${selectedKey === todayKey ? " is-on" : ""}`}
                    onClick={() => {
                      const date = new Date();
                      date.setHours(12, 0, 0, 0);
                      setSelectedDay(date);
                    }}
                  >
                    Сегодня
                  </button>
                  <button type="button" className="td-icon-btn" aria-label="Предыдущий день" onClick={() => setSelectedDay((day) => shiftDate(day, -1))}>
                    <CabinetIcon name="arrowLeft" />
                  </button>
                  <button type="button" className="td-icon-btn" aria-label="Следующий день" onClick={() => setSelectedDay((day) => shiftDate(day, 1))}>
                    <CabinetIcon name="arrow" />
                  </button>
                </div>
              </div>
              <div className="td-week" aria-label="Дни недели">
                {week.map((day) => {
                  const key = dayKeyFromDate(day);
                  const marked = knownEvents.some((event) => dayKeyFromIso(event.startsAt) === key && !event.isPersonal)
                    || (day.getMonth() === today.getMonth()
                      && day.getFullYear() === today.getFullYear()
                      && lessonDays.has(day.getDate()));
                  return (
                    <button
                      key={key}
                      type="button"
                      className={`td-week__day${key === selectedKey ? " is-selected" : ""}`}
                      aria-pressed={key === selectedKey}
                      onClick={() => setSelectedDay(day)}
                    >
                      <span>{weekdayShort(day)}</span>
                      <b>{day.getDate()}</b>
                      {marked ? <i className="td-week__mark" /> : null}
                    </button>
                  );
                })}
              </div>
              {dayEvents.length ? (
                <div className="td-agenda">
                  {dayEvents.map((event) => (
                    <Link
                      key={event.id || `${event.startsAt}-${event.studentName}`}
                      to={eventHref(event)}
                      className={`td-agenda__row${event.isCurrent ? " is-current" : ""}`}
                      onClick={() => { if (event.isCurrent) closeConnectionCheck(); }}
                    >
                      <span className="td-agenda__time">
                        {event.time}
                        <small>{formatEventTime(event.endsAt)}</small>
                      </span>
                      <span style={{ minWidth: 0 }}>
                        <span className="td-agenda__name">
                          {event.isPersonal ? event.subject : (event.topic || event.subject || "Урок")}
                        </span>
                        <span className="td-agenda__detail">
                          {event.isPersonal
                            ? "Личное"
                            : (event.topic && event.subject
                              ? `${event.studentName} · ${event.subject}`
                              : event.studentName)}
                        </span>
                      </span>
                      {event.isCurrent ? <span className="td-agenda__state">Сейчас</span> : <CabinetIcon name="arrow" />}
                    </Link>
                  ))}
                </div>
              ) : (
                <div className="td-empty">
                  <CabinetIcon name="calendar" />
                  <b>{selectedKey === todayKey ? "В планах — свободный день" : "В этот день занятий не видно"}</b>
                  Полный план открывается в расписании.
                </div>
              )}
              <div className="td-agenda__add">
                <button type="button" onClick={openCreateLesson}>
                  <CabinetIcon name="plus" />
                  Запланировать занятие
                </button>
                <button type="button" onClick={() => openHomeworkAssign()} disabled={assignLoading}>
                  <CabinetIcon name="note" />
                  Выдать задание
                </button>
              </div>
            </section>

            <section className="td-panel td-works" aria-labelledby="td-works-title">
              <div className="td-panel__head">
                <div>
                  <h2 id="td-works-title">
                    Сданные работы
                    {reviewsCount > 0 ? <span className="td-count">{reviewsCount}</span> : null}
                  </h2>
                  <p>Ждут вашей обратной связи</p>
                </div>
              </div>
              {shownReviews.length === 0 ? (
                <div className="td-empty">
                  <CabinetIcon name="check" />
                  <b>Всё проверено</b>
                  Новых работ пока нет.
                </div>
              ) : (
                <div className="td-works__list">
                  {shownReviews.map((item) => (
                    <Link key={item.id} to={item.href} className="td-work">
                      <ReviewAvatar name={item.studentName} src={item.avatarUrl} />
                      <span className="td-work__info">
                        <span className="td-work__name">{item.studentName}</span>
                        <span className="td-work__topic">{item.title}</span>
                      </span>
                      <span className="td-work__meta">
                        <span>{formatSubmittedAgo(item.submittedAt)}</span>
                        <CabinetIcon name="arrow" />
                      </span>
                    </Link>
                  ))}
                </div>
              )}
              <div className="td-works__foot">
                <span>
                  {reviewsCount
                    ? `Показаны ${Math.min(3, reviewsCount)} из ${reviewsCount}`
                    : "Новых работ пока нет"}
                </span>
                <Link to="/cabinet/review" className="td-text-link">
                  Все работы
                  <CabinetIcon name="arrow" />
                </Link>
              </div>
            </section>
          </div>

          <div className="td-band">
            <div className="td-col">
              <SuggestedMaterials
                items={suggestedMaterials}
                onOpen={setPreviewItem}
                continueItems={continueItems}
              />
              {!subscriptionLoading ? <DashboardLimits items={usageItems} /> : null}
              {PAYMENTS_ENABLED && debtTotal > 0 ? (
                <Link to="/cabinet/payments" className="td-panel td-alert">
                  <strong>Есть задолженность</strong>
                  <p>{formatMoney(debtTotal, billingDash?.currency)}</p>
                </Link>
              ) : null}
            </div>
            <div className="td-rail">
              <SavingsPanel time={board?.time} />
              <MotivationBar daily={board?.daily} userId={user?.id} />
              <AchievementsPanel board={board} userId={user?.id} />
            </div>
          </div>
        </div>
      </div>

      {studentPickerOpen ? (
        <CabinetModal
          title="Кому выдать задание?"
          onClose={() => setStudentPickerOpen(false)}
          footer={(
            <>
              <button
                type="button"
                className="cb-btn cb-btn--secondary"
                onClick={() => setStudentPickerOpen(false)}
              >
                Отмена
              </button>
              <button
                type="button"
                className="cb-btn cb-btn--primary"
                onClick={confirmStudentPick}
              >
                Далее
              </button>
            </>
          )}
        >
          <label className="cb-field">
            <span>Ученик</span>
            <select
              value={pickerValue}
              onChange={(e) => setPickerValue(e.target.value)}
              autoFocus
            >
              {pickerStudents.map((s) => (
                <option key={s.id} value={s.id}>{s.name}</option>
              ))}
            </select>
          </label>
        </CabinetModal>
      ) : null}

      {homeworkTarget ? (
        <HomeworkAssignModal
          student={homeworkTarget.student || null}
          students={homeworkTarget.students || null}
          group={homeworkTarget.group || null}
          onClose={() => setHomeworkTarget(null)}
          onAssigned={() => setHomeworkTarget(null)}
        />
      ) : null}

      <LessonPreviewModal
        open={previewItem?.kind === "lesson"}
        slug={previewItem?.kind === "lesson" ? previewItem.slug : ""}
        onClose={() => setPreviewItem(null)}
        catalogLessons={suggestedMaterials.filter((item) => item.kind === "lesson")}
      />
      <InterestingPreviewModal
        open={previewItem?.kind === "interesting"}
        slug={previewItem?.kind === "interesting" ? previewItem.slug : ""}
        onClose={() => setPreviewItem(null)}
      />
    </main>
  );
}
