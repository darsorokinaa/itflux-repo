import { useEffect, useMemo, useState } from "react";
import { Link, useOutletContext } from "react-router-dom";
import { displayName } from "../pages/CabinetAuthPage";
import CabinetIcon from "./CabinetIcons";
import { CabinetEmptyState } from "./CabinetSectionUi";
import { fetchDashboard } from "../utils/cabinetAuth";

const WEEKDAYS = ["Пн", "Вт", "Ср", "Чт", "Пт", "Сб", "Вс"];
const MONTHS = [
  "Январь", "Февраль", "Март", "Апрель", "Май", "Июнь",
  "Июль", "Август", "Сентябрь", "Октябрь", "Ноябрь", "Декабрь",
];

const METRIC_DEFS = [
  { key: "active_students_count", label: "Ученики", color: "#2563EB", icon: "students", tone: "brand" },
  { key: "pending_reviews_count", label: "На проверке", color: "#F59E0B", icon: "check", tone: "warn" },
  { key: "drafts_count", label: "Черновики", color: "#64748B", icon: "pencil", tone: "draft" },
  { key: "today_lessons_count", label: "Уроки", color: "#7C3AED", icon: "lessons", tone: "lav" },
];

const STATUS_COLORS = {
  success: "#10B981",
  info: "#2563EB",
  warn: "#F59E0B",
  sky: "#3B82F6",
  danger: "#EF4444",
};


function formatTimeUntil(timeStr, now) {
  const [hours, minutes] = timeStr.split(":").map(Number);
  const lessonAt = new Date(now);
  lessonAt.setHours(hours, minutes, 0, 0);

  const diffMs = lessonAt.getTime() - now.getTime();
  if (diffMs <= 0) return "сейчас";

  const totalMins = Math.round(diffMs / 60000);
  if (totalMins < 60) return `через ${totalMins} мин`;

  const h = Math.floor(totalMins / 60);
  const m = totalMins % 60;
  if (m === 0) return `через ${h} ч`;
  return `через ${h} ч ${m} мин`;
}

function buildCalendarDays(date, eventDays = new Set()) {
  const year = date.getFullYear();
  const month = date.getMonth();
  const today = date.getDate();
  const firstDay = new Date(year, month, 1);
  const daysInMonth = new Date(year, month + 1, 0).getDate();
  const startOffset = (firstDay.getDay() + 6) % 7;
  const cells = [];

  for (let i = 0; i < startOffset; i += 1) cells.push(null);
  for (let day = 1; day <= daysInMonth; day += 1) {
    cells.push({
      day,
      isToday: day === today,
      hasEvent: eventDays.has(day),
    });
  }
  return cells;
}

function MetricRing({ pct, color }) {
  const size = 40;
  const stroke = 4;
  const r = (size - stroke) / 2;
  const c = 2 * Math.PI * r;
  const offset = c - (pct / 100) * c;

  return (
    <div className="cb-metric-ring" style={{ width: size, height: size }}>
      <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} aria-hidden="true">
        <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke="#EEF2F7" strokeWidth={stroke} />
        <circle
          cx={size / 2}
          cy={size / 2}
          r={r}
          fill="none"
          stroke={color}
          strokeWidth={stroke}
          strokeDasharray={c}
          strokeDashoffset={offset}
          strokeLinecap="round"
          transform={`rotate(-90 ${size / 2} ${size / 2})`}
        />
      </svg>
      <span className="cb-metric-ring__pct" style={{ color }}>{pct}%</span>
    </div>
  );
}

function formatEventTime(isoString) {
  if (!isoString) return "";
  const d = new Date(isoString);
  return d.toLocaleTimeString("ru-RU", { hour: "2-digit", minute: "2-digit" });
}

function initialsFromName(name) {
  const parts = (name || "").trim().split(/\s+/);
  if (parts.length >= 2) return `${parts[0][0]}${parts[1][0]}`.toUpperCase();
  return (name || "?").slice(0, 2).toUpperCase();
}

function formatSubmittedWhen(isoString) {
  if (!isoString) return "";
  const d = new Date(isoString);
  const now = new Date();
  const time = d.toLocaleTimeString("ru-RU", { hour: "2-digit", minute: "2-digit" });
  if (d.toDateString() === now.toDateString()) return `сегодня в ${time}`;
  return `${d.toLocaleDateString("ru-RU", { day: "numeric", month: "short" })} · ${time}`;
}

