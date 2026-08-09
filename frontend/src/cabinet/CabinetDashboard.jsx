import { useEffect, useMemo, useState } from "react";
import { Link, useNavigate, useOutletContext } from "react-router-dom";
import { displayName } from "../pages/CabinetAuthPage";
import { mapApiStudent } from "./cabinetMappers";
import { CabinetEmptyState } from "./CabinetSectionUi";
import CabinetModal from "./components/CabinetModal";
import HomeworkAssignModal from "./components/HomeworkAssignModal";
import {
  fetchBillingDashboard,
  fetchDashboard,
  fetchJournalOverview,
  fetchStudents,
  normalizeCabinetList,
} from "../utils/cabinetAuth";
import { formatMoney } from "./billing/billingFormat";
import { PAYMENTS_ENABLED } from "./featureFlags";
import "./styles/teacher-dashboard.css";
import "./styles/payments.css";

const WEEKDAYS = ["Пн", "Вт", "Ср", "Чт", "Пт", "Сб", "Вс"];
const MONTHS = [
  "Январь", "Февраль", "Март", "Апрель", "Май", "Июнь",
  "Июль", "Август", "Сентябрь", "Октябрь", "Ноябрь", "Декабрь",
];

function greetingForHour(hour) {
  if (hour < 5) return "Доброй ночи";
  if (hour < 12) return "Доброе утро";
  if (hour < 18) return "Добрый день";
  return "Добрый вечер";
}

function formatEventTime(isoString) {
  if (!isoString) return "";
  return new Date(isoString).toLocaleTimeString("ru-RU", {
    hour: "2-digit",
    minute: "2-digit",
  });
}

function formatSubmittedWhen(isoString) {
  if (!isoString) return "";
  const d = new Date(isoString);
  const now = new Date();
  const time = d.toLocaleTimeString("ru-RU", { hour: "2-digit", minute: "2-digit" });
  if (d.toDateString() === now.toDateString()) return `сегодня в ${time}`;
  return `${d.toLocaleDateString("ru-RU", { day: "numeric", month: "short" })} · ${time}`;
}

function formatTimeUntil(timeStr, now) {
  if (!timeStr) return "";
  const [hours, minutes] = timeStr.split(":").map(Number);
  const lessonAt = new Date(now);
  lessonAt.setHours(hours, minutes, 0, 0);
  const diffMs = lessonAt.getTime() - now.getTime();
  if (diffMs <= 0) return "сейчас";
  const totalMins = Math.round(diffMs / 60000);
  if (totalMins < 60) return `через ${totalMins} мин`;
  const h = Math.floor(totalMins / 60);
  const m = totalMins % 60;
  return m === 0 ? `через ${h} ч` : `через ${h} ч ${m} мин`;
}

function pluralRu(n, one, few, many) {
  const abs = Math.abs(n) % 100;
  const n1 = abs % 10;
  if (abs > 10 && abs < 20) return many;
  if (n1 === 1) return one;
  if (n1 >= 2 && n1 <= 4) return few;
  return many;
}

function buildCalendarDays(date, eventDays = new Set()) {
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
      hasEvent: eventDays.has(day),
    });
  }
  while (cells.length % 7 !== 0) {
    cells.push({ day: cells.length - (startOffset + daysInMonth) + 1, muted: true });
  }
  return cells;
}

function mapPendingReview(item) {
  return {
    id: item.id,
    title: item.title || "Работа",
    studentName: item.student_name || "Ученик",
    typeLabel: item.source_type_label || item.source_type || "Работа",
    submittedAt: item.created_at,
    href: item.id ? `/cabinet/review/${item.id}` : "/cabinet/review",
  };
}

