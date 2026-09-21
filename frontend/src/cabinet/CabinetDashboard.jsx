import { useEffect, useMemo, useRef, useState } from "react";
import { Link, useNavigate, useOutletContext } from "react-router-dom";
import { displayName } from "../pages/CabinetAuthPage";
import { mapApiStudent } from "./cabinetMappers";
import { CabinetEmptyState } from "./CabinetSectionUi";
import CabinetIcon from "./CabinetIcons";
import CabinetModal from "./components/CabinetModal";
import CabinetGlobalSearch from "./components/CabinetGlobalSearch";
import CabinetNotificationsBell from "./components/CabinetNotificationsBell";
import HomeworkAssignModal from "./components/HomeworkAssignModal";
import TeacherOnboardingCard from "./components/TeacherOnboardingCard";
import DashboardPulse from "./components/DashboardPulse";
import { UserAvatarMark } from "./components/ProfileAvatarEditor";
import LessonPreviewModal from "../components/LessonPreviewModal";
import InterestingPreviewModal from "../components/InterestingPreviewModal";
import { formatUsageItemFrac } from "./storageFormat";
import "../styles/material-access.css";
import { closeConnectionCheck } from "./connectionCheck/openConnectionCheck";
import { trackActivationIntent } from "./activationAnalytics";
import {
  fetchBillingDashboard,
  fetchDashboard,
  fetchNotifications,
  fetchStudents,
  markNotificationRead,
  normalizeCabinetList,
} from "../utils/cabinetAuth";
import { readLastVariant, readRecentLessons } from "../utils/recentLessons";
import { formatMoney } from "./billing/billingFormat";
import { PAYMENTS_ENABLED } from "./featureFlags";
import { planHasTimewebAi } from "./TimewebAiEmbed";
import "./styles/teacher-dashboard.css";

const WEEKDAYS = ["Пн", "Вт", "Ср", "Чт", "Пт", "Сб", "Вс"];
const MONTHS = [
  "Январь", "Февраль", "Март", "Апрель", "Май", "Июнь",
  "Июль", "Август", "Сентябрь", "Октябрь", "Ноябрь", "Декабрь",
];
const PERSONAL_TYPES = new Set(["personal", "blocked"]);

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