function mapPendingReview(item) {
  const studentName = item.student_name || "Ученик";
  return {
    id: item.id,
    title: item.title,
    studentName,
    typeLabel: item.source_type_label || item.source_type || "Работа",
    submittedAt: item.created_at,
    initials: initialsFromName(studentName),
    href: "/cabinet/review",
  };
}

function PendingReviewRow({ item }) {
  return (
    <Link to={item.href} className="cb-pending-review">
      <span className="cb-pending-review__avatar">{item.initials}</span>
      <div className="cb-pending-review__body">
        <div className="cb-pending-review__head">
          <strong className="cb-pending-review__title">{item.title}</strong>
          <span className="cb-pending-review__badge">На проверке</span>
        </div>
        <p className="cb-pending-review__meta">
          {item.studentName}
          {item.submittedAt ? ` · ${formatSubmittedWhen(item.submittedAt)}` : ""}
        </p>
      </div>
      <span className="cb-pending-review__action cb-btn cb-btn--outline cb-btn--sm">
        Проверить
      </span>
    </Link>
  );
}

function PendingReviewSidebarRow({ item }) {
  return (
    <div className="cb-recent-item">
      <span className="cb-recent-item__avatar">{item.initials}</span>
      <div className="cb-recent-item__body">
        <span className="cb-recent-item__name">{item.studentName}</span>
        <span className="cb-recent-item__role">{item.title}</span>
      </div>
      <div className="cb-recent-item__actions">
        <Link to={item.href} className="cb-recent-action" aria-label="Проверить">
          <CabinetIcon name="check" />
        </Link>
        <Link to={item.href} className="cb-recent-action" aria-label="Открыть">
          <CabinetIcon name="arrow" />
        </Link>
      </div>
    </div>
  );
}

function HeroIllustration({ badges }) {
  return (
    <div className="cb-hero__visual" aria-hidden="true">
      {badges.map((badge) => (
        <span
          key={badge.label}
          className="cb-hero__badge"
          style={{ top: badge.top, left: badge.left, right: badge.right }}
        >
          <CabinetIcon name={badge.icon} />
          {badge.label}
        </span>
      ))}
      <div className="cb-hero__illus">
        <svg viewBox="0 0 200 160" fill="none" xmlns="http://www.w3.org/2000/svg">
          <ellipse cx="100" cy="148" rx="56" ry="8" fill="rgba(0,0,0,0.12)" />
          <path d="M118 42c0-14-10-24-24-24s-24 10-24 24 10 24 24 24 24-10 24-24z" fill="#FCD9BD" />
          <path d="M94 30c2-8 12-12 20-8 6 3 8 10 6 16-4-2-10-2-14 0-4-2-8-4-12-8z" fill="#1E293B" />
          <path d="M70 52c-2 4-2 10 0 16 6 2 14 2 20 0 2-6 2-12 0-16-6-2-14-2-20 0z" fill="#FCD9BD" />
          <rect x="58" y="72" width="84" height="68" rx="12" fill="#FFFFFF" opacity="0.95" />
          <rect x="66" y="80" width="68" height="44" rx="6" fill="#DBEAFE" />
          <rect x="72" y="88" width="24" height="4" rx="2" fill="#93C5FD" />
          <rect x="72" y="96" width="40" height="3" rx="1.5" fill="#BFDBFE" />
          <rect x="72" y="103" width="32" height="3" rx="1.5" fill="#BFDBFE" />
          <path d="M82 128h36v6H82z" fill="#E2E8F0" />
          <path d="M58 88c-8 4-14 14-16 26 4 2 10 4 16 4v-30z" fill="#4F46E5" />
          <path d="M142 88c8 4 14 14 16 26-4 2-10 4-16 4V88z" fill="#4F46E5" />
        </svg>
      </div>
    </div>
  );
}