function mapTodayLesson(ev, now) {
  const time = formatEventTime(ev.starts_at);
  const startsAt = ev.starts_at ? new Date(ev.starts_at) : null;
  const endsAt = ev.ends_at ? new Date(ev.ends_at) : null;
  const isCurrent = Boolean(
    startsAt && endsAt && startsAt <= now && endsAt >= now,
  );
  const isSoon = Boolean(
    startsAt && !isCurrent && startsAt > now && (startsAt - now) / 60000 <= 60,
  );
  const isDone = ev.status === "done" || ev.status === "completed"
    || Boolean(endsAt && endsAt < now);
  const ready = isDone || Boolean(
    ev.topic || ev.link || ev.telemost_url || ev.meeting_url
      || ev.plan_item_id || ev.lesson_plan_item,
  );
  return {
    id: ev.id,
    time,
    title: ev.title || "Урок",
    topic: ev.topic || "",
    audience: ev.student_name || ev.group_title || ev.audience || "",
    startsAt: ev.starts_at,
    ready,
    isDone,
    isCurrent: isCurrent || isSoon,
    countdown: isDone && !isCurrent
      ? "пройден"
      : formatTimeUntil(time, now),
  };
}

export default function CabinetDashboard() {
  const { user, currentPlan, subscription, subscriptionLoading } = useOutletContext();
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
  const [journalDash, setJournalDash] = useState(null);
  const firstName = displayName(user).split(" ")[0];
  const planName = currentPlan?.name || "";
  const subBanner = subscription?.banner || null;

  const openHomeworkAssign = async () => {
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
    fetchJournalOverview()
      .then((payload) => {
        if (!cancelled) setJournalDash(payload);
      })
      .catch(() => {});
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
  const eventDays = useMemo(
    () => new Set(data?.calendar_event_days || []),
    [data?.calendar_event_days],
  );
  const calendarDays = useMemo(() => buildCalendarDays(today, eventDays), [today, eventDays]);

  const todayLessons = useMemo(
    () => (data?.today_events || [])
      .map((ev) => mapTodayLesson(ev, today))
      .sort((a, b) => String(a.startsAt).localeCompare(String(b.startsAt))),
    [data?.today_events, today],
  );

  const pendingReviews = useMemo(
    () => (data?.pending_reviews || []).map(mapPendingReview),
    [data?.pending_reviews],
  );

  const progressItems = data?.progress_overview || [];
  const upcomingActions = data?.upcoming_actions || [];
  const draftsCount = data?.drafts_count ?? 0;
  const lessonsCount = data?.today_lessons_count ?? todayLessons.length;
  const reviewsCount = data?.pending_reviews_count ?? pendingReviews.length;
  const homeworkToday = upcomingActions.length;
  const firstLessonNote = todayLessons[0]
    ? `первый в ${todayLessons[0].time}`
    : "занятий нет";

  const dateLine = today.toLocaleDateString("ru-RU", {
    weekday: "long",
    day: "numeric",
    month: "long",
  });
  const subtitle = `${dateLine.charAt(0).toUpperCase()}${dateLine.slice(1)} · сегодня ${lessonsCount} ${pluralRu(lessonsCount, "урок", "урока", "уроков")} и ${reviewsCount} ${pluralRu(reviewsCount, "работа", "работы", "работ")} на проверке`;

  const attentionItems = useMemo(() => {
    const items = [];
    if (reviewsCount > 0) {
      items.push({
        important: true,
        title: "Проверить сданные работы",
        text: `${reviewsCount} ${pluralRu(reviewsCount, "работа ждёт", "работы ждут", "работ ждут")} ручной проверки.`,
        href: "/cabinet/review",
        action: "Начать проверку →",
      });
    }
    const unfinished = todayLessons.find((lesson) => !lesson.ready && !lesson.isDone);
    if (unfinished) {
      items.push({
        important: true,
        title: `Доделать урок в ${unfinished.time}`,
        text: unfinished.topic
          ? `${unfinished.title} · ${unfinished.topic}`
          : `${unfinished.title} · тема или материалы ещё не указаны`,
        href: "/cabinet/schedule",
        action: "Доделать →",
      });
    }
    if (journalDash && (journalDash.unfilled_journals > 0 || journalDash.unmarked_attendance_lessons > 0)) {
      items.push({
        important: true,
        title: "Журнал",
        text: [
          journalDash.unfilled_journals > 0
            ? `Не заполнены итоги: ${journalDash.unfilled_journals}`
            : null,
          journalDash.unmarked_attendance_lessons > 0
            ? `Без посещаемости: ${journalDash.unmarked_attendance_lessons}`
            : null,
          journalDash.attention_students > 0
            ? `Требуют внимания: ${journalDash.attention_students}`
            : null,
        ].filter(Boolean).join(" · "),
        href: "/cabinet/journal",
        action: "Открыть журнал →",
      });
    }
    if (progressItems.length === 0 && !items.length) {
      items.push({
        important: false,
        title: "Добавьте учеников",
        text: "Когда появятся ученики и занятия, здесь будут задачи на сегодня.",
        href: "/cabinet/students",
        action: "Открыть учеников →",
      });
    }
    return items.slice(0, 4);
  }, [reviewsCount, todayLessons, progressItems.length, journalDash]);

  const notes = useMemo(() => {
    const list = [];
    todayLessons.slice(0, 2).forEach((lesson) => {
      list.push({
        title: lesson.audience || lesson.title,
        text: lesson.topic
          ? `Тема: ${lesson.topic}`
          : `Урок в ${lesson.time} · ${lesson.countdown}`,
      });
    });
    pendingReviews.slice(0, 2 - list.length).forEach((review) => {
      list.push({
        title: review.studentName,
        text: `${review.title} · ${formatSubmittedWhen(review.submittedAt) || "на проверке"}`,
      });
    });
    return list;
  }, [todayLessons, pendingReviews]);

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

  return (
    <main className="td-page">
      <div className="td-topbar">
        <div className="td-topbar__copy">
          <h1>{greetingForHour(today.getHours())}, {firstName}!</h1>
          <p>{subtitle}</p>
          <Link
            to="/cabinet/upgrade"
            className="td-plan-chip"
            title={planName ? `Тариф «${planName}»` : "Тарифы"}
          >
            <span className="td-plan-chip__label">Тариф</span>
            <span className="td-plan-chip__name">
              {subscriptionLoading ? "…" : (planName || "Не выбран")}
            </span>
          </Link>
        </div>
        <div className="td-topbar-actions">
          <Link to="/cabinet/schedule" className="td-button td-button-primary">＋ Создать урок</Link>
          <button
            type="button"
            className="td-button td-button-glass"
            onClick={openHomeworkAssign}
            disabled={assignLoading}
          >
            {assignLoading ? "Загрузка…" : "Выдать задание"}
          </button>
          <Link to="/cabinet/students?invite=1" className="td-button td-button-glass">Добавить ученика</Link>
        </div>
      </div>

      {subBanner ? (
        <aside className="td-sub-banner" role="status">
          <div className="td-sub-banner__body">
            <strong>
              {subBanner.auto_renew
                ? `Автопродление через ${subBanner.days_remaining} ${pluralRu(subBanner.days_remaining, "день", "дня", "дней")}`
                : `${subBanner.plan_name} заканчивается через ${subBanner.days_remaining} ${pluralRu(subBanner.days_remaining, "день", "дня", "дней")}`}
            </strong>
            <p>
              {subBanner.auto_renew
                ? `${new Date(subBanner.expires_at).toLocaleDateString("ru-RU", { day: "numeric", month: "long" })} будет списано ${Number(subBanner.next_charge_amount).toLocaleString("ru-RU")} ₽.`
                : `Подписка действует до ${new Date(subBanner.expires_at).toLocaleDateString("ru-RU", { day: "numeric", month: "long" })}.`}
            </p>
          </div>
          <div className="td-sub-banner__actions">
            {!subBanner.auto_renew ? (
              <Link to="/cabinet/upgrade" className="td-button td-button-primary">
                Продлить
              </Link>
            ) : null}
            <Link to="/cabinet/upgrade" className="td-button td-button-glass">
              Управление подпиской
            </Link>
          </div>
        </aside>
      ) : null}

      <div className="td-workspace">
        <section className="td-main-column">
          <article className="td-card td-today-board">
            <div className="td-section-head">
              <div>
                <h2>Сегодня</h2>
                <p>Вся основная информация собрана в одном рабочем блоке.</p>
              </div>
              <Link to="/cabinet/schedule" className="td-link">Открыть расписание →</Link>
            </div>

            <div className="td-today-status">
              <div className="td-status">
                <span className="td-status-label">Уроков сегодня</span>
                <strong className="td-status-value">{lessonsCount}</strong>
                <span className="td-status-note">{firstLessonNote}</span>
              </div>
              <div className={`td-status${reviewsCount > 0 ? " is-urgent" : ""}`}>
                <span className="td-status-label">Работ на проверке</span>
                <strong className="td-status-value">{reviewsCount}</strong>
                <span className="td-status-note">
                  {reviewsCount > 0 ? "есть очередь проверки" : "очередь пуста"}
                </span>
              </div>
              <div className="td-status">
                <span className="td-status-label">Домашних заданий сегодня</span>
                <strong className="td-status-value">{homeworkToday}</strong>
                <span className="td-status-note">
                  {homeworkToday > 0 ? "ближайшие сроки" : "активных сроков нет"}
                </span>
              </div>
              <div className={`td-status${draftsCount === 0 ? " is-good" : ""}`}>
                <span className="td-status-label">Черновики</span>
                <strong className="td-status-value">{draftsCount}</strong>
                <span className="td-status-note">
                  {draftsCount === 0 ? "всё в порядке" : "уроки, планы, интерактивы"}
                </span>
              </div>
            </div>

            <div className="td-primary-grid">
              <section className="td-schedule-panel">
                <div className="td-section-head">
                  <div>
                    <h3>Расписание на сегодня</h3>
                    <p>Время, ученик, тема и готовность урока.</p>
                  </div>
                  <Link to="/cabinet/schedule" className="td-small-button">＋ Добавить урок</Link>
                </div>

                {todayLessons.length === 0 ? (
                  <div className="td-empty">
                    <h4>На сегодня уроков нет</h4>
                    <p>Запланируйте занятие в расписании — оно появится здесь.</p>
                    <Link to="/cabinet/schedule" className="td-small-button">Открыть расписание</Link>
                  </div>
                ) : (
                  <div className="td-schedule-list">
                    {todayLessons.map((lesson) => (
                      <article
                        key={lesson.id || `${lesson.time}-${lesson.title}`}
                        className={`td-lesson${lesson.isCurrent ? " is-current" : ""}`}
                      >
                        <div className="td-lesson-time">{lesson.time}</div>
                        <div>
                          <h4>
                            {lesson.audience && lesson.title
                              && lesson.audience.trim().toLowerCase() !== lesson.title.trim().toLowerCase()
                              ? `${lesson.audience} · ${lesson.title}`
                              : (lesson.audience || lesson.title)}
                          </h4>
                          <p>
                            {lesson.topic
                              ? `${lesson.topic} · ${lesson.countdown}`
                              : `Тема пока не указана · ${lesson.countdown}`}
                          </p>
                        </div>
                        <div className="td-lesson-meta">
                          <span className={`td-chip${lesson.ready || lesson.isDone ? "" : " is-yellow"}`}>
                            {lesson.isDone ? "Пройден" : lesson.ready ? "Готово" : "Не всё готово"}
                          </span>
                          <Link to="/cabinet/schedule" className="td-lesson-action">
                            {lesson.ready || lesson.isDone ? "Открыть урок →" : "Доделать →"}
                          </Link>
                        </div>
                      </article>
                    ))}
                  </div>
                )}
              </section>

              <aside className="td-review-panel">
                <div className="td-section-head">
                  <div>
                    <h3>Нужно проверить</h3>
                    <p>Работы отсортированы по срочности.</p>
                  </div>
                  <Link to="/cabinet/review" className="td-link">Все работы →</Link>
                </div>

                {pendingReviews.length === 0 ? (
                  <div className="td-empty td-empty--compact">
                    <h4>Нет работ на проверку</h4>
                    <p>Когда ученики сдадут задания, они появятся здесь.</p>
                  </div>
                ) : (
                  <div className="td-review-list">
                    {pendingReviews.slice(0, 5).map((item, index) => (
                      <Link key={item.id} to={item.href} className="td-review-item">
                        <div className="td-review-icon">{index + 1}</div>
                        <div>
                          <h4>{item.studentName} · {item.title}</h4>
                          <p>
                            {item.typeLabel}
                            {item.submittedAt ? ` · ${formatSubmittedWhen(item.submittedAt)}` : ""}
                          </p>
                        </div>
                        <div className="td-review-count">1</div>
                      </Link>
                    ))}
                  </div>
                )}

                <div className="td-review-footer">
                  <Link to="/cabinet/review" className="td-button">Начать проверку</Link>
                </div>
              </aside>
            </div>
          </article>

          <article className="td-card td-attention-card">
            <div className="td-section-head">
              <div>
                <h3>Требует внимания</h3>
                <p>Только действия, которые действительно нужно выполнить сегодня.</p>
              </div>
              <Link to="/cabinet/settings/notifications" className="td-link">Все уведомления →</Link>
            </div>
            <div className="td-attention-grid">
              {attentionItems.map((item) => (
                <div
                  key={item.title}
                  className={`td-attention-item${item.important ? " is-important" : ""}`}
                >
                  <h4>{item.title}</h4>
                  <p>{item.text}</p>
                  <Link to={item.href}>{item.action}</Link>
                </div>
              ))}
            </div>
          </article>

          <article className="td-card td-analytics-card">
            <div className="td-section-head">
              <div>
                <h3>Кратко</h3>
                <p>Аналитика находится ниже рабочего блока и не мешает ежедневным задачам.</p>
              </div>
              <Link to="/cabinet/reports" className="td-link">Подробный отчёт →</Link>
            </div>
            <div className="td-analytics-grid">
              <div className="td-metric">
                <span>Активных учеников</span>
                <strong>{data?.active_students_count ?? 0}</strong>
                <small>В кабинете учителя</small>
              </div>
              <div className="td-metric">
                <span>Уроков сегодня</span>
                <strong>{lessonsCount}</strong>
                <small>{firstLessonNote}</small>
              </div>
              <div className="td-metric">
                <span>На проверке</span>
                <strong>{reviewsCount}</strong>
                <small>Очередь ручной проверки</small>
              </div>
              <div className="td-metric">
                <span>Черновики</span>
                <strong>{draftsCount}</strong>
                <small>Уроки, планы и интерактивы</small>
              </div>
            </div>
          </article>
        </section>

        <aside className="td-side-column">
          {PAYMENTS_ENABLED && billingDash && (
            Number(billingDash.awaiting_payment_count) > 0
            || Number(billingDash.needs_decision) > 0
            || Number(billingDash.low_packages) > 0
            || Number(billingDash.debt_total) > 0
            || Number(billingDash.today_received) > 0
          ) ? (
            <section className="td-card td-side-card pay-dash-widget">
              <h3>Оплаты</h3>
              <ul>
                {Number(billingDash.today_received) > 0 ? (
                  <li><span>Поступило сегодня</span><strong>{formatMoney(billingDash.today_received, billingDash.currency)}</strong></li>
                ) : null}
                {Number(billingDash.awaiting_payment_count) > 0 ? (
                  <li><span>Ожидают оплаты</span><strong>{billingDash.awaiting_payment_count}</strong></li>
                ) : null}
                {Number(billingDash.needs_decision) > 0 ? (
                  <li><span>Без оформления</span><strong>{billingDash.needs_decision}</strong></li>
                ) : null}
                {Number(billingDash.low_packages) > 0 ? (
                  <li><span>Абонементы заканчиваются</span><strong>{billingDash.low_packages}</strong></li>
                ) : null}
                {Number(billingDash.debt_total) > 0 ? (
                  <li><span>Задолженность</span><strong>{formatMoney(billingDash.debt_total, billingDash.currency)}</strong></li>
                ) : null}
              </ul>
              <Link to="/cabinet/payments" className="td-link" style={{ display: "inline-block", marginTop: 10 }}>
                Открыть оплаты →
              </Link>
            </section>
          ) : null}

          <section className="td-card td-side-card">
            <h3>Быстрые действия</h3>
            <p>Частые действия доступны без перехода по разделам.</p>
            <div className="td-quick-actions">
              <Link to="/cabinet/schedule" className="td-quick-action">
                <span className="td-quick-icon">＋</span>
                <span>
                  <strong>Создать урок</strong>
                  <span>Тема, материалы, ссылка и домашнее задание</span>
                </span>
                <span className="td-quick-arrow">→</span>
              </Link>
              <Link to="/cabinet/review" className="td-quick-action">
                <span className="td-quick-icon">✓</span>
                <span>
                  <strong>Проверить работы</strong>
                  <span>Открыть очередь ручной проверки</span>
                </span>
                <span className="td-quick-arrow">→</span>
              </Link>
              <button
                type="button"
                className="td-quick-action"
                onClick={openHomeworkAssign}
                disabled={assignLoading}
              >
                <span className="td-quick-icon">⌁</span>
                <span>
                  <strong>Выдать задание</strong>
                  <span>Отдельному ученику или группе</span>
                </span>
                <span className="td-quick-arrow">→</span>
              </button>
              <Link to="/cabinet/students?invite=1" className="td-quick-action">
                <span className="td-quick-icon">＋</span>
                <span>
                  <strong>Добавить ученика</strong>
                  <span>Приглашение и предварительный профиль</span>
                </span>
                <span className="td-quick-arrow">→</span>
              </Link>
            </div>
          </section>

          <section className="td-card td-side-card td-calendar-card">
            <div className="td-calendar-header">
              <span className="td-calendar-title">{MONTHS[today.getMonth()]} {today.getFullYear()}</span>
              <Link to="/cabinet/schedule" className="td-link">Расписание</Link>
            </div>
            <div className="td-weekdays">
              {WEEKDAYS.map((day) => <span key={day}>{day}</span>)}
            </div>
            <div className="td-days">
              {calendarDays.map((cell, index) => (
                <span
                  key={`${cell.day}-${index}`}
                  className={[
                    "td-day",
                    cell.muted ? "is-muted" : "",
                    cell.isToday ? "is-today" : "",
                    cell.hasEvent ? "has-event" : "",
                  ].filter(Boolean).join(" ")}
                >
                  {cell.day}
                </span>
              ))}
            </div>
          </section>

          <section className="td-card td-side-card">
            <h3>Заметки на сегодня</h3>
            <p>Короткие рабочие напоминания учителя.</p>
            <div className="td-notes-list">
              {notes.length === 0 ? (
                <div className="td-note">
                  <strong>Пока тихо</strong>
                  <span>Когда появятся уроки или работы, здесь будут короткие напоминания.</span>
                </div>
              ) : (
                notes.map((note) => (
                  <div key={`${note.title}-${note.text}`} className="td-note">
                    <strong>{note.title}</strong>
                    <span>{note.text}</span>
                  </div>
                ))
              )}
            </div>
          </section>
        </aside>
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
    </main>
  );
}