function shortName(name) {
  const parts = String(name || "").trim().split(/\s+/).filter(Boolean);
  if (parts.length < 2) return name || "";
  return `${parts[0]} ${parts[1].charAt(0)}.`;
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

function buildCalendarDays(date, lessonDays = new Set(), personalDays = new Set()) {
  const year = date.getFullYear();
  const month = date.getMonth();
  const today = date.getDate();
  const firstDay = new Date(year, month, 1);
  const daysInMonth = new Date(year, month + 1, 0).getDate();
  const startOffset = (firstDay.getDay() + 6) % 7;
  const prevMonthDays = new Date(year, month, 0).getDate();
  const cells = [];

  for (let i = 0; i < startOffset; i += 1) {
    cells.push({ day: prevMonthDays - startOffset + i + 1, muted: true });
  }
  for (let day = 1; day <= daysInMonth; day += 1) {
    cells.push({
      day,
      isToday: day === today,
      hasLesson: lessonDays.has(day),
      hasPersonal: personalDays.has(day),
    });
  }
  while (cells.length % 7 !== 0) {
    cells.push({ day: cells.length - (startOffset + daysInMonth) + 1, muted: true });
  }
  return cells;
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
  return (
    <span className="td-avatar" aria-hidden="true">
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

function openAssistant() {
  const launcher = document.querySelector("[data-itflux-ai-launcher]");
  if (launcher instanceof HTMLElement) launcher.click();
}

function minutesUntil(isoString) {
  if (!isoString) return null;
  return Math.round((new Date(isoString).getTime() - Date.now()) / 60000);
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

function eventListDate(isoString) {
  if (!isoString) return { weekday: "", day: "", time: "" };
  const d = new Date(isoString);
  const weekday = d.toLocaleDateString("ru-RU", { weekday: "short" }).replace(".", "");
  return {
    weekday: capitalize(weekday),
    day: String(d.getDate()),
    time: formatEventTime(isoString),
  };
}

function DashboardMessagesButton() {
  const navigate = useNavigate();
  const rootRef = useRef(null);
  const [open, setOpen] = useState(false);
  const [items, setItems] = useState([]);
  const [unread, setUnread] = useState(0);

  useEffect(() => {
    let cancelled = false;
    fetchNotifications()
      .then((data) => {
        if (cancelled) return;
        const raw = data?.items || data?.results || [];
        const messages = raw.filter((n) => {
          const type = String(n?.payload?.type || n?.payload?.event_type || "").toLowerCase();
          return type.includes("message");
        });
        setItems(messages.slice(0, 6));
        setUnread(messages.filter((n) => !n.is_read).length);
      })
      .catch(() => {});
    return () => { cancelled = true; };
  }, []);

  useEffect(() => {
    const onDoc = (e) => {
      if (rootRef.current && !rootRef.current.contains(e.target)) setOpen(false);
    };
    document.addEventListener("mousedown", onDoc);
    return () => document.removeEventListener("mousedown", onDoc);
  }, []);

  const openItem = async (n) => {
    if (!n.is_read) {
      try {
        await markNotificationRead(n.id);
        setItems((prev) => prev.map((row) => (row.id === n.id ? { ...row, is_read: true } : row)));
        setUnread((count) => Math.max(0, count - 1));
      } catch {
        /* ignore */
      }
    }
    setOpen(false);
    const url = n?.url || n?.payload?.url || "/cabinet/students";
    navigate(typeof url === "string" && url.startsWith("/") ? url : "/cabinet/students");
  };

  return (
    <div className="td-msg" ref={rootRef}>
      <button
        type="button"
        className="td-topbar__icon"
        aria-label="Сообщения"
        aria-expanded={open}
        onClick={() => setOpen((v) => !v)}
      >
        <CabinetIcon name="message" />
        {unread > 0 ? <span className="td-topbar__badge">{unread > 9 ? "9+" : unread}</span> : null}
      </button>
      {open ? (
        <div className="td-msg__menu" role="menu">
          {items.length === 0 ? (
            <p className="td-msg__empty">Нет новых сообщений</p>
          ) : items.map((n) => (
            <button key={n.id} type="button" className="td-msg__item" onClick={() => openItem(n)}>
              <strong>{n.title || "Сообщение"}</strong>
              <span>{n.message || ""}</span>
            </button>
          ))}
        </div>
      ) : null}
    </div>
  );
}

function DashboardTopbar({ user, firstName }) {
  return (
    <div className="td-topbar">
      <div className="td-topbar__inner">
        <CabinetGlobalSearch
          className="td-topbar__search"
          placeholder="Поиск: ученики, задания, материалы, уроки…"
        />
        <div className="td-topbar__actions">
          <CabinetNotificationsBell />
          <DashboardMessagesButton />
          <Link to="/cabinet/more" className="td-topbar__user" aria-label="Профиль">
            <span className="td-topbar__avatar">
              <UserAvatarMark user={user} fallbackName={displayName(user)} />
            </span>
            <span className="td-topbar__user-copy">
              <strong>{firstName}</strong>
              <span>Преподаватель</span>
            </span>
          </Link>
        </div>
      </div>
    </div>
  );
}

function mediaUrl(url) {
  if (!url) return null;
  const idx = String(url).indexOf("/media/");
  if (idx >= 0) return url.slice(idx);
  return url;
}

function SuggestedMaterials({ items, onOpen }) {
  if (!items?.length) return null;
  return (
    <section className="td-card td-panel td-suggest" aria-label="Вам пригодится">
      <div className="td-card__head">
        <h2>Вам пригодится</h2>
        <Link to="/lessons" className="td-link">Все</Link>
      </div>
      <div className="td-suggest__list">
        {items.slice(0, 4).map((item) => {
          const cover = mediaUrl(item.cover_url);
          return (
            <button
              key={`${item.kind}-${item.id}`}
              type="button"
              className="td-suggest__card"
              onClick={() => onOpen(item)}
            >
              <span
                className={`td-suggest__cover${cover ? " has-image" : ""}`}
                style={{
                  backgroundColor: item.accent_color || "#2563EB",
                  backgroundImage: cover ? `url("${cover}")` : undefined,
                }}
              />
              <span className="td-suggest__body">
                <span className="td-suggest__meta">
                  <span className="td-suggest__kind">{item.kind_label || (item.kind === "interesting" ? "Тренажёр" : "Готовый урок")}</span>
                  {item.available ? <span className="td-suggest__ready">Уже доступно</span> : null}
                </span>
                <strong>{item.title}</strong>
                {item.description ? <span className="td-suggest__desc">{item.description}</span> : null}
                {item.reason ? <em>{item.reason}</em> : null}
              </span>
            </button>
          );
        })}
      </div>
    </section>
  );
}

function DashboardLimits({ items, loading }) {
  if (loading) {
    return (
      <section className="td-card td-panel td-panel--fill">
        <div className="td-card__head">
          <h2>Лимиты тарифа</h2>
        </div>
        <p className="td-empty">Загрузка…</p>
      </section>
    );
  }

  const rows = (items || []).slice(0, 5);
  const exhausted = rows.some((item) => item.exhausted && !item.unlimited);

  return (
    <section className="td-card td-panel td-panel--fill">
      <div className="td-card__head">
        <h2>Лимиты тарифа</h2>
        <Link to="/cabinet/upgrade" className="td-link">Тарифы</Link>
      </div>
      {rows.length === 0 ? (
        <p className="td-empty">Данных по лимитам пока нет.</p>
      ) : (
        <div className="td-limits">
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
      <div className="td-topbar"><div className="td-topbar__inner"><div className="td-skel__block" style={{ height: 42, flex: 1, margin: 0 }} /></div></div>
      <div className="td-shell">
        <div className="td-skel__block" style={{ height: 160 }} />
        <div className="td-skel__block" style={{ height: 88 }} />
        <div className="td-skel__block" style={{ height: 240 }} />
      </div>
    </main>
  );
}

export default function CabinetDashboard() {
  const { user, currentPlan, usageItems, subscriptionLoading } = useOutletContext();
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
  const firstName = displayName(user).split(" ")[0];
  const showAssistant = planHasTimewebAi(currentPlan);

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
  const personalDays = useMemo(
    () => new Set(data?.calendar_personal_days || []),
    [data?.calendar_personal_days],
  );
  const lessonDays = useMemo(
    () => new Set(
      data?.calendar_lesson_days != null
        ? data.calendar_lesson_days
        : (data?.calendar_event_days || [])
    ),
    [data?.calendar_lesson_days, data?.calendar_event_days],
  );
  const calendarDays = useMemo(
    () => buildCalendarDays(today, lessonDays, personalDays),
    [today, lessonDays, personalDays],
  );

  const todayEvents = useMemo(
    () => (data?.today_events || [])
      .map((ev) => mapEvent(ev, today))
      .sort((a, b) => String(a.startsAt).localeCompare(String(b.startsAt))),
    [data?.today_events, today],
  );

  const nextEvent = useMemo(() => {
    const lessons = todayEvents.filter((event) => !event.isPersonal);
    return lessons.find((event) => event.isCurrent)
      || lessons.find((event) => !event.isDone)
      || todayEvents.find((event) => event.isCurrent)
      || todayEvents.find((event) => !event.isDone)
      || null;
  }, [todayEvents]);

  const pendingReviews = useMemo(
    () => (data?.pending_reviews || []).map(mapReview),
    [data?.pending_reviews],
  );

  const upcomingEvents = data?.upcoming_events || [];
  const suggestedMaterials = data?.suggested_materials || [];
  const onboarding = data?.onboarding || null;
  const onboardingVisible = Boolean(onboarding?.visible);
  const lessonsCount = data?.today_lessons_count
    ?? todayEvents.filter((event) => !event.isPersonal).length;
  const reviewsCount = data?.pending_reviews_count ?? pendingReviews.length;
  const debtTotal = Number(billingDash?.debt_total) || 0;

  const todayLessons = todayEvents.filter((event) => !event.isPersonal);
  const remainingLessons = todayLessons.filter((event) => !event.isDone).length;
  const lessonsFinished = todayLessons.length > 0 && remainingLessons === 0;
  const noLessonsToday = todayLessons.length === 0;
  const quietLead = lessonsFinished
    ? "На оставшийся день уроков больше нет"
    : "На оставшийся день уроков нет";
  const greeting = greetingForHour(today.getHours());
  const night = isNightHour(today.getHours());
  const dateLine = capitalize(today.toLocaleDateString("ru-RU", {
    weekday: "long",
    day: "numeric",
    month: "long",
  }));
  const todaySummary = [
    lessonsCount === 0
      ? "Сегодня без занятий"
      : `Сегодня ${lessonsCount} ${pluralRu(lessonsCount, "занятие", "занятия", "занятий")}`,
    reviewsCount > 0
      ? `${reviewsCount} ${pluralRu(reviewsCount, "работа", "работы", "работ")} ${reviewsCount === 1 ? "ждёт" : "ждут"} проверки`
      : null,
  ].filter(Boolean).join(" · ");

  const upcomingBoard = useMemo(() => {
    const laterToday = todayEvents.filter((event) => (
      !event.isDone && (!nextEvent || event.id !== nextEvent.id)
    ));
    const later = upcomingEvents.map((ev) => mapEvent(ev, today));
    return [...laterToday, ...later].slice(0, 5);
  }, [todayEvents, upcomingEvents, nextEvent, today]);

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
    return items.slice(0, 3);
  }, []);

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

  return (
    <main className={`td-page${night ? " is-night" : ""}`}>
      <DashboardTopbar user={user} firstName={firstName} />

      <div className="td-shell">
        <div className="td-layout">
          <div className="td-center">
            <section className="td-head">
              <p className="td-head__date">{dateLine}</p>
              <h1>
                {greeting.text}, {firstName}{" "}
                <span className="td-head__mood" aria-hidden="true">{greeting.emoji}</span>
              </h1>
              <p className="td-head__lead">{todaySummary}</p>
            </section>

            {night ? (
              <section className="td-night-note" role="status">
                <p>Рекомендуем отдохнуть! Встретимся завтра!</p>
              </section>
            ) : null}

            {onboardingVisible ? <TeacherOnboardingCard onboarding={onboarding} /> : null}

            {nextEvent ? (
              <section className={`td-card td-hero${nextEvent.isPersonal ? " is-personal" : ""}${nextEvent.isCurrent && !nextEvent.isPersonal ? " is-live" : ""}`}>
                <div className="td-hero__copy">
                  <h2>{nextEvent.timeRange}</h2>
                  <p className="td-hero__meta">
                    {nextEvent.isPersonal ? (
                      <span className="td-badge td-badge--violet">Личное</span>
                    ) : nextEvent.isCurrent ? (
                      <span className="td-badge td-badge--live">
                        <span className="td-live-dot" aria-hidden="true" />
                        Идёт сейчас
                      </span>
                    ) : (
                      <span className="td-badge">Урок</span>
                    )}
                    <span title={nextEvent.studentName}>
                      {nextEvent.isPersonal ? nextEvent.subject : nextEvent.studentName}
                    </span>
                    {nextEvent.subject && !nextEvent.isPersonal ? <span>{nextEvent.subject}</span> : null}
                  </p>
                  {nextEvent.hasTravel ? (
                    <p className="td-hero__note">
                      <CabinetIcon name="car" />
                      учтено время в пути
                    </p>
                  ) : nextEvent.topic ? (
                    <p className="td-hero__note" title={nextEvent.topic}>{nextEvent.topic}</p>
                  ) : null}
                </div>
                <div className="td-hero__aside">
                  <p className="td-hero__when">
                    {nextEvent.isCurrent ? "Сейчас" : formatCountdown(nextEvent.startsAt, false)}
                  </p>
                  {nextEvent.isPersonal ? (
                    <div className="td-hero__actions">
                      <Link to={eventHref(nextEvent)} className="td-btn td-btn--secondary">В расписании</Link>
                    </div>
                  ) : (
                    <div className="td-hero__actions">
                      {nextEvent.isCurrent ? (
                        <Link
                          to={eventHref(nextEvent)}
                          className="td-btn td-btn--primary"
                          onClick={() => closeConnectionCheck()}
                        >
                          Войти
                        </Link>
                      ) : (
                        <Link to={eventHref(nextEvent)} className="td-btn td-btn--primary">Открыть</Link>
                      )}
                      <Link to={materialsHref(nextEvent)} className="td-btn td-btn--secondary">
                        Материалы
                      </Link>
                    </div>
                  )}
                </div>
              </section>
            ) : lessonsFinished ? (
              <section className="td-card td-hero is-quiet">
                <div className="td-quiet td-quiet--hero">
                  <p className="td-quiet__lead">{quietLead}</p>
                </div>
              </section>
            ) : null}

            <DashboardPulse engagement={data?.engagement} userId={user?.id} />

            <div className="td-split">
              <section className="td-card td-panel td-panel--fill">
                <div className="td-card__head">
                  <h2>
                    Нужно проверить
                    {reviewsCount > 0 ? <span className="td-count td-count--violet">{reviewsCount}</span> : null}
                  </h2>
                  <Link to="/cabinet/review" className="td-link">Все</Link>
                </div>
                {pendingReviews.length === 0 ? (
                  <p className="td-empty">Очередь проверки пуста.</p>
                ) : (
                  <div className="td-rows">
                    {pendingReviews.slice(0, 4).map((item) => {
                      const meta = [item.studentName, formatSubmittedAgo(item.submittedAt), item.subject]
                        .filter(Boolean)
                        .join(" · ");
                      return (
                        <Link key={item.id} to={item.href} className="td-row td-row--review">
                          <ReviewAvatar name={item.studentName} src={item.avatarUrl} />
                          <span className="td-row__main">
                            <strong title={item.title}>{item.title}</strong>
                            <span title={meta}>{meta}</span>
                          </span>
                        </Link>
                      );
                    })}
                  </div>
                )}
              </section>

              <section className="td-card td-panel td-panel--fill">
                <div className="td-card__head">
                  <h2>
                    Уроки сегодня
                    {todayLessons.length > 0 ? (
                      <span className="td-count td-count--violet">{todayLessons.length}</span>
                    ) : null}
                  </h2>
                  <Link to="/cabinet/schedule" className="td-link">Расписание</Link>
                </div>
                {noLessonsToday ? (
                  <div className="td-quiet td-quiet--panel">
                    <p className="td-quiet__lead">{quietLead}</p>
                  </div>
                ) : (
                  <>
                    <div className="td-timeline">
                      {todayLessons.slice(0, 5).map((event) => {
                        const nowish = event.isCurrent;
                        const isNext = Boolean(nextEvent && event.id === nextEvent.id && !nowish);
                        return (
                          <Link
                            key={event.id || `${event.time}-${event.studentName}`}
                            to={eventHref(event)}
                            className={`td-timeline__item${nowish ? " is-now" : ""}`}
                            onClick={() => { if (nowish) closeConnectionCheck(); }}
                          >
                            <span className="td-timeline__time">
                              <strong>{event.time}</strong>
                              <span>{formatEventTime(event.endsAt)}</span>
                            </span>
                            <span className="td-timeline__body">
                              <strong title={event.studentName}>{shortName(event.studentName)}</strong>
                              <span>{event.subject || event.topic}</span>
                            </span>
                            {nowish ? <span className="td-timeline__now">Сейчас</span> : null}
                            {isNext ? <span className="td-timeline__next">Далее</span> : null}
                          </Link>
                        );
                      })}
                    </div>
                    {lessonsFinished && nextEvent ? (
                      <p className="td-quiet__note td-quiet__note--foot">{quietLead}</p>
                    ) : null}
                  </>
                )}
              </section>
            </div>

            <nav className="td-card td-actions" aria-label="Действия">
              <Link to="/cabinet/schedule?create=1" className="td-actions__item" onClick={() => trackActivationIntent("lesson_creation_started", { source: "dashboard_quick" })}>
                <span className="td-actions__icon td-actions__icon--blue"><CabinetIcon name="plus" /></span>
                Урок
              </Link>
              <button type="button" className="td-actions__item" onClick={() => openHomeworkAssign()} disabled={assignLoading}>
                <span className="td-actions__icon td-actions__icon--orange"><CabinetIcon name="note" /></span>
                Задание
              </button>
              <Link to="/cabinet/library" className="td-actions__item">
                <span className="td-actions__icon td-actions__icon--teal"><CabinetIcon name="folder" /></span>
                Материал
              </Link>
              <Link to="/cabinet/students?invite=1" className="td-actions__item" onClick={() => trackActivationIntent("add_student_clicked", { source: "dashboard_quick" })}>
                <span className="td-actions__icon td-actions__icon--green"><CabinetIcon name="students" /></span>
                Ученик
              </Link>
              <Link to="/cabinet/journal" className="td-actions__item">
                <span className="td-actions__icon td-actions__icon--slate"><CabinetIcon name="book" /></span>
                Журнал
              </Link>
              <Link to="/subject" className="td-actions__item">
                <span className="td-actions__icon td-actions__icon--violet"><CabinetIcon name="quiz" /></span>
                Вариант
              </Link>
            </nav>

            <div className="td-board">
              <section className="td-card td-panel td-panel--fill">
                <div className="td-card__head">
                  <h2>Ближайшие</h2>
                  <Link to="/cabinet/schedule" className="td-link">Расписание</Link>
                </div>
                {upcomingBoard.length === 0 ? (
                  <p className="td-empty">Ближайших событий нет.</p>
                ) : (
                  <div className="td-rows">
                    {upcomingBoard.slice(0, 4).map((event) => {
                      const when = eventListDate(event.startsAt);
                      return (
                        <Link
                          key={event.id || event.startsAt}
                          to={eventHref(event)}
                          className={`td-row${event.isPersonal ? " is-personal" : ""}`}
                        >
                          <span className="td-row__date">
                            <em>{when.weekday}</em>
                            <strong>{when.day}</strong>
                          </span>
                          <span className="td-row__main">
                            <strong title={event.isPersonal ? event.subject : event.studentName}>
                              {event.isPersonal ? event.subject : event.studentName}
                            </strong>
                            <span>
                              {when.time}
                              {event.isPersonal ? " · личное" : (event.subject ? ` · ${event.subject}` : "")}
                            </span>
                          </span>
                          {event.isPersonal ? <span className="td-tag td-tag--slate">Личное</span> : null}
                        </Link>
                      );
                    })}
                  </div>
                )}
              </section>

              <DashboardLimits items={usageItems} loading={subscriptionLoading} />
            </div>
          </div>

          <aside className="td-rail">
            <SuggestedMaterials items={suggestedMaterials} onOpen={setPreviewItem} />
            <section className="td-card td-panel">
              <div className="td-card__head">
                <h2>Календарь</h2>
                <span className="td-card__meta">{MONTHS[today.getMonth()]} {today.getFullYear()}</span>
              </div>
              <div className="td-cal-week">
                {WEEKDAYS.map((day) => <span key={day}>{day}</span>)}
              </div>
              <div className="td-cal-days">
                {calendarDays.map((cell, index) => (
                  <button
                    key={`${cell.day}-${index}`}
                    type="button"
                    className={[
                      "td-cal-day",
                      cell.muted ? "is-muted" : "",
                      cell.isToday ? "is-today" : "",
                    ].filter(Boolean).join(" ")}
                    disabled={cell.muted}
                    aria-label={
                      cell.muted
                        ? undefined
                        : `${cell.day} ${MONTHS[today.getMonth()]}${cell.hasLesson ? ", есть уроки" : ""}${cell.hasPersonal ? ", личное" : ""}`
                    }
                    aria-current={cell.isToday ? "date" : undefined}
                    onClick={() => { if (!cell.muted) navigate("/cabinet/schedule"); }}
                  >
                    <span className="td-cal-num">{cell.day}</span>
                    <span className="td-cal-dots">
                      {cell.hasLesson ? <span className="td-cal-dot" /> : null}
                      {cell.hasPersonal ? <span className="td-cal-dot is-personal" /> : null}
                    </span>
                  </button>
                ))}
              </div>
            </section>

            {showAssistant || continueItems.length > 0 || (PAYMENTS_ENABLED && debtTotal > 0) ? (
              <section className="td-card td-panel td-aside-actions">
                {showAssistant ? (
                  <button type="button" className="td-aside-actions__item" onClick={openAssistant}>
                    <span className="td-actions__icon td-actions__icon--violet"><CabinetIcon name="spark" /></span>
                    <span>
                      <strong>Помощник</strong>
                      <em>План, задания, материалы</em>
                    </span>
                  </button>
                ) : null}
                {continueItems[0] ? (
                  <Link to={continueItems[0].href} className="td-aside-actions__item">
                    <span className="td-actions__icon td-actions__icon--teal"><CabinetIcon name="folder" /></span>
                    <span>
                      <strong>{continueItems[0].label}</strong>
                      <em>{continueItems[0].title}</em>
                    </span>
                  </Link>
                ) : null}
                {PAYMENTS_ENABLED && debtTotal > 0 ? (
                  <Link to="/cabinet/payments" className="td-aside-actions__item is-alert">
                    <span className="td-actions__icon td-actions__icon--red"><CabinetIcon name="wallet" /></span>
                    <span>
                      <strong>Есть задолженность</strong>
                      <em>{formatMoney(debtTotal, billingDash?.currency)}</em>
                    </span>
                  </Link>
                ) : null}
              </section>
            ) : null}
          </aside>
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