export default function CabinetDashboard() {
  const { user, openGuide } = useOutletContext();
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const firstName = displayName(user).split(" ")[0];

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const payload = await fetchDashboard();
        if (!cancelled) setData(payload);
      } catch (err) {
        if (!cancelled) setError(err.message || "Не удалось загрузить данные");
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, []);

  const today = useMemo(() => new Date(), []);
  const eventDays = useMemo(
    () => new Set(data?.calendar_event_days || []),
    [data?.calendar_event_days],
  );
  const calendarDays = useMemo(() => buildCalendarDays(today, eventDays), [today, eventDays]);

  const metrics = useMemo(() => {
    if (!data) return [];
    return METRIC_DEFS.map((def) => ({
      ...def,
      value: data[def.key] ?? 0,
      pct: Math.min(100, Math.max(0, (data[def.key] ?? 0) * 10)),
    }));
  }, [data]);

  const progressItems = data?.progress_overview || [];
  const todayLessons = (data?.today_events || []).map((ev) => ({
    time: formatEventTime(ev.starts_at),
    title: ev.title,
    topic: ev.topic || "",
    startsAt: ev.starts_at,
  }));
  const pendingReviews = (data?.pending_reviews || []).map(mapPendingReview);

  const heroBadges = useMemo(() => {
    if (!data) return [];
    return [
      { icon: "calendar", label: `${data.today_lessons_count} урока`, top: "14%", left: "4%" },
      { icon: "check", label: `${data.pending_reviews_count} работ`, top: "58%", left: "2%" },
      { icon: "book", label: `${data.drafts_count} черновика`, top: "22%", right: "8%" },
    ];
  }, [data]);

  const lessonCountdowns = useMemo(
    () => todayLessons.map((lesson) => formatTimeUntil(lesson.time, today)),
    [todayLessons, today],
  );

  if (loading) {
    return <p className="cb-loading">Загрузка главной…</p>;
  }

  if (error && !data) {
    return (
      <CabinetEmptyState
        icon="alert"
        title="Не удалось загрузить данные"
        text={error}
      />
    );
  }

  const subtitle = data
    ? `${data.today_lessons_count} урока · ${data.pending_reviews_count} на проверке`
    : "";

  return (
    <div className="cb-dashboard-grid">
      <div className="cb-main-col">
        <section className="cb-hero cb-block-hero">
          <div className="cb-hero__content">
            <h2 className="cb-hero__title">Привет, {firstName}!</h2>
            <p className="cb-hero__role">Учитель · Цифровой поток</p>
            {subtitle ? <p className="cb-hero__subtitle">{subtitle}</p> : null}
            <div className="cb-hero__actions">
              <Link to="/cabinet/schedule" className="cb-hero__btn cb-hero__btn--primary">
                Урок
              </Link>
              <Link to="/cabinet/review" className="cb-hero__btn cb-hero__btn--ghost">
                Проверка
              </Link>
            </div>
          </div>
          <HeroIllustration badges={heroBadges} />
        </section>

        <section className="cb-dash-section cb-block-metrics">
          <h3 className="cb-dash-section__title">Сводка дня</h3>
          <div className="cb-metrics cb-metrics--grid">
            {metrics.map((m) => (
              <div key={m.label} className={`cb-metric cb-metric--widget cb-metric--${m.tone}`}>
                <div className={`cb-metric__icon cb-metric__icon--${m.tone}`}>
                  <CabinetIcon name={m.icon} />
                </div>
                <div className="cb-metric__text">
                  <span className="cb-metric__value">{m.value}</span>
                  <span className="cb-metric__label">{m.label}</span>
                </div>
                <MetricRing pct={m.pct} color={m.color} />
              </div>
            ))}
          </div>
        </section>

        <section className="cb-widget cb-block-pending-reviews">
          <div className="cb-widget__head">
            <h3 className="cb-widget__title">Сданные работы</h3>
            <Link to="/cabinet/review" className="cb-widget__link">
              {pendingReviews.length > 0
                ? `Все (${data?.pending_reviews_count ?? pendingReviews.length})`
                : "Проверка"}
            </Link>
          </div>
          <div className="cb-pending-reviews">
            {pendingReviews.length === 0 ? (
              <p className="cb-widget__empty">Нет работ на проверку</p>
            ) : (
              pendingReviews.map((item) => (
                <PendingReviewRow key={item.id} item={item} />
              ))
            )}
          </div>
        </section>

        <section className="cb-widget cb-widget--progress cb-block-progress">
          <div className="cb-widget__head">
            <h3 className="cb-widget__title">Прогресс обучения</h3>
            <Link to="/cabinet/students" className="cb-widget__link">Смотреть всех</Link>
          </div>
          <div className="cb-progress-cards">
            {progressItems.length === 0 ? (
              <p className="cb-widget__empty">Нет данных</p>
            ) : (
              progressItems.map((item) => (
              <Link key={item.id || item.name} to={item.href || "/cabinet/students"} className="cb-progress-card">
                <div className="cb-progress-card__head">
                  <div className="cb-progress-card__title-row">
                    <span className="cb-status-dot cb-status-dot--info" />
                    <span className="cb-progress-card__name">{item.name}</span>
                  </div>
                  <span className="cb-progress-card__pct">{item.progress || 0}%</span>
                </div>
                <p className="cb-progress-card__role">{item.role}</p>
                <div className="cb-progress-card__bar">
                  <div
                    className="cb-progress-card__fill"
                    style={{
                      width: `${item.progress || 0}%`,
                      background: STATUS_COLORS.info,
                    }}
                  />
                </div>
              </Link>
              ))
            )}
          </div>
        </section>

        <div className="cb-guide-compact cb-block-guide">
          <span className="cb-guide-compact__label">Как начать:</span>
          <span className="cb-guide-compact__steps">
            ученики → урок → задание → проверка
          </span>
          <button
            type="button"
            className="cb-btn cb-btn--outline cb-btn--sm cb-guide-compact__open"
            onClick={openGuide}
          >
            Инструкция
          </button>
        </div>
      </div>

      <aside className="cb-sidebar-col">
        <div className="cb-widget cb-widget--sidebar cb-block-calendar">
          <div className="cb-widget__head">
            <h3 className="cb-widget__title">{MONTHS[today.getMonth()]} {today.getFullYear()}</h3>
          </div>
          <div className="cb-cal-body">
            <div className="cb-cal-grid">
              {WEEKDAYS.map((d) => (
                <span key={d} className="cb-cal-weekday">{d}</span>
              ))}
              {calendarDays.map((cell, i) => (
                cell ? (
                  <span
                    key={i}
                    className={[
                      "cb-cal-day",
                      cell.isToday ? "cb-cal-day--today" : "",
                      i % 7 >= 5 ? "cb-cal-day--weekend" : "",
                      cell.hasEvent ? "cb-cal-day--event" : "",
                    ].filter(Boolean).join(" ")}
                  >
                    {cell.day}
                    {cell.hasEvent ? <i className="cb-cal-day__dot" /> : null}
                  </span>
                ) : (
                  <span key={i} className="cb-cal-day cb-cal-day--empty" />
                )
              ))}
            </div>
          </div>
        </div>

        <div className="cb-widget cb-widget--sidebar cb-block-lessons">
          <div className="cb-widget__head">
            <h3 className="cb-widget__title">Уроки сегодня</h3>
          </div>
          <div className="cb-lessons-mini cb-lessons-mini--timeline">
            {todayLessons.length === 0 ? (
              <p className="cb-widget__empty">Уроков пока нет</p>
            ) : (
              todayLessons.map((lesson, index) => (
              <Link
                key={`${lesson.time}-${lesson.title}`}
                to="/cabinet/schedule"
                className={`cb-lessons-mini__row${index === todayLessons.length - 1 ? " cb-lessons-mini__row--last" : ""}`}
              >
                <span className="cb-lessons-mini__rail">
                  <span className="cb-lessons-mini__time">{lesson.time}</span>
                  <span className="cb-lessons-mini__dot" />
                </span>
                <div className="cb-lessons-mini__body">
                  <div className="cb-lessons-mini__head">
                    <strong>{lesson.title}</strong>
                    <span className="cb-lessons-mini__badge">{lessonCountdowns[index]}</span>
                  </div>
                  <span className="cb-lessons-mini__topic">{lesson.topic}</span>
                </div>
              </Link>
              ))
            )}
          </div>
          <Link to="/cabinet/schedule" className="cb-lessons-mini__add">
            <CabinetIcon name="plus" /> Добавить урок
          </Link>
        </div>

        <div className="cb-widget cb-widget--sidebar cb-block-recent">
          <div className="cb-widget__head">
            <h3 className="cb-widget__title">На проверке</h3>
            {pendingReviews.length > 0 ? (
              <Link to="/cabinet/review" className="cb-widget__link">Все</Link>
            ) : null}
          </div>
          <div className="cb-recent-list">
            {pendingReviews.length === 0 ? (
              <p className="cb-widget__empty">Нет работ на проверку</p>
            ) : (
              pendingReviews.slice(0, 5).map((item) => (
                <PendingReviewSidebarRow key={item.id} item={item} />
              ))
            )}
          </div>
        </div>
      </aside>
    </div>
  );
}
