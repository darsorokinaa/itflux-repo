import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useLocation, useNavigate } from "react-router-dom";
import { trackActivationIntent } from "../activationAnalytics";
import {
  createScheduleEvent,
  deleteScheduleEvent,
  ensureScheduleEventPlanItem,
  ensureVideoMeetingForEvent,
  fetchCalendarEvents,
  fetchCalendarStatus,
  fetchEventBillingBadge,
  fetchGroup,
  fetchScheduleEvents,
  fetchStudents,
  normalizeCabinetList,
  startTelemostLesson,
  updateLessonPlanItem,
  updateScheduleEvent,
  updateScheduleEventMaterials,
} from "../../utils/cabinetAuth";
import FinalizeLessonBillingModal from "../components/FinalizeLessonBillingModal";
import BillingPaymentModal from "../components/BillingPaymentModal";
import "../styles/payments.css";
import { useCabinetCall } from "../CabinetCallContext";
import { mapApiStudent } from "../cabinetMappers";
import { isTelemostMeetingUrl } from "../telemostPopup";
import { cabinetMeetingPathFromHref, isCabinetMeetingHref } from "../meetingNavigation";
import CreateScheduleLessonModal from "../components/CreateScheduleLessonModal";
import EditScheduleLessonModal from "../components/EditScheduleLessonModal";
import EventDetailCard from "../components/EventDetailCard";
import ConnectionCheckButton from "../connectionCheck/ConnectionCheckButton";
import { closeConnectionCheck } from "../connectionCheck/openConnectionCheck";
import HomeworkAssignModal from "../components/HomeworkAssignModal";
import { openLessonSummaryTab } from "../journal/openLessonSummary";
import PlanItemDetailModal from "../components/PlanItemDetailModal";
import "../styles/schedule-mobile.css";
import PlanItemResourcesPicker from "../components/PlanItemResourcesPicker";
import { skipOnboardingMaterials } from "../onboardingStorage";
import CabinetIcon from "../CabinetIcons";
import { CabinetPageShell, useSoonToast } from "../CabinetSectionUi";
import { usePageTitle } from "../hooks/usePageTitle";
import {
  applySeriesTimeUpdate,
  combineLocalDateAndTime,
  eventDisplaySubtitle,
  eventDisplayTitle,
  eventLocalEndTime,
  eventLocalStartTime,
  eventLocalTimeRange,
  formatLocalDateTimeIso,
  getUpcomingEvents,
  getSeriesRefreshRange,
  localClockToTimeZone,
  parseScheduleScope,
  upcomingEventDateLabel,
} from "../scheduleLessonUtils";
import {
  planItemForScheduleEvent,
  eventAssignedHomeworkRows,
  planItemLessonPopoverRows,
  planItemTaskPopoverRows,
  scheduleEventPlanItemToModalItem,
} from "../planItemAttachments";
import {
  resolveLessonCourseTitle,
  resolveLessonDescription,
  resolveLessonSubjectLabel,
  resolveLessonTopic,
} from "../lessonCardContent";

const VIEWS = [
  { id: "day", label: "День" },
  { id: "week", label: "Неделя" },
  { id: "month", label: "Месяц" },
  { id: "list", label: "Список" },
];

const WEEKDAYS_SHORT = ["Пн", "Вт", "Ср", "Чт", "Пт", "Сб", "Вс"];
const WEEKDAYS_FULL = ["понедельник", "вторник", "среда", "четверг", "пятница", "суббота", "воскресенье"];
const MONTHS = [
  "января", "февраля", "марта", "апреля", "мая", "июня",
  "июля", "августа", "сентября", "октября", "ноября", "декабря",
];
const MONTHS_NOM = [
  "Январь", "Февраль", "Март", "Апрель", "Май", "Июнь",
  "Июль", "Август", "Сентябрь", "Октябрь", "Ноябрь", "Декабрь",
];

const HOUR_START = 8;
const HOUR_END = 22;
const HOUR_HEIGHT = 52;
const EVENT_MIN_HEIGHT = 22;

const EVENT_TYPES = {
  group: { label: "Групповое занятие", color: "#2563EB" },
  group_lesson: { label: "Групповое занятие", color: "#2563EB" },
  individual: { label: "Индивидуальное занятие", color: "#F59E0B" },
  individual_lesson: { label: "Индивидуальное занятие", color: "#F59E0B" },
  homework: { label: "Домашнее задание", color: "#D97706" },
  review: { label: "Проверка работ", color: "#DC2626" },
};

function eventAccentColor(event) {
  if (event.status === "cancelled") return "#EF4444";
  if (event.status === "done" || event.status === "completed") return "#10B981";
  const tags = event.tags || [];
  if (tags.includes("ege")) return "#7C3AED";
  if (tags.includes("oge")) return "#2563EB";
  if (tags.includes("python")) return "#059669";
  const t = event.type || "";
  if (t === "individual" || t === "individual_lesson") return "#F59E0B";
  if (t === "group" || t === "group_lesson") return "#2563EB";
  return EVENT_TYPES[event.type]?.color || "#2563EB";
}

function isWeekend(date) {
  const d = date.getDay();
  return d === 0 || d === 6;
}

function addMinutesToTime(time, minutes) {
  const total = parseTime(time) + minutes;
  return minutesToTime(total);
}

const CALENDAR_SOURCES = [
  { id: "all", label: "Все события", color: "#64748B" },
  { id: "yandex", label: "Яндекс Календарь", color: "#2563EB" },
];

function formatApiDate(date) {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, "0");
  const d = String(date.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

function getCalendarFetchRange(view, focusDate) {
  let range;
  if (view === "day") {
    range = { from: formatApiDate(focusDate), to: formatApiDate(focusDate) };
  } else if (view === "month") {
    const start = new Date(focusDate.getFullYear(), focusDate.getMonth(), 1);
    const end = new Date(focusDate.getFullYear(), focusDate.getMonth() + 1, 0);
    range = { from: formatApiDate(start), to: formatApiDate(end) };
  } else if (view === "list") {
    const start = startOfDay(new Date());
    const end = addDays(start, 60);
    range = { from: formatApiDate(start), to: formatApiDate(end) };
  } else {
    const ws = startOfWeek(focusDate);
    const we = endOfWeek(focusDate);
    range = { from: formatApiDate(ws), to: formatApiDate(we) };
  }
  const upcomingFrom = formatApiDate(startOfDay(new Date()));
  const upcomingTo = formatApiDate(addDays(startOfDay(new Date()), 21));
  return {
    from: range.from < upcomingFrom ? range.from : upcomingFrom,
    to: range.to > upcomingTo ? range.to : upcomingTo,
  };
}

function startOfDay(date) {
  const d = new Date(date);
  d.setHours(0, 0, 0, 0);
  return d;
}

function addDays(date, days) {
  const d = new Date(date);
  d.setDate(d.getDate() + days);
  return d;
}

function addMonths(date, months) {
  const d = new Date(date);
  d.setMonth(d.getMonth() + months);
  return d;
}

function startOfWeek(date) {
  const d = startOfDay(date);
  const day = (d.getDay() + 6) % 7;
  return addDays(d, -day);
}

function endOfWeek(date) {
  return addDays(startOfWeek(date), 6);
}

function isSameDay(a, b) {
  return (
    a.getFullYear() === b.getFullYear()
    && a.getMonth() === b.getMonth()
    && a.getDate() === b.getDate()
  );
}

function isToday(date) {
  return isSameDay(date, new Date());
}

function eventDate(event) {
  if (event.startsAt) {
    return startOfDay(new Date(event.startsAt));
  }
  return addDays(startOfDay(new Date()), event.dayOffset ?? 0);
}

function parseTime(time) {
  const [h, m] = time.split(":").map(Number);
  return h * 60 + m;
}

function timeToTop(time) {
  const minutes = parseTime(time) - HOUR_START * 60;
  return (minutes / 60) * HOUR_HEIGHT;
}

function eventHeight(startTime, endTime) {
  const duration = Math.max(parseTime(endTime) - parseTime(startTime), 15);
  return Math.max((duration / 60) * HOUR_HEIGHT - 2, EVENT_MIN_HEIGHT);
}

function eventDurationMinutes(startTime, endTime) {
  return Math.max(parseTime(endTime) - parseTime(startTime), 15);
}

function getCurrentTimeTop() {
  const now = new Date();
  const h = now.getHours();
  const m = now.getMinutes();
  if (h < HOUR_START || h > HOUR_END) return null;
  if (h === HOUR_END && m > 0) return null;
  const time = `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`;
  return timeToTop(time);
}

function useCurrentTimeTop() {
  const [top, setTop] = useState(() => getCurrentTimeTop());
  useEffect(() => {
    const tick = () => setTop(getCurrentTimeTop());
    const id = window.setInterval(tick, 30000);
    return () => window.clearInterval(id);
  }, []);
  return top;
}

function gridOffsetY(bodyEl, clientY) {
  if (!bodyEl) return 0;
  return clientY - bodyEl.getBoundingClientRect().top + bodyEl.scrollTop;
}

function minutesToTime(totalMinutes) {
  const h = Math.floor(totalMinutes / 60);
  const m = totalMinutes % 60;
  return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`;
}

function snapMinutes(minutes, step = 15) {
  return Math.round(minutes / step) * step;
}

function dropTimeFromOffsetY(offsetY) {
  const rawMinutes = HOUR_START * 60 + (offsetY / HOUR_HEIGHT) * 60;
  const snapped = snapMinutes(rawMinutes);
  const min = HOUR_START * 60;
  const max = HOUR_END * 60 - 15;
  return minutesToTime(Math.min(Math.max(snapped, min), max));
}

function dayOffsetFromToday(date) {
  const today = startOfDay(new Date());
  return Math.round((startOfDay(date) - today) / 86400000);
}

function formatEventWhen(event) {
  const d = eventDate(event);
  const wd = WEEKDAYS_FULL[(d.getDay() + 6) % 7];
  return `${wd.charAt(0).toUpperCase()}${wd.slice(1)}, ${d.getDate()} ${MONTHS[d.getMonth()]}, ${eventLocalTimeRange(event)}`;
}

function isRecurring(event) {
  return Boolean(event.seriesId || event.hasOrphanSeries || event.isRecurring);
}

function seriesScopeKey(event) {
  return event?.logicalSeriesKey || event?.seriesId || null;
}

function buildEventDateTime(event) {
  const start = event.startsAt ? new Date(event.startsAt) : null;
  const end = event.endsAt ? new Date(event.endsAt) : null;
  if (start && end && !Number.isNaN(start.getTime()) && !Number.isNaN(end.getTime())) {
    return {
      starts_at: formatLocalDateTimeIso(start),
      ends_at: formatLocalDateTimeIso(end),
    };
  }
  const date = eventDate(event);
  return {
    starts_at: formatLocalDateTimeIso(combineLocalDateAndTime(date, eventLocalStartTime(event))),
    ends_at: formatLocalDateTimeIso(combineLocalDateAndTime(date, eventLocalEndTime(event))),
  };
}

function isLocalEvent(event) {
  return event?.source === "local" || String(event?.id || "").startsWith("local-");
}

function scheduleEventNumericId(eventId) {
  const text = String(eventId || "").trim();
  if (text.startsWith("local-")) {
    const n = Number(text.slice(6));
    return Number.isFinite(n) ? n : null;
  }
  const n = Number(text);
  return Number.isFinite(n) ? n : null;
}

function hasJitsiMeeting(event) {
  return Boolean(event?.videoMeeting?.uuid || event?.meetingProvider === "jitsi");
}

function isCabinetMeetingPath(url) {
  return isCabinetMeetingHref(url);
}

function matchesSeriesScope(ev, event, scope) {
  const key = seriesScopeKey(event);
  if (!key || seriesScopeKey(ev) !== key) return false;
  if (scope === "entire" || scope === "series") return true;
  if (scope === "following") return eventDate(ev) >= eventDate(event);
  return eventDate(ev) >= eventDate(event);
}

function applyMoveEvents(events, event, targetDate, newStartTime, scope) {
  const dayDelta = dayOffsetFromToday(targetDate) - dayOffsetFromToday(eventDate(event));
  const newStart = parseTime(newStartTime);
  const timeDelta = newStart - parseTime(eventLocalStartTime(event));

  const patch = (ev) => {
    const evDuration = parseTime(eventLocalEndTime(ev)) - parseTime(eventLocalStartTime(ev));
    const evNewStart = parseTime(eventLocalStartTime(ev)) + timeDelta;
    const startTime = minutesToTime(evNewStart);
    const endTime = minutesToTime(evNewStart + evDuration);
    const newDayOffset = dayOffsetFromToday(eventDate(ev)) + dayDelta;
    const newDate = addDays(startOfDay(new Date()), newDayOffset);
    const startDt = combineLocalDateAndTime(newDate, startTime);
    const endDt = combineLocalDateAndTime(newDate, endTime);
    return {
      ...ev,
      dayOffset: newDayOffset,
      startTime,
      endTime,
      startsAt: formatLocalDateTimeIso(startDt),
      endsAt: formatLocalDateTimeIso(endDt),
    };
  };

  if (scope === "single" || !isRecurring(event)) {
    return events.map((ev) => (ev.id === event.id ? patch(ev) : ev));
  }

  return events.map((ev) => {
    if (!matchesSeriesScope(ev, event, scope)) return ev;
    return patch(ev);
  });
}

function applyRemoveEvents(events, event, scope) {
  if (scope === "single" || !isRecurring(event)) {
    return events.filter((ev) => ev.id !== event.id);
  }
  return events.filter((ev) => !matchesSeriesScope(ev, event, scope));
}

function applyCancelEvents(events, event, scope) {
  const cancel = (ev) => ({
    ...ev,
    status: "cancelled",
    statusLabel: "Отменено",
  });

  if (scope === "single" || !isRecurring(event)) {
    return events.map((ev) => (ev.id === event.id ? cancel(ev) : ev));
  }

  return events.map((ev) => {
    if (!matchesSeriesScope(ev, event, scope)) return ev;
    return cancel(ev);
  });
}


const DRAG_THRESHOLD = 8;

function dateFromSchDayKey(key) {
  const [y, m, d] = key.split("-").map(Number);
  return new Date(y, m - 1, d);
}

function resolveScheduleDropTarget(clientX, clientY, mode) {
  const el = document.elementFromPoint(clientX, clientY);
  const col = el?.closest("[data-sch-day]");
  if (!col) return null;
  const dayKey = col.getAttribute("data-sch-day");
  if (!dayKey) return null;
  const targetDate = dateFromSchDayKey(dayKey);
  if (mode === "month") {
    return { dayKey, targetDate, time: null };
  }
  const body = col.closest(".cb-sch-week__body, .cb-sch-day__body");
  const time = dropTimeFromOffsetY(gridOffsetY(body, clientY));
  return { dayKey, targetDate, time };
}

function useSchedulePointerDrag({ enabled, events, onDragOver, onDrop, onDragEnd }) {
  const sessionRef = useRef(null);
  const [draggingId, setDraggingId] = useState(null);

  const onEventPointerDown = useCallback((eventId, e) => {
    if (!enabled) return;
    if (e.button !== 0) return;
    const mode = e.currentTarget.closest(".cb-sch-month") ? "month" : "time";
    sessionRef.current = {
      eventId,
      startX: e.clientX,
      startY: e.clientY,
      active: false,
      mode,
    };
  }, [enabled]);

  useEffect(() => {
    if (!enabled) return undefined;

    const finish = (e, wasActive) => {
      if (wasActive) {
        const target = resolveScheduleDropTarget(e.clientX, e.clientY, sessionRef.current?.mode);
        if (target) {
          const event = events.find((ev) => String(ev.id) === String(sessionRef.current?.eventId));
          const time = target.time ?? eventLocalStartTime(event) ?? "09:00";
          onDrop(sessionRef.current.eventId, target.targetDate, time);
        }
        onDragEnd?.();
      }
      sessionRef.current = null;
      setDraggingId(null);
      document.body.classList.remove("cb-sch-dragging");
    };

    const onMove = (e) => {
      const session = sessionRef.current;
      if (!session) return;
      if (!session.active) {
        const dist = Math.hypot(e.clientX - session.startX, e.clientY - session.startY);
        if (dist < DRAG_THRESHOLD) return;
        session.active = true;
        setDraggingId(session.eventId);
        document.body.classList.add("cb-sch-dragging");
      }
      const target = resolveScheduleDropTarget(e.clientX, e.clientY, session.mode);
      if (!target) return;
      const event = events.find((ev) => String(ev.id) === String(session.eventId));
      const time = target.time ?? eventLocalStartTime(event) ?? "09:00";
      onDragOver(target.targetDate, time, target.dayKey);
    };

    const onUp = (e) => {
      const session = sessionRef.current;
      if (!session) return;
      finish(e, session.active);
    };

    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
    window.addEventListener("pointercancel", onUp);
    return () => {
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
      window.removeEventListener("pointercancel", onUp);
      document.body.classList.remove("cb-sch-dragging");
    };
  }, [enabled, events, onDragOver, onDrop, onDragEnd]);

  return { draggingId, onEventPointerDown };
}

function formatDayHeading(date) {
  const today = startOfDay(new Date());
  const target = startOfDay(date);
  const diff = Math.round((target - today) / 86400000);
  if (diff === 0) return `Сегодня, ${date.getDate()} ${MONTHS[date.getMonth()]}`;
  if (diff === 1) return `Завтра, ${date.getDate()} ${MONTHS[date.getMonth()]}`;
  const wd = WEEKDAYS_FULL[(date.getDay() + 6) % 7];
  return `${wd.charAt(0).toUpperCase()}${wd.slice(1)}, ${date.getDate()} ${MONTHS[date.getMonth()]}`;
}

function formatPeriodLabel(view, focusDate) {
  if (view === "day") {
    const wd = WEEKDAYS_FULL[(focusDate.getDay() + 6) % 7];
    return `${wd.charAt(0).toUpperCase()}${wd.slice(1)}, ${focusDate.getDate()} ${MONTHS[focusDate.getMonth()]}`;
  }
  if (view === "month") {
    return `${MONTHS_NOM[focusDate.getMonth()]} ${focusDate.getFullYear()}`;
  }
  if (view === "list") {
    return "Ближайшие занятия";
  }
  const ws = startOfWeek(focusDate);
  const we = endOfWeek(focusDate);
  if (ws.getMonth() === we.getMonth()) {
    return `${ws.getDate()}–${we.getDate()} ${MONTHS[ws.getMonth()]} ${ws.getFullYear()}`;
  }
  return `${ws.getDate()} ${MONTHS[ws.getMonth()]} – ${we.getDate()} ${MONTHS[we.getMonth()]} ${we.getFullYear()}`;
}

function matchesFilters(event, calendars) {
  if (event.source === "yandex_calendar") {
    if (!calendars.all && !calendars.yandex) return false;
  } else if (!calendars.all && !calendars[event.type]) {
    return false;
  }
  return true;
}

function NavChevron({ direction }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      {direction === "left" ? <path d="M15 18l-6-6 6-6" /> : <path d="M9 18l6-6-6-6" />}
    </svg>
  );
}

function buildYandexEmbedUrl(view, layerIds, tzId) {
  const path = { day: "day", week: "week", month: "month", list: "week" }[view] || "week";
  const params = new URLSearchParams();
  params.set("embed", "");
  params.set("layer_ids", layerIds);
  params.set("tz_id", tzId || "Europe/Moscow");
  return `https://calendar.yandex.ru/${path}?${params.toString()}`;
}

function YandexCalendarEmbed({ view, layerIds, tzId }) {
  const src = useMemo(
    () => buildYandexEmbedUrl(view, layerIds, tzId),
    [view, layerIds, tzId],
  );

  return (
    <div className="cb-sch-yandex-embed">
      <iframe
        title="Яндекс Календарь"
        src={src}
        loading="lazy"
        referrerPolicy="no-referrer-when-downgrade"
      />
    </div>
  );
}

function ScheduleToolbar({
  view,
  onViewChange,
  focusDate,
  onToday,
  onPrev,
  onNext,
  onAddLesson,
  isMobile,
  accountEmail,
}) {
  const views = isMobile ? VIEWS.filter((v) => v.id !== "week") : VIEWS;

  return (
    <div className="cb-sch-toolbar">
      <div className="cb-sch-toolbar__left">
        <h1 className="cb-sch-toolbar__title">Календарь</h1>
        <button type="button" className="cb-btn cb-btn--outline cb-sch-btn--today" onClick={onToday}>
          Сегодня
        </button>
        <div className="cb-sch-toolbar__nav">
          <button type="button" className="cb-sch-icon-btn" onClick={onPrev} aria-label="Назад">
            <NavChevron direction="left" />
          </button>
          <button type="button" className="cb-sch-icon-btn" onClick={onNext} aria-label="Вперёд">
            <NavChevron direction="right" />
          </button>
        </div>
        <span className="cb-sch-toolbar__period">{formatPeriodLabel(view, focusDate)}</span>
        {accountEmail ? (
          <span className="cb-sch-toolbar__account">{accountEmail}</span>
        ) : null}
      </div>
      <div className="cb-sch-toolbar__right">
        <div className="cb-sch-view-switch" role="tablist">
          {views.map((v) => (
            <button
              key={v.id}
              type="button"
              role="tab"
              aria-selected={view === v.id}
              className={`cb-sch-view-btn${view === v.id ? " cb-sch-view-btn--active" : ""}`}
              onClick={() => onViewChange(v.id)}
            >
              {v.label}
            </button>
          ))}
        </div>
        <button type="button" className="cb-btn cb-btn--primary cb-sch-btn--add" onClick={onAddLesson}>
          <CabinetIcon name="plus" />
          Добавить урок
        </button>
      </div>
    </div>
  );
}

function buildEventDaysInMonth(events, year, month) {
  const days = new Set();
  events.forEach((ev) => {
    if (ev.status === "cancelled") return;
    const d = eventDate(ev);
    if (d.getFullYear() === year && d.getMonth() === month) {
      days.add(d.getDate());
    }
  });
  return days;
}

function MiniCalendar({ focusDate, selectedDate, onSelectDate, events = [] }) {
  const monthStart = useMemo(() => {
    const d = new Date(focusDate.getFullYear(), focusDate.getMonth(), 1);
    return startOfDay(d);
  }, [focusDate]);

  const eventDays = useMemo(
    () => buildEventDaysInMonth(events, focusDate.getFullYear(), focusDate.getMonth()),
    [events, focusDate],
  );

  const cells = useMemo(() => {
    const firstDow = (monthStart.getDay() + 6) % 7;
    const daysInMonth = new Date(focusDate.getFullYear(), focusDate.getMonth() + 1, 0).getDate();
    const result = [];
    for (let i = 0; i < firstDow; i += 1) result.push(null);
    for (let day = 1; day <= daysInMonth; day += 1) {
      result.push(new Date(focusDate.getFullYear(), focusDate.getMonth(), day));
    }
    return result;
  }, [focusDate, monthStart]);

  return (
    <div className="cb-sch-mini-cal">
      <div className="cb-sch-mini-cal__head">
        <span>{MONTHS_NOM[focusDate.getMonth()]} {focusDate.getFullYear()}</span>
      </div>
      <div className="cb-sch-mini-cal__grid">
        {WEEKDAYS_SHORT.map((wd) => (
          <span key={wd} className="cb-sch-mini-cal__wd">{wd}</span>
        ))}
        {cells.map((date, i) => {
          if (!date) return <span key={`e-${i}`} className="cb-sch-mini-cal__day cb-sch-mini-cal__day--empty" />;
          const today = isToday(date);
          const selected = isSameDay(date, selectedDate);
          const hasEvent = eventDays.has(date.getDate());
          return (
            <button
              key={date.toISOString()}
              type="button"
              className={[
                "cb-sch-mini-cal__day",
                today ? "cb-sch-mini-cal__day--today" : "",
                selected ? "cb-sch-mini-cal__day--selected" : "",
                hasEvent ? "cb-sch-mini-cal__day--event" : "",
              ].filter(Boolean).join(" ")}
              onClick={() => onSelectDate(date)}
            >
              {date.getDate()}
              {hasEvent ? <i className="cb-sch-mini-cal__dot" aria-hidden="true" /> : null}
            </button>
          );
        })}
      </div>
    </div>
  );
}

function UpcomingLessons({ events, onEventClick, compact }) {
  const upcoming = useMemo(() => getUpcomingEvents(events, 3), [events]);

  return (
    <div className={`cb-sch-upcoming${compact ? " cb-sch-upcoming--compact" : ""}`}>
      <h3 className="cb-sch-sidebar__heading">Ближайшие</h3>
      {upcoming.length === 0 ? (
        <p className="cb-sch-upcoming__empty">Ближайших занятий нет</p>
      ) : (
        <ul className="cb-sch-upcoming__list">
          {upcoming.map((ev) => {
            const subtitle = eventDisplaySubtitle(ev);
            const dateLabel = upcomingEventDateLabel(ev);
            return (
              <li key={ev.id}>
                <button
                  type="button"
                  className="cb-sch-upcoming__item"
                  onClick={() => onEventClick(ev)}
                >
                  <span className="cb-sch-upcoming__when">
                    <span className="cb-sch-upcoming__time">{eventLocalStartTime(ev)}</span>
                    {dateLabel ? (
                      <span className="cb-sch-upcoming__date">{dateLabel}</span>
                    ) : null}
                  </span>
                  <span className="cb-sch-upcoming__text">
                    <span className="cb-sch-upcoming__title">{eventDisplayTitle(ev)}</span>
                    {subtitle ? (
                      <span className="cb-sch-upcoming__meta">{subtitle}</span>
                    ) : null}
                  </span>
                </button>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}

function ScheduleSidebar({
  open,
  onToggle,
  focusDate,
  selectedDate,
  onSelectDate,
  calendars,
  onCalendarToggle,
  onCreate,
  upcomingEvents,
  onEventClick,
  yandexCalendarEnabled,
}) {
  const calendarSources = yandexCalendarEnabled
    ? CALENDAR_SOURCES
    : CALENDAR_SOURCES.filter((src) => src.id !== "yandex");
  return (
    <>
      <button
        type="button"
        className="cb-sch-sidebar-toggle"
        onClick={onToggle}
        aria-expanded={open}
        aria-label={open ? "Скрыть панель" : "Показать панель"}
      >
        <CabinetIcon name="calendar" />
      </button>
      <aside className={`cb-sch-sidebar${open ? "" : " cb-sch-sidebar--collapsed"}`}>
        <button type="button" className="cb-btn cb-btn--outline cb-sch-btn--create" onClick={onCreate}>
          <CabinetIcon name="plus" />
          Новый урок
        </button>

        <MiniCalendar
          focusDate={focusDate}
          selectedDate={selectedDate}
          onSelectDate={onSelectDate}
          events={upcomingEvents}
        />

        <UpcomingLessons events={upcomingEvents} onEventClick={onEventClick} />

        {yandexCalendarEnabled ? (
          <div className="cb-sch-sidebar__section cb-sch-sidebar__section--sources">
            <h3 className="cb-sch-sidebar__heading">Источники</h3>
            <div className="cb-filter-bar cb-sch-filter-chips__bar">
              {calendarSources.map((src) => (
                <button
                  key={src.id}
                  type="button"
                  className={`cb-filter-chip${calendars[src.id] ? " cb-filter-chip--active" : ""}`}
                  onClick={() => onCalendarToggle(src.id)}
                >
                  {src.label}
                </button>
              ))}
            </div>
          </div>
        ) : null}
      </aside>
    </>
  );
}

function CalendarEventBlock({
  event,
  style,
  compact,
  canDrag,
  dragging,
  onClick,
  onPointerDown,
}) {
  const accent = eventAccentColor(event);
  const shortBlock = !compact && eventDurationMinutes(eventLocalStartTime(event), eventLocalEndTime(event)) < 35;
  const isOnline = event.format === "Онлайн" || Boolean(event.link);
  const cancelled = event.status === "cancelled";
  const recurring = isRecurring(event);
  const displayTitle = eventDisplayTitle(event);
  const displaySubtitle = eventDisplaySubtitle(event);
  const planTopic = resolveLessonTopic(event);
  const cardSubtitle = displaySubtitle || (planTopic && planTopic !== displayTitle ? planTopic : "");

  const cardStyle = {
    ...style,
    borderLeftColor: accent,
    ...(compact ? { borderLeftColor: accent } : {}),
  };

  const content = !compact ? (
    <>
      <div className="cb-sch-event__head">
        <span className="cb-sch-event__time">{eventLocalTimeRange(event)}</span>
        <span className="cb-sch-event__badges">
          {recurring ? (
            <span className="cb-sch-event__badge cb-sch-event__badge--repeat" title="Повторяется">
              <CabinetIcon name="calendar" />
            </span>
          ) : null}
          {isOnline ? (
            <span className="cb-sch-event__badge cb-sch-event__badge--online" title="Онлайн">
              <CabinetIcon name="video" />
            </span>
          ) : null}
        </span>
      </div>
      <span className="cb-sch-event__title">{displayTitle}</span>
      {!shortBlock && cardSubtitle ? (
        <span className="cb-sch-event__audience">
          {cardSubtitle}
          {isOnline ? " · онлайн" : ""}
        </span>
      ) : null}
      {!shortBlock && !cardSubtitle && isOnline ? (
        <span className="cb-sch-event__audience">онлайн</span>
      ) : null}
      {cancelled ? <span className="cb-sch-event__status">Отменено</span> : null}
    </>
  ) : (
    <>
      <span className="cb-sch-event__dot" style={{ background: accent }} aria-hidden="true" />
      <span className="cb-sch-event__pill-text">
        <span className="cb-sch-event__pill-time">{eventLocalStartTime(event)}</span>
        <span className="cb-sch-event__pill-title">{displayTitle}</span>
        {cardSubtitle ? (
          <span className="cb-sch-event__pill-audience">{cardSubtitle}</span>
        ) : null}
      </span>
    </>
  );

  const cardClass = [
    "cb-sch-event",
    compact ? "cb-sch-event--compact" : "",
    cancelled ? "cb-sch-event--cancelled" : "",
    canDrag ? "cb-sch-event--draggable" : "",
  ].filter(Boolean).join(" ");

  const handleClick = (e) => {
    e.stopPropagation();
    onClick(event);
  };

  const handleKeyDown = (e) => {
    if (e.key === "Enter" || e.key === " ") {
      e.preventDefault();
      onClick(event);
    }
  };

  if (canDrag) {
    const wrapClass = [
      compact ? "cb-sch-event-wrap cb-sch-event-wrap--compact" : "cb-sch-event-wrap",
      shortBlock ? "cb-sch-event-wrap--short" : "",
      dragging ? "cb-sch-event-wrap--dragging" : "",
      "cb-sch-event-wrap--draggable",
    ].filter(Boolean).join(" ");

    return (
      <div
        className={wrapClass}
        style={style}
        onPointerDown={(e) => onPointerDown?.(event.id, e)}
        onClick={handleClick}
        onKeyDown={handleKeyDown}
        role="button"
        tabIndex={0}
      >
        <div className={cardClass} style={{ borderLeftColor: accent }} aria-hidden="true">
          {content}
        </div>
      </div>
    );
  }

  return (
    <div
      role="button"
      tabIndex={0}
      className={`${cardClass}${dragging ? " cb-sch-event--dragging" : ""}`}
      style={cardStyle}
      onClick={handleClick}
      onKeyDown={handleKeyDown}
    >
      {content}
    </div>
  );
}

function TimeGridColumn({
  day,
  events,
  dndEnabled,
  draggingId,
  dropPreview,
  draggingEvent,
  nowTop,
  onEventClick,
  onPointerDown,
  onSlotClick,
}) {
  const hours = useMemo(
    () => Array.from({ length: HOUR_END - HOUR_START + 1 }, (_, i) => HOUR_START + i),
    [],
  );

  const dayKey = formatApiDate(day);
  const isDropTarget = dropPreview?.dayKey === dayKey;
  const showNow = isToday(day) && nowTop != null;
  const weekend = isWeekend(day);
  const todayCol = isToday(day);

  return (
    <div
      className={[
        "cb-sch-week__col",
        isDropTarget ? "cb-sch-week__col--drop" : "",
        todayCol ? "cb-sch-week__col--today" : "",
        weekend ? "cb-sch-week__col--weekend" : "",
      ].filter(Boolean).join(" ")}
      data-sch-day={dayKey}
    >
      {hours.map((h) => {
        const slotTime = `${String(h).padStart(2, "0")}:00`;
        return (
          <button
            key={h}
            type="button"
            className="cb-sch-week__slot"
            style={{ height: HOUR_HEIGHT }}
            onClick={() => onSlotClick?.(day, slotTime)}
            aria-label={`Создать урок ${dayKey} ${slotTime}`}
          />
        );
      })}
      {showNow ? (
        <div className="cb-sch-now-line" style={{ top: nowTop }} aria-hidden="true">
          <span className="cb-sch-now-line__dot" />
        </div>
      ) : null}
      {isDropTarget && dropPreview?.time ? (
        <div
          className="cb-sch-drop-preview"
          style={{
            top: timeToTop(dropPreview.time),
            height: draggingEvent
              ? eventHeight(eventLocalStartTime(draggingEvent), eventLocalEndTime(draggingEvent))
              : EVENT_MIN_HEIGHT,
          }}
          aria-hidden="true"
        />
      ) : null}
      {events.map((ev) => (
        <CalendarEventBlock
          key={ev.id}
          event={ev}
          canDrag={dndEnabled && !ev.readOnly}
          dragging={String(draggingId) === String(ev.id)}
          onClick={onEventClick}
          onPointerDown={onPointerDown}
          style={{
            top: timeToTop(eventLocalStartTime(ev)),
            height: eventHeight(eventLocalStartTime(ev), eventLocalEndTime(ev)),
          }}
        />
      ))}
    </div>
  );
}

function WeekGridEmptyState({ onAddLesson }) {
  return (
    <div className="cb-sch-week-empty" role="status">
      <h3 className="cb-sch-week-empty__title">На этой неделе занятий нет</h3>
      <p className="cb-sch-week-empty__text">Добавьте урок или выберите другой период.</p>
      <button type="button" className="cb-btn cb-btn--primary" onClick={onAddLesson}>
        Добавить урок
      </button>
    </div>
  );
}

function WeekGrid({
  focusDate,
  events,
  dndEnabled,
  draggingId,
  dropPreview,
  onEventClick,
  onPointerDown,
  onSlotClick,
  onAddLesson,
}) {
  const nowTop = useCurrentTimeTop();
  const draggingEvent = useMemo(
    () => (draggingId ? events.find((ev) => String(ev.id) === String(draggingId)) : null),
    [draggingId, events],
  );
  const weekDays = useMemo(() => {
    const start = startOfWeek(focusDate);
    return Array.from({ length: 7 }, (_, i) => addDays(start, i));
  }, [focusDate]);

  const hours = useMemo(
    () => Array.from({ length: HOUR_END - HOUR_START + 1 }, (_, i) => HOUR_START + i),
    [],
  );

  const eventsByDay = useMemo(() => {
    const map = new Map();
    weekDays.forEach((d) => map.set(d.toDateString(), []));
    events.forEach((ev) => {
      const key = eventDate(ev).toDateString();
      if (map.has(key)) map.get(key).push(ev);
    });
    return map;
  }, [events, weekDays]);

  const isEmpty = events.length === 0;

  return (
    <div className="cb-sch-week">
      <div className="cb-sch-week__head">
        <div className="cb-sch-week__head-gutter" />
        {weekDays.map((day) => (
          <div
            key={day.toISOString()}
            className={[
              "cb-sch-week__head-col",
              isToday(day) ? " cb-sch-week__head-col--today" : "",
              isWeekend(day) ? " cb-sch-week__head-col--weekend" : "",
            ].join("")}
          >
            <span className="cb-sch-week__head-wd">{WEEKDAYS_SHORT[(day.getDay() + 6) % 7]}</span>
            <span className={`cb-sch-week__head-num${isToday(day) ? " cb-sch-week__head-num--today" : ""}`}>
              {day.getDate()}
            </span>
          </div>
        ))}
      </div>
      <div className="cb-sch-week__body">
        <div className="cb-sch-week__times">
          {hours.map((h) => (
            <div key={h} className="cb-sch-week__time" style={{ height: HOUR_HEIGHT }}>
              {String(h).padStart(2, "0")}:00
            </div>
          ))}
        </div>
        <div className="cb-sch-week__cols">
          {weekDays.map((day) => {
            const dayEvents = eventsByDay.get(day.toDateString()) || [];
            return (
              <TimeGridColumn
                key={day.toISOString()}
                day={day}
                events={dayEvents}
                dndEnabled={dndEnabled}
                draggingId={draggingId}
                dropPreview={dropPreview}
                draggingEvent={draggingEvent}
                nowTop={nowTop}
                onEventClick={onEventClick}
                onPointerDown={onPointerDown}
                onSlotClick={onSlotClick}
              />
            );
          })}
        </div>
        {isEmpty ? <WeekGridEmptyState onAddLesson={onAddLesson} /> : null}
      </div>
    </div>
  );
}

function DayGrid({
  focusDate,
  events,
  dndEnabled,
  draggingId,
  dropPreview,
  onEventClick,
  onPointerDown,
  onSlotClick,
  onAddLesson,
}) {
  const nowTop = useCurrentTimeTop();
  const draggingEvent = useMemo(
    () => (draggingId ? events.find((ev) => String(ev.id) === String(draggingId)) : null),
    [draggingId, events],
  );
  const dayEvents = useMemo(
    () => events.filter((ev) => isSameDay(eventDate(ev), focusDate)),
    [events, focusDate],
  );

  return (
    <div className="cb-sch-day">
      <div className="cb-sch-day__head">{formatDayHeading(focusDate)}</div>
      <div className="cb-sch-week__body cb-sch-day__body">
        <div className="cb-sch-week__times">
          {Array.from({ length: HOUR_END - HOUR_START + 1 }, (_, i) => HOUR_START + i).map((h) => (
            <div key={h} className="cb-sch-week__time" style={{ height: HOUR_HEIGHT }}>
              {String(h).padStart(2, "0")}:00
            </div>
          ))}
        </div>
        <TimeGridColumn
          day={focusDate}
          events={dayEvents}
          dndEnabled={dndEnabled}
          draggingId={draggingId}
          dropPreview={dropPreview}
          draggingEvent={draggingEvent}
          nowTop={nowTop}
          onEventClick={onEventClick}
          onPointerDown={onPointerDown}
          onSlotClick={onSlotClick}
        />
        {dayEvents.length === 0 ? (
          <div className="cb-sch-week-empty cb-sch-week-empty--day" role="status">
            <h3 className="cb-sch-week-empty__title">На этот день занятий нет</h3>
            <p className="cb-sch-week-empty__text">Добавьте урок или выберите другую дату.</p>
            <button type="button" className="cb-btn cb-btn--primary" onClick={onAddLesson}>
              Добавить урок
            </button>
          </div>
        ) : null}
      </div>
    </div>
  );
}

function MonthGrid({
  focusDate,
  events,
  dndEnabled,
  draggingId,
  dropPreview,
  onEventClick,
  onDayClick,
  onPointerDown,
}) {
  const monthStart = useMemo(
    () => new Date(focusDate.getFullYear(), focusDate.getMonth(), 1),
    [focusDate],
  );

  const cells = useMemo(() => {
    const firstDow = (monthStart.getDay() + 6) % 7;
    const daysInMonth = new Date(focusDate.getFullYear(), focusDate.getMonth() + 1, 0).getDate();
    const result = [];
    for (let i = 0; i < firstDow; i += 1) result.push(null);
    for (let day = 1; day <= daysInMonth; day += 1) {
      result.push(new Date(focusDate.getFullYear(), focusDate.getMonth(), day));
    }
    while (result.length % 7 !== 0) result.push(null);
    return result;
  }, [focusDate, monthStart]);

  const eventsByDay = useMemo(() => {
    const map = new Map();
    events.forEach((ev) => {
      const key = eventDate(ev).toDateString();
      if (!map.has(key)) map.set(key, []);
      map.get(key).push(ev);
    });
    return map;
  }, [events]);

  return (
    <div className="cb-sch-month">
      <div className="cb-sch-month__head">
        {WEEKDAYS_SHORT.map((wd) => (
          <span key={wd} className="cb-sch-month__wd">{wd}</span>
        ))}
      </div>
      <div className="cb-sch-month__grid">
        {cells.map((date, i) => {
          if (!date) return <div key={`empty-${i}`} className="cb-sch-month__cell cb-sch-month__cell--empty" />;
          const dayEvents = eventsByDay.get(date.toDateString()) || [];
          const visible = dayEvents.slice(0, 3);
          const rest = dayEvents.length - visible.length;
          return (
            <div
              key={date.toISOString()}
              className={`cb-sch-month__cell${isToday(date) ? " cb-sch-month__cell--today" : ""}${dropPreview?.dayKey === formatApiDate(date) ? " cb-sch-month__cell--drop" : ""}`}
              data-sch-day={formatApiDate(date)}
            >
              <button
                type="button"
                className="cb-sch-month__cell-btn"
                onClick={() => onDayClick(date)}
              >
                <span className={`cb-sch-month__num${isToday(date) ? " cb-sch-month__num--today" : ""}`}>
                  {date.getDate()}
                </span>
              </button>
              <div className="cb-sch-month__events">
                {visible.map((ev) => (
                  <CalendarEventBlock
                    key={ev.id}
                    event={ev}
                    compact
                    canDrag={dndEnabled && !ev.readOnly}
                    dragging={String(draggingId) === String(ev.id)}
                    onClick={onEventClick}
                    onPointerDown={onPointerDown}
                  />
                ))}
                {rest > 0 ? <span className="cb-sch-month__more">+ ещё {rest}</span> : null}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

function ListView({ events, onOpen, onStart, onCreateLink, onAddLesson }) {
  const grouped = useMemo(() => {
    const map = new Map();
    events.forEach((ev) => {
      const d = eventDate(ev);
      const key = d.toDateString();
      if (!map.has(key)) map.set(key, { date: d, items: [] });
      map.get(key).items.push(ev);
    });
    return [...map.values()].sort((a, b) => a.date - b.date);
  }, [events]);

  if (grouped.length === 0) {
    return (
      <div className="cb-sch-empty cb-sch-empty--card">
        <CabinetIcon name="calendar" />
        <h3 className="cb-sch-empty__title">Занятий пока нет</h3>
        <p className="cb-sch-empty__text">Добавьте первый урок в расписание.</p>
        {onAddLesson ? (
          <button type="button" className="cb-btn cb-btn--primary" onClick={onAddLesson}>
            Добавить урок
          </button>
        ) : null}
      </div>
    );
  }

  return (
    <div className="cb-sch-list">
      {grouped.map(({ date, items }) => (
        <section key={date.toISOString()} className="cb-sch-list__group">
          <h2 className="cb-sch-list__day">{formatDayHeading(date)}</h2>
          <div className="cb-sch-list__items">
            {items.map((ev) => {
              const accent = eventAccentColor(ev);
              const hasLink = Boolean(
                (ev.link && (isTelemostMeetingUrl(ev.link) || isCabinetMeetingPath(ev.link)))
                || ev.videoMeeting?.uuid,
              );
              const canStart = ev.status === "planned" && ev.format === "Онлайн";
              const vmStatus = ev.videoMeeting?.status;
              let startLabel = "";
              if (vmStatus === "live") startLabel = "Войти в урок";
              else if (vmStatus === "finished") startLabel = "Аналитика";
              else if (vmStatus === "scheduled") startLabel = "Начать урок";
              else if (canStart && !hasLink) startLabel = "Создать ссылку";
              else if (hasLink) startLabel = "Начать урок";
              const studentName = (ev.audience || ev.title || "Занятие").trim();
              const typeLabel = EVENT_TYPES[ev.type]?.label || "Занятие";
              const duration = eventDurationMinutes(eventLocalStartTime(ev), eventLocalEndTime(ev));
              const showStatus = Boolean(ev.statusLabel) && ev.status !== "planned";
              const metaParts = [
                typeLabel,
                ev.format === "Онлайн" ? "онлайн" : (ev.format === "Офлайн" ? "офлайн" : null),
                duration > 0 ? `${duration} мин` : null,
              ].filter(Boolean);

              return (
                <article key={ev.id} className="cb-sch-list-card">
                  <div className="cb-sch-list-card__accent" style={{ background: accent }} aria-hidden="true" />
                  <div className="cb-sch-list-card__content">
                    <div className="cb-sch-list-card__row">
                      <span className="cb-sch-list-card__time">{eventLocalTimeRange(ev)}</span>
                      {showStatus ? (
                        <span className={`cb-sch-list-card__status cb-sch-list-card__status--${ev.status}`}>
                          {ev.statusLabel}
                        </span>
                      ) : null}
                    </div>
                    <h3 className="cb-sch-list-card__title">{studentName}</h3>
                    <p className="cb-sch-list-card__meta">
                      {metaParts.map((part, index) => (
                        <span key={`${ev.id}-meta-${part}`}>
                          {index > 0 ? <span className="cb-sch-list-card__dot" aria-hidden="true">·</span> : null}
                          {part}
                        </span>
                      ))}
                    </p>
                    {ev.topic ? <p className="cb-sch-list-card__topic">{ev.topic}</p> : null}
                    <div className="cb-sch-list-card__actions">
                      <button
                        type="button"
                        className="cb-btn cb-btn--outline cb-btn--sm cb-sch-list-card__open"
                        onClick={() => onOpen(ev)}
                      >
                        Открыть
                      </button>
                      {canStart && startLabel === "Создать ссылку" && onCreateLink ? (
                        <button type="button" className="cb-btn cb-btn--primary cb-btn--sm" onClick={() => onCreateLink(ev)}>
                          Создать ссылку
                        </button>
                      ) : null}
                      {canStart && onStart && startLabel && startLabel !== "Создать ссылку" ? (
                        <button type="button" className="cb-btn cb-btn--primary cb-btn--sm" onClick={() => { closeConnectionCheck(); onStart(ev); }}>
                          {startLabel}
                        </button>
                      ) : null}
                      {ev.format === "Онлайн" && ev.status === "planned" ? (
                        <ConnectionCheckButton
                          className="cb-btn cb-btn--outline cb-btn--sm"
                          canJoin={Boolean(onStart && startLabel && startLabel !== "Создать ссылку")}
                          onJoin={onStart && startLabel && startLabel !== "Создать ссылку" ? () => onStart(ev) : undefined}
                        />
                      ) : null}
                    </div>
                  </div>
                </article>
              );
            })}
          </div>
        </section>
      ))}
    </div>
  );
}

function ConfirmActionModal({ action, onClose, onConfirm, saving = false }) {
  const [planAction, setPlanAction] = useState("shift");
  if (!action) return null;

  const { type, event, targetDate, targetStartTime } = action;
  const recurring = isRecurring(event);
  const hasPlan = Boolean(event.hasPlan || event.planItem || event.studentId || event.groupId);
  const planTopic = event.planItem?.topic || event.planItem?.title || event.topic || "";

  const copy = {
    move: {
      title: "Перенести занятие",
      text: targetDate && targetStartTime
        ? `Перенести «${event.title}» на ${formatDayHeading(targetDate)}, ${targetStartTime}?`
        : `Перенести «${event.title}»?`,
      single: "Только это занятие",
      following: "Это и следующие",
      entire: "Всю серию",
      danger: false,
    },
    delete: {
      title: "Удалить занятие",
      text: `Удалить «${event.title}» (${formatEventWhen(event)})?`,
      single: "Только это занятие",
      following: "Это и следующие",
      entire: "Всю серию",
      danger: true,
    },
    cancel: {
      title: "Отменить занятие",
      text: `Отменить «${event.title}» (${formatEventWhen(event)})?`,
      single: "Только это занятие",
      following: "Это и следующие",
      entire: "Всю серию",
      danger: false,
    },
  }[type];

  const confirm = (scope) => {
    if (saving) return;
    if (type === "cancel" && hasPlan) {
      onConfirm(scope, { planCancelAction: planAction });
      return;
    }
    onConfirm(scope);
  };

  if (typeof document === "undefined") return null;

  return createPortal(
    <div className="cb-sch-overlay" onClick={saving ? undefined : onClose} role="presentation">
      <div
        className="cb-sch-confirm"
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-labelledby="sch-confirm-title"
        aria-busy={saving || undefined}
      >
        <button
          type="button"
          className="cb-sch-popover__close"
          onClick={onClose}
          aria-label="Закрыть"
          disabled={saving}
        >
          <CabinetIcon name="close" />
        </button>
        <h2 id="sch-confirm-title" className="cb-sch-confirm__title">{copy.title}</h2>
        <p className="cb-sch-confirm__text">{copy.text}</p>
        {saving ? (
          <p className="cb-sch-confirm__hint" role="status">Сохранение… Не закрывайте окно.</p>
        ) : null}
        {recurring ? (
          <p className="cb-sch-confirm__hint">Занятие входит в повторяющуюся серию ({event.recurrence === "weekly" ? "еженедельно" : "по расписанию"}).</p>
        ) : null}
        {type === "cancel" && hasPlan ? (
          <div className="cb-sch-confirm__plan">
            {planTopic ? (
              <p className="cb-sch-confirm__plan-topic">
                Тема занятия: <strong>{planTopic}</strong>
              </p>
            ) : null}
            <p className="cb-sch-confirm__plan-label">Что сделать с темой из плана?</p>
            <div className="cb-sch-confirm__plan-actions">
              <button
                type="button"
                className={`cb-sch-confirm__plan-btn${planAction === "shift" ? " cb-sch-confirm__plan-btn--active" : ""}`}
                onClick={() => setPlanAction("shift")}
                disabled={saving}
              >
                Перенести на следующее занятие
              </button>
              <button
                type="button"
                className={`cb-sch-confirm__plan-btn${planAction === "skip" ? " cb-sch-confirm__plan-btn--active" : ""}`}
                onClick={() => setPlanAction("skip")}
                disabled={saving}
              >
                Пропустить для ученика
              </button>
            </div>
          </div>
        ) : null}
        <div className="cb-sch-confirm__actions">
          <button
            type="button"
            className={`cb-btn cb-btn--sm${copy.danger ? " cb-btn--danger" : " cb-btn--primary"}`}
            onClick={() => confirm("single")}
            disabled={saving}
          >
            {saving ? "Сохранение…" : copy.single}
          </button>
          {recurring ? (
            <>
              <button
                type="button"
                className={`cb-btn cb-btn--sm${copy.danger ? " cb-btn--outline cb-btn--danger" : " cb-btn--outline"}`}
                onClick={() => confirm("following")}
                disabled={saving}
              >
                {saving ? "Сохранение…" : copy.following}
              </button>
              <button
                type="button"
                className={`cb-btn cb-btn--sm${copy.danger ? " cb-btn--outline cb-btn--danger" : " cb-btn--outline"}`}
                onClick={() => confirm("entire")}
                disabled={saving}
              >
                {saving ? "Сохранение…" : copy.entire}
              </button>
            </>
          ) : null}
          <button
            type="button"
            className="cb-btn cb-btn--ghost cb-btn--sm"
            onClick={onClose}
            disabled={saving}
          >
            Не менять
          </button>
        </div>
      </div>
    </div>,
    document.body
  );
}

function displayEventTitle(title) {
  const value = (title || "").trim();
  return value || "Урок без названия";
}

function displayEventField(value, fallback) {
  const text = (value || "").trim();
  return text || fallback;
}

function formatEventParticipants(event) {
  const list = Array.isArray(event.participants) ? event.participants : [];
  const names = list
    .filter((p) => p.role !== "organizer")
    .map((p) => p.name)
    .filter(Boolean);
  if (names.length) return names.join(", ");
  return displayEventField(event.audience, "");
}

function getEventPlanItem(event) {
  if (event.planItem) return event.planItem;
  const items = Array.isArray(event.planItems) ? event.planItems : [];
  return items[0] || null;
}

function getEventPlanTopics(event) {
  return resolveLessonTopic(event);
}

function getEventPlanMaterials(event) {
  const item = getEventPlanItem(event);
  const rows = [
    ...planItemLessonPopoverRows(item),
    ...planItemTaskPopoverRows(item),
  ];
  if (rows.length) return rows;
  const legacy = displayEventField(event.materials, "");
  return legacy ? [{ key: "legacy", kind: "notes", label: "Материалы", text: legacy }] : [];
}

function getEventPlanHomework(event) {
  // Показываем выданное ДЗ, а не черновик материалов в пункте плана.
  return eventAssignedHomeworkRows(event);
}

function hasText(value) {
  return Boolean(typeof value === "string" ? value.trim() : value);
}

function formatEventDateShort(eventOrDate) {
  let d;
  if (eventOrDate instanceof Date) {
    d = startOfDay(eventOrDate);
  } else if (eventOrDate && typeof eventOrDate === "object" && ("startsAt" in eventOrDate || "dayOffset" in eventOrDate)) {
    d = eventDate(eventOrDate);
  } else if (eventOrDate) {
    d = startOfDay(new Date(`${eventOrDate}T12:00:00`));
  } else {
    d = startOfDay(new Date());
  }
  if (Number.isNaN(d.getTime())) return "";

  const today = startOfDay(new Date());
  const diff = Math.round((d - today) / 86400000);
  if (diff === 0) return "Сегодня";
  if (diff === 1) return "Завтра";
  return `${d.getDate()} ${MONTHS[d.getMonth()]}`;
}

function shortenMeetingUrl(url) {
  if (!url) return "";
  try {
    const u = new URL(url);
    const host = u.hostname.replace(/^www\./, "");
    const path = u.pathname || "";
    if (path.length > 14) {
      return `${host}${path.slice(0, 10)}…`;
    }
    return `${host}${path}`;
  } catch {
    return url.length > 30 ? `${url.slice(0, 30)}…` : url;
  }
}

function eventStatusMeta(event) {
  if (event.status === "cancelled") return { label: "Отменено", mod: "cancelled" };
  if (event.status === "done" || event.status === "completed") return { label: "Проведено", mod: "done" };
  if (event.status === "moved") return { label: "Перенесено", mod: "moved" };
  return null;
}

function eventSuggestContext(event) {
  const topic = String(event?.topic || "").trim();
  const subjectLabel = String(event?.studentSubjectLabel || "").trim();
  return {
    topic,
    subjectLabel,
    query: [subjectLabel, topic].filter(Boolean).join(" "),
  };
}

function EventDetailPopover(props) {
  const { event } = props;
  const typeInfo = EVENT_TYPES[event.type];
  const statusMeta = eventStatusMeta(event);
  const planItem = getEventPlanItem(event);
  const materials = getEventPlanMaterials(event);
  const homework = getEventPlanHomework(event);
  const topic = resolveLessonTopic(event);
  const notesAbout = Boolean(
    hasText(planItem?.goal)
    || hasText(event.goal)
    || hasText(planItem?.teacherComment)
    || hasText(event.teacherComment),
  );

  return (
    <EventDetailCard
      {...props}
      typeLabel={typeInfo?.label || "Занятие"}
      accentColor={eventAccentColor(event)}
      profileName={displayEventTitle(eventDisplayTitle(event))}
      dateLabel={formatEventDateShort(event)}
      timeRange={eventLocalTimeRange(event)}
      statusMeta={statusMeta}
      recurring={isRecurring(event)}
      isOnline={event.format === "Онлайн"}
      isCancelled={event.status === "cancelled"}
      isDone={event.status === "done" || event.status === "completed"}
      canStart={event.status === "planned" && event.format === "Онлайн"}
      hasLink={Boolean(
        event.videoMeeting?.uuid
        || (event.link && (isTelemostMeetingUrl(event.link) || isCabinetMeetingPath(event.link))),
      )}
      canEditLink={!event.readOnly && event.format === "Онлайн"}
      materials={materials}
      homework={homework}
      planItem={planItem}
      hasAbout={notesAbout}
      topic={topic}
      subjectLabel={resolveLessonSubjectLabel(event)}
      courseTitle={resolveLessonCourseTitle(event)}
      description={resolveLessonDescription(event)}
      participants={Array.isArray(event.participants) ? event.participants : []}
      participantsFallback={formatEventParticipants(event) || "—"}
      shortenMeetingUrl={shortenMeetingUrl}
    />
  );
}

function useMobileDefaultView() {
  const [isMobile, setIsMobile] = useState(() =>
    typeof window !== "undefined" && window.matchMedia("(max-width: 900px)").matches,
  );

  useEffect(() => {
    const mq = window.matchMedia("(max-width: 900px)");
    const handler = (e) => setIsMobile(e.matches);
    mq.addEventListener("change", handler);
    return () => mq.removeEventListener("change", handler);
  }, []);

  return isMobile;
}

export default function CabinetSchedulePage() {
  usePageTitle("Календарь");
  const navigate = useNavigate();
  const location = useLocation();
  const isMobile = useMobileDefaultView();
  const justDraggedRef = useRef(false);
  const [events, setEvents] = useState([]);
  const [calendarLoading, setCalendarLoading] = useState(true);
  const [calendarError, setCalendarError] = useState("");
  const [calendarAuthorizeUrl, setCalendarAuthorizeUrl] = useState("");
  const [calendarAccountEmail, setCalendarAccountEmail] = useState("");
  const [calendarSource, setCalendarSource] = useState("local");
  const [yandexCalendarEnabled, setYandexCalendarEnabled] = useState(false);
  const [yandexEmbedEnabled, setYandexEmbedEnabled] = useState(false);
  const [yandexLayerIds, setYandexLayerIds] = useState("");
  const [yandexTzId, setYandexTzId] = useState("Europe/Moscow");
  const [view, setView] = useState(() => (typeof window !== "undefined" && window.matchMedia("(max-width: 900px)").matches ? "list" : "week"));
  const [focusDate, setFocusDate] = useState(() => startOfDay(new Date()));
  const [selectedDate, setSelectedDate] = useState(() => startOfDay(new Date()));
  const [sidebarOpen, setSidebarOpen] = useState(() =>
    typeof window !== "undefined" && !window.matchMedia("(max-width: 900px)").matches,
  );
  const [calendars, setCalendars] = useState({
    all: true,
    yandex: true,
  });
  const [selectedEvent, setSelectedEvent] = useState(null);
  const [prepareMaterialsPrompt, setPrepareMaterialsPrompt] = useState(false);
  const [createOpen, setCreateOpen] = useState(false);
  const [createDraft, setCreateDraft] = useState(null);
  const [editEvent, setEditEvent] = useState(null);
  const [lessonDetail, setLessonDetail] = useState(null);
  const [startingId, setStartingId] = useState(null);
  const [creatingLinkId, setCreatingLinkId] = useState(null);
  const [savingLinkId, setSavingLinkId] = useState(null);
  const [statusMessage, setStatusMessage] = useState("");
  const [dropPreview, setDropPreview] = useState(null);
  const [pendingAction, setPendingAction] = useState(null);
  const [actionSaving, setActionSaving] = useState(false);
  const actionSavingRef = useRef(false);
  const [homeworkAssignModal, setHomeworkAssignModal] = useState(null);
  const [lessonResourcePicker, setLessonResourcePicker] = useState(null);
  // { eventId, planItemId, initialTab, attachedMaterialIds, attachedInteractiveIds }
  const [lessonResourceBusy, setLessonResourceBusy] = useState(false);
  const [finalizeBillingEvent, setFinalizeBillingEvent] = useState(null);
  const [finalizeBillingMode, setFinalizeBillingMode] = useState("conducted");
  const [paymentModalOpen, setPaymentModalOpen] = useState(false);
  const [paymentForStudentId, setPaymentForStudentId] = useState(null);
  const [paymentEventBillingIds, setPaymentEventBillingIds] = useState(null);
  const [paymentDefaultAmount, setPaymentDefaultAmount] = useState(null);
  const [paymentEventId, setPaymentEventId] = useState(null);
  const [billingBadges, setBillingBadges] = useState([]);
  const [paymentStudents, setPaymentStudents] = useState([]);

  const refreshBillingBadges = useCallback((eventLike) => {
    const eventPk = scheduleEventNumericId(eventLike?.id ?? eventLike);
    if (!eventPk) return;
    fetchEventBillingBadge(eventPk)
      .then((data) => setBillingBadges(data?.badges || []))
      .catch(() => {});
  }, []);

  const openBillingPrompt = useCallback((event, mode = "conducted") => {
    const pk = scheduleEventNumericId(event?.id ?? event);
    if (!pk) return;
    setFinalizeBillingMode(mode);
    setFinalizeBillingEvent(typeof event === "object" ? { ...event, id: pk } : { id: pk });
  }, []);

  const openLessonPayment = useCallback((studentId, eventBillingIds, amount, eventId = null) => {
    setPaymentForStudentId(studentId || null);
    setPaymentEventBillingIds(eventBillingIds || null);
    setPaymentDefaultAmount(amount != null ? amount : null);
    setPaymentEventId(eventId ? scheduleEventNumericId(eventId) : null);
    setPaymentModalOpen(true);
    fetchStudents({ status: "active" })
      .then((raw) => setPaymentStudents(
        normalizeCabinetList(raw).map((s) => ({
          id: s.id,
          name: s.full_name || `${s.first_name || ""} ${s.last_name || ""}`.trim(),
        })),
      ))
      .catch(() => {});
  }, []);

  useEffect(() => {
    const eventPk = scheduleEventNumericId(selectedEvent?.id);
    if (!eventPk) {
      setBillingBadges([]);
      return undefined;
    }
    let cancelled = false;
    fetchEventBillingBadge(eventPk)
      .then((data) => {
        if (!cancelled) setBillingBadges(data?.badges || []);
      })
      .catch(() => {
        if (!cancelled) setBillingBadges([]);
      });
    return () => { cancelled = true; };
  }, [selectedEvent?.id]);
  const { showToast, toast } = useSoonToast();
  const { prepareCall, openCall, abortCall } = useCabinetCall();

  const resolveEventAssignTarget = useCallback(async (event) => {
    const studentNameFromParticipants = () => {
      const list = Array.isArray(event.participants) ? event.participants : [];
      const student = list.find((p) => p.role === "student");
      return student?.name || event.audience || "Ученик";
    };

    if (event.groupId) {
      const group = await fetchGroup(event.groupId);
      const students = normalizeCabinetList(group?.students).map(mapApiStudent);
      return {
        group: { id: group.id, name: group.title || event.audience || "Группа" },
        students,
      };
    }

    const studentId = event.studentId
      || (Array.isArray(event.participantStudentIds) ? event.participantStudentIds[0] : null);
    if (!studentId) {
      return null;
    }

    const students = normalizeCabinetList(await fetchStudents()).map(mapApiStudent);
    const student = students.find((s) => Number(s.id) === Number(studentId));
    if (student) {
      return { student };
    }
    return {
      student: { id: studentId, name: studentNameFromParticipants() },
    };
  }, []);

  const patchEventPlanItem = useCallback((eventId, planItem) => {
    if (!eventId || !planItem) return;
    setEvents((prev) => prev.map((ev) => (
      ev.id === eventId ? { ...ev, planItem } : ev
    )));
    setSelectedEvent((prev) => (
      prev && prev.id === eventId ? { ...prev, planItem } : prev
    ));
  }, []);

  const handleAddMaterials = useCallback(async (event) => {
    const eventPk = scheduleEventNumericId(event?.id);
    if (!eventPk) {
      showToast("Не удалось определить занятие");
      return;
    }
    try {
      // Всегда ensure: planItem из списка может быть слотом enrollment («вне плана»),
      // в него нельзя писать материалы — иначе они появятся в настоящем плане.
      const data = await ensureScheduleEventPlanItem(eventPk);
      const planItem = data?.planItem || null;
      if (planItem) patchEventPlanItem(event.id, planItem);
      if (!planItem?.id) {
        showToast("Не удалось подготовить урок для материалов");
        return;
      }
      setLessonResourcePicker({
        eventId: event.id,
        planItemId: planItem.id,
        initialTab: "library",
        attachedMaterialIds: (planItem.materials || []).map((m) => m.id).filter(Boolean),
        attachedInteractiveIds: (planItem.attachedInteractives || []).map((i) => i.id).filter(Boolean),
        suggestContext: eventSuggestContext(event),
      });
    } catch (err) {
      showToast(err.message || "Не удалось открыть добавление материалов");
    }
  }, [patchEventPlanItem, showToast]);

  const handleAttachLessonMaterial = useCallback(async (material) => {
    if (!lessonResourcePicker?.planItemId || !material?.id) return;
    setLessonResourceBusy(true);
    try {
      const current = [...(lessonResourcePicker.attachedMaterialIds || [])];
      if (!current.includes(material.id)) current.push(material.id);
      const data = await updateLessonPlanItem(lessonResourcePicker.planItemId, {
        material_ids: current,
      });
      // Дублирующую связь на событии создаём через event-materials (unique по source+material).
      if (lessonResourcePicker.eventId) {
        try {
          await updateScheduleEventMaterials(lessonResourcePicker.eventId, {
            action: "attach",
            material_id: material.id,
            source: "learning_plan",
          });
        } catch {
          /* связь могла уже существовать после sync_plan_item_to_lessons */
        }
      }
      const mapped = planItemForScheduleEvent(data, {
        lessonNumber: getEventPlanItem(selectedEvent)?.lessonNumber,
        planTitle: getEventPlanItem(selectedEvent)?.planTitle,
      });
      patchEventPlanItem(lessonResourcePicker.eventId, mapped);
      setLessonResourcePicker(null);
      showToast("Материал добавлен к уроку");
    } catch (err) {
      showToast(err.message || "Не удалось добавить материал");
      throw err;
    } finally {
      setLessonResourceBusy(false);
    }
  }, [lessonResourcePicker, patchEventPlanItem, selectedEvent, showToast]);

  const handleAttachLessonInteractive = useCallback(async (interactive) => {
    if (!lessonResourcePicker?.planItemId || !interactive?.id) return;
    setLessonResourceBusy(true);
    try {
      const current = [...(lessonResourcePicker.attachedInteractiveIds || [])];
      if (!current.includes(interactive.id)) current.push(interactive.id);
      const data = await updateLessonPlanItem(lessonResourcePicker.planItemId, {
        interactive_ids: current,
      });
      if (lessonResourcePicker.eventId) {
        try {
          await updateScheduleEventMaterials(lessonResourcePicker.eventId, {
            action: "attach",
            interactive_id: interactive.id,
            source: "learning_plan",
          });
        } catch {
          /* already synced */
        }
      }
      const mapped = planItemForScheduleEvent(data, {
        lessonNumber: getEventPlanItem(selectedEvent)?.lessonNumber,
        planTitle: getEventPlanItem(selectedEvent)?.planTitle,
      });
      patchEventPlanItem(lessonResourcePicker.eventId, mapped);
      setLessonResourcePicker(null);
      showToast("Интерактив добавлен к уроку");
    } catch (err) {
      showToast(err.message || "Не удалось добавить интерактив");
      throw err;
    } finally {
      setLessonResourceBusy(false);
    }
  }, [lessonResourcePicker, patchEventPlanItem, selectedEvent, showToast]);

  const handleRemoveLessonMaterial = useCallback(async (row) => {
    const event = selectedEvent;
    if (!event?.id || !row) return;
    const planItem = getEventPlanItem(event);
    if (!planItem?.id) {
      showToast("Урок не связан с пунктом плана");
      return;
    }
    setLessonResourceBusy(true);
    try {
      if (row.materialId) {
        const nextIds = (planItem.materials || [])
          .map((m) => m.id)
          .filter((id) => Number(id) !== Number(row.materialId));
        const data = await updateLessonPlanItem(planItem.id, { material_ids: nextIds });
        await updateScheduleEventMaterials(event.id, {
          action: "detach",
          material_id: row.materialId,
        });
        const mapped = planItemForScheduleEvent(data, {
          lessonNumber: planItem.lessonNumber,
          planTitle: planItem.planTitle,
        });
        patchEventPlanItem(event.id, mapped);
      } else if (row.interactiveId) {
        const nextIds = (planItem.attachedInteractives || [])
          .map((i) => i.id)
          .filter((id) => Number(id) !== Number(row.interactiveId));
        const data = await updateLessonPlanItem(planItem.id, { interactive_ids: nextIds });
        await updateScheduleEventMaterials(event.id, {
          action: "detach",
          interactive_id: row.interactiveId,
        });
        const mapped = planItemForScheduleEvent(data, {
          lessonNumber: planItem.lessonNumber,
          planTitle: planItem.planTitle,
        });
        patchEventPlanItem(event.id, mapped);
      } else {
        showToast("Не удалось определить материал");
        return;
      }
      showToast("Материал убран из урока");
    } catch (err) {
      showToast(err.message || "Не удалось убрать материал");
    } finally {
      setLessonResourceBusy(false);
    }
  }, [patchEventPlanItem, selectedEvent, showToast]);

  const handleAddHomework = useCallback(async (event) => {
    try {
      const target = await resolveEventAssignTarget(event);
      if (!target?.student && !target?.group) {
        showToast("Сначала укажите ученика или группу в уроке");
        return;
      }
      if (target.group && !(target.students || []).length) {
        showToast("В группе пока нет учеников");
        return;
      }
      const eventPk = scheduleEventNumericId(event?.id);
      const subjectId = event?.studentSubjectId || event?.student_subject_id || null;
      setSelectedEvent(null);
      setHomeworkAssignModal({
        ...target,
        scheduleEventId: eventPk || null,
        studentSubjectId: subjectId ? Number(subjectId) : null,
      });
    } catch (err) {
      showToast(err.message || "Не удалось открыть выдачу ДЗ");
    }
  }, [resolveEventAssignTarget, showToast]);

  const handleOpenLesson = useCallback((event, focusMaterials = false) => {
    const item = getEventPlanItem(event);
    if (!item?.id) {
      // Урок без пункта плана — открываем выдачу материалов ученику/группе.
      void handleAddMaterials(event);
      return;
    }
    setLessonDetail({
      itemId: item.id,
      initialItem: scheduleEventPlanItemToModalItem(item, event),
      focusMaterials,
    });
    setSelectedEvent(null);
  }, [handleAddMaterials]);

  useEffect(() => {
    if (isMobile && (view === "week" || view === "month")) setView("list");
  }, [isMobile, view]);

  useEffect(() => {
    let cancelled = false;

    fetchCalendarStatus()
      .then((data) => {
        if (!cancelled && data?.authorize_url) {
          setCalendarAuthorizeUrl(data.authorize_url);
        }
        if (!cancelled && data?.account_email) {
          setCalendarAccountEmail(data.account_email);
        }
        if (!cancelled) {
          setYandexCalendarEnabled(Boolean(data?.yandex_enabled));
          setCalendarSource(data?.calendar_source === "yandex" ? "yandex" : "local");
          setYandexEmbedEnabled(Boolean(data?.enabled));
          setYandexLayerIds(data?.layer_ids || "");
          setYandexTzId(data?.tz_id || "Europe/Moscow");
        }
      })
      .catch(() => {});

    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (yandexEmbedEnabled) {
      setCalendarLoading(false);
      return undefined;
    }

    let cancelled = false;
    const range = getCalendarFetchRange(view, focusDate);
    const useYandex = calendarSource === "yandex";
    const fetchEvents = useYandex ? fetchCalendarEvents : fetchScheduleEvents;

    setCalendarLoading(true);
    setCalendarError("");

    fetchEvents(range)
      .then((data) => {
        if (cancelled) return;
        setEvents(Array.isArray(data?.events) ? data.events : []);
      })
      .catch((err) => {
        if (cancelled) return;
        setEvents([]);
        setCalendarError(
          err.message || (useYandex
            ? "Не удалось загрузить Яндекс Календарь."
            : "Не удалось загрузить расписание."),
        );
      })
      .finally(() => {
        if (!cancelled) setCalendarLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [view, focusDate, yandexEmbedEnabled, calendarSource]);

  // Deep-link /cabinet/schedule?finalize=<eventId>
  useEffect(() => {
    const params = new URLSearchParams(location.search || "");
    const finalizeId = params.get("finalize");
    if (!finalizeId) return;
    const pk = scheduleEventNumericId(finalizeId);
    if (!pk) return;
    openBillingPrompt({ id: pk }, "conducted");
    params.delete("finalize");
    const next = params.toString();
    navigate(`${location.pathname}${next ? `?${next}` : ""}`, { replace: true, state: location.state || {} });
  }, [location.search, location.pathname, location.state, navigate, openBillingPrompt]);

  // Deep-link /cabinet/schedule?event=<eventId> — из уведомлений и onboarding
  useEffect(() => {
    if (calendarLoading) return;
    const params = new URLSearchParams(location.search || "");
    const eventParam = params.get("event");
    if (!eventParam) return;
    const found = events.find((ev) => {
      const numeric = scheduleEventNumericId(ev.id);
      return String(ev.id) === String(eventParam) || String(numeric) === String(eventParam);
    });
    if (!found) return;
    setSelectedEvent(found);
    if (params.get("prepare") === "1") setPrepareMaterialsPrompt(true);
    params.delete("event");
    params.delete("prepare");
    const next = params.toString();
    navigate(`${location.pathname}${next ? `?${next}` : ""}`, { replace: true, state: location.state || {} });
  }, [events, calendarLoading, location.search, location.pathname, location.state, navigate]);

  useEffect(() => {
    const openEventId = location.state?.openEventId;
    if (openEventId == null || calendarLoading) return;
    const found = events.find((ev) => String(ev.id) === String(openEventId));
    if (!found) return;
    setSelectedEvent(found);
    navigate(`${location.pathname}${location.search}`, { replace: true, state: {} });
  }, [events, calendarLoading, location.state, location.pathname, location.search, navigate]);

  useEffect(() => {
    const groupId = location.state?.createWithGroupId;
    const studentId = location.state?.createWithStudentId;
    if (groupId == null && studentId == null) return;
    setCreateDraft({
      groupId,
      studentId,
      type: location.state?.createWithType
        || (groupId != null ? "group_lesson" : "individual_lesson"),
      dialogTitle: "Запланировать занятие",
    });
    setCreateOpen(true);
    navigate(`${location.pathname}${location.search}`, { replace: true, state: {} });
  }, [location.state, location.pathname, location.search, navigate]);

  useEffect(() => {
    const params = new URLSearchParams(location.search || "");
    if (params.get("create") !== "1") return;
    trackActivationIntent("lesson_creation_started", { source: "schedule_query" });
    const studentId = params.get("student");
    setCreateDraft({
      studentId: studentId || undefined,
      type: "individual_lesson",
      dialogTitle: "Запланировать занятие",
    });
    setCreateOpen(true);
    params.delete("create");
    params.delete("student");
    const next = params.toString();
    navigate(`${location.pathname}${next ? `?${next}` : ""}`, { replace: true, state: location.state || {} });
  }, [location.search, location.pathname, location.state, navigate]);

  const showStatus = useCallback((message) => {
    setStatusMessage(message);
    window.setTimeout(() => setStatusMessage(""), 4000);
  }, []);

  const applyMeetingToEventState = useCallback((eventId, videoMeeting) => {
    if (!videoMeeting) return;
    setEvents((prev) => prev.map((ev) => (
      ev.id === eventId
        ? {
          ...ev,
          videoMeeting,
          link: videoMeeting.pageUrl || videoMeeting.joinUrl || ev.link,
          meetingProvider: "jitsi",
        }
        : ev
    )));
    setSelectedEvent((prev) => (
      prev?.id === eventId
        ? {
          ...prev,
          videoMeeting,
          link: videoMeeting.pageUrl || videoMeeting.joinUrl || prev.link,
          meetingProvider: "jitsi",
        }
        : prev
    ));
  }, []);

  const handleCreateMeetingLink = useCallback(async (event) => {
    if (!isLocalEvent(event)) return;
    setCreatingLinkId(event.id);
    try {
      if (event.videoMeeting?.uuid) {
        showStatus("Ссылка уже создана");
        return;
      }
      const eventPk = scheduleEventNumericId(event.id);
      if (!eventPk) {
        throw new Error("Не удалось определить урок для видеокомнаты");
      }
      const data = await ensureVideoMeetingForEvent(eventPk);
      const videoMeeting = data?.videoMeeting || data?.meeting;
      if (!videoMeeting?.uuid) {
        throw new Error("Не удалось создать видеокомнату");
      }
      applyMeetingToEventState(event.id, {
        ...videoMeeting,
        pageUrl: videoMeeting.pageUrl || videoMeeting.joinUrl,
        status: videoMeeting.status || "scheduled",
      });
      showStatus(data?.created === false ? "Ссылка уже создана" : "Ссылка создана");
    } catch (err) {
      showStatus(err.message || "Не удалось создать ссылку");
    } finally {
      setCreatingLinkId(null);
    }
  }, [applyMeetingToEventState, showStatus]);

  const handleStartLesson = useCallback(async (event) => {
    setStartingId(event.id);

    // Встроенный Jitsi — приоритетный путь для онлайн-уроков без ссылки Телемост.
    const preferJitsi =
      hasJitsiMeeting(event)
      || isCabinetMeetingPath(event.link)
      || (event.format === "Онлайн" && !isTelemostMeetingUrl(event.link || ""));

    if (preferJitsi && isLocalEvent(event)) {
      try {
        let meetingUuid = event.videoMeeting?.uuid;
        if (!meetingUuid && isCabinetMeetingPath(event.link)) {
          meetingUuid = cabinetMeetingPathFromHref(event.link).split("/cabinet/meetings/")[1];
        }
        // Создание комнаты — только через «Создать ссылку»; здесь открываем существующую.
        if (!meetingUuid) {
          throw new Error("Сначала создайте ссылку на онлайн-урок");
        }
        const vmStatus = event.videoMeeting?.status;
        showStatus(
          vmStatus === "live"
            ? "Вход в комнату…"
            : vmStatus === "finished"
              ? "Открываем аналитику…"
              : "Открываем страницу урока…",
        );
        navigate(`/cabinet/meetings/${meetingUuid}`);
      } catch (err) {
        showStatus(err.message || "Не удалось открыть видеокомнату Jitsi");
      } finally {
        setStartingId(null);
      }
      return;
    }

    const popup = prepareCall({
      title: event.title,
      subtitle: event.topic,
    });
    if (!popup) {
      showStatus("Разрешите всплывающие окна для сайта — иначе откроется новая вкладка.");
      setStartingId(null);
      return;
    }

    if (event.link && isTelemostMeetingUrl(event.link)) {
      const opened = openCall({
        url: event.link,
        title: event.title,
        subtitle: event.topic,
        shareUrl: event.link,
      });
      if (!opened) {
        abortCall();
        showStatus("Не удалось открыть окно Телемоста.");
      } else {
        showStatus("Телемост открыт.");
      }
      setStartingId(null);
      return;
    }

    try {
      const data = await startTelemostLesson({
        title: event.title,
        topic: event.topic,
        event_id: event.id,
      });
      if (data?.join_url && isTelemostMeetingUrl(data.join_url)) {
        const opened = openCall({
          url: data.join_url,
          title: event.title,
          subtitle: event.topic,
          shareUrl: data.share_url || data.join_url,
        });
        if (!opened) {
          abortCall();
          showStatus("Не удалось открыть окно Телемоста.");
          return;
        }
        showStatus(data.message || "Телемост открыт.");
        setEvents((prev) => prev.map((ev) => (
          ev.id === event.id ? { ...ev, link: data.join_url } : ev
        )));
        setSelectedEvent((prev) => (
          prev?.id === event.id ? { ...prev, link: data.join_url } : prev
        ));
      } else {
        abortCall();
        showStatus("Не удалось получить ссылку на встречу. Вставьте ссылку Телемост в урок вручную.");
      }
    } catch (err) {
      abortCall();
      showStatus(
        err.message
        || "Не удалось создать встречу. Вставьте ссылку telemost.yandex.ru/j/… в карточку урока.",
      );
    } finally {
      setStartingId(null);
    }
  }, [showStatus, prepareCall, openCall, abortCall, navigate]);

  const handleSaveTelemostLink = useCallback(async (event, link) => {
    if (link && !isTelemostMeetingUrl(link)) {
      showStatus("Укажите ссылку вида https://telemost.yandex.ru/j/…");
      return;
    }
    setSavingLinkId(event.id);
    try {
      const data = await updateScheduleEvent(event.id, { telemost_url: link });
      const updated = data?.event;
      if (updated) {
        setEvents((prev) => prev.map((ev) => (ev.id === event.id ? { ...ev, ...updated } : ev)));
        setSelectedEvent((prev) => (prev?.id === event.id ? { ...prev, ...updated } : prev));
      }
      showStatus(link ? "Ссылка на Телемост сохранена." : "Ссылка удалена.");
    } catch (err) {
      showStatus(err.message || "Не удалось сохранить ссылку.");
    } finally {
      setSavingLinkId(null);
    }
  }, [showStatus]);

  const handleEditSave = useCallback(async (payload) => {
    if (!editEvent) return;
    const scope = parseScheduleScope(payload.scope);
    const data = await updateScheduleEvent(editEvent.id, payload);
    if (scope === "series" || scope === "following") {
      const range = getSeriesRefreshRange(focusDate);
      const refreshed = await fetchScheduleEvents(range);
      if (refreshed?.events) {
        setEvents(refreshed.events);
      } else if (payload.starts_at && payload.ends_at) {
        setEvents((prev) => applySeriesTimeUpdate(prev, editEvent, {
          startTime: payload.starts_at.split("T")[1],
          endTime: payload.ends_at.split("T")[1],
          scope,
          anchorDate: payload.starts_at.slice(0, 10),
        }));
      }
    } else if (data?.event) {
      setEvents((prev) => prev.map((ev) => (ev.id === editEvent.id ? data.event : ev)));
    }
    setSelectedEvent(null);
    setEditEvent(null);
    showStatus(
      scope === "series"
        ? "Время обновлено для всей серии."
        : scope === "following"
          ? "Время обновлено для этой и следующих занятий."
          : "Изменения сохранены.",
    );
  }, [editEvent, showStatus, focusDate]);

  const handleCreateLesson = useCallback(async (payload) => {
    const data = await createScheduleEvent(payload);
    if (data?.events_created && data.events_created > 1) {
      const range = getCalendarFetchRange(view, focusDate);
      const refreshed = await fetchScheduleEvents(range);
      if (refreshed?.events) setEvents(refreshed.events);
    } else if (data?.event) {
      setEvents((prev) => [...prev, data.event].sort((a, b) => {
        const aTime = a.startsAt || a.startTime;
        const bTime = b.startsAt || b.startTime;
        return String(aTime).localeCompare(String(bTime));
      }));
    }
    setCreateOpen(false);
    setCreateDraft(null);
    if (data?.event) {
      setSelectedEvent(data.event);
      setPrepareMaterialsPrompt(true);
    }
    const hasMeetingLink = Boolean(
      data?.event?.link || data?.event?.videoMeeting?.uuid || payload.jitsi_auto_create,
    );
    if (data?.event) {
      showStatus(
        hasMeetingLink
          ? "Занятие создано. Подготовьте материалы — или начните урок без них."
          : "Занятие создано. Можно сразу подготовить материалы.",
      );
      return;
    }
    if (payload.format === "online" && hasMeetingLink) {
      showStatus(data?.events_created > 1
        ? `Создано занятий: ${data.events_created}. Видеокомнаты готовы.`
        : "Урок создан, ссылка на звонок готова.");
    } else {
      showStatus(data?.events_created > 1
        ? `Создано занятий: ${data.events_created}`
        : "Урок добавлен в расписание.");
    }
  }, [showStatus, view, focusDate]);

  const filteredEvents = useMemo(
    () => events.filter((ev) => ev.status !== "cancelled" && matchesFilters(ev, calendars)),
    [events, calendars],
  );

  const openCreateLesson = useCallback((draft = {}) => {
    setCreateDraft(draft);
    setCreateOpen(true);
  }, []);

  const handleDuplicateLesson = useCallback((event) => {
    if (!event || event.readOnly) return;
    const lessonType = (
      event.type === "individual"
      || event.type === "individual_lesson"
    ) ? "individual_lesson" : "group_lesson";
    const studentId = event.studentId
      || (Array.isArray(event.participantStudentIds) ? event.participantStudentIds[0] : null);
    setSelectedEvent(null);
    openCreateLesson({
      date: formatApiDate(eventDate(event)),
      startTime: event.startTime,
      endTime: event.endTime,
      lessonTitle: event.title || "",
      topic: event.topic || "",
      type: lessonType,
      format: event.format === "Офлайн" || event.format === "offline" ? "offline" : "online",
      groupId: event.groupId || "",
      studentId: studentId || "",
      studentIds: Array.isArray(event.participantStudentIds) ? event.participantStudentIds : [],
      dialogTitle: "Дублировать урок",
    });
  }, [openCreateLesson]);

  const handleSlotClick = useCallback((day, startTime) => {
    const endTime = addMinutesToTime(startTime, 45);
    const startInFormTz = localClockToTimeZone(day, startTime, "Europe/Moscow");
    const endInFormTz = localClockToTimeZone(day, endTime, "Europe/Moscow");
    openCreateLesson({
      date: startInFormTz.date || formatApiDate(day),
      startTime: startInFormTz.time || startTime,
      endTime: endInFormTz.time || endTime,
    });
  }, [openCreateLesson]);

  const visibleEvents = useMemo(() => {
    if (view === "day") {
      return filteredEvents.filter((ev) => isSameDay(eventDate(ev), focusDate));
    }
    if (view === "week") {
      const ws = startOfWeek(focusDate);
      const we = endOfWeek(focusDate);
      return filteredEvents.filter((ev) => {
        const d = eventDate(ev);
        return d >= ws && d <= we;
      });
    }
    if (view === "month") {
      return filteredEvents.filter(
        (ev) => eventDate(ev).getMonth() === focusDate.getMonth()
          && eventDate(ev).getFullYear() === focusDate.getFullYear(),
      );
    }
    return filteredEvents.filter((ev) => eventDate(ev) >= startOfDay(new Date())).slice(0, 20);
  }, [filteredEvents, view, focusDate]);

  const handleToday = () => {
    const today = startOfDay(new Date());
    setFocusDate(today);
    setSelectedDate(today);
  };

  const handlePrev = () => {
    if (view === "day") setFocusDate((d) => addDays(d, -1));
    else if (view === "week" || view === "list") setFocusDate((d) => addDays(d, -7));
    else setFocusDate((d) => addMonths(d, -1));
  };

  const handleNext = () => {
    if (view === "day") setFocusDate((d) => addDays(d, 1));
    else if (view === "week" || view === "list") setFocusDate((d) => addDays(d, 7));
    else setFocusDate((d) => addMonths(d, 1));
  };

  const handleSelectDate = (date) => {
    setSelectedDate(date);
    setFocusDate(date);
  };

  const handleCalendarToggle = (id) => {
    if (id === "all") {
      const next = !calendars.all;
      setCalendars({
        all: next,
        yandex: next,
      });
      return;
    }
    setCalendars((prev) => {
      const next = { ...prev, [id]: !prev[id] };
      next.all = CALENDAR_SOURCES.filter((s) => s.id !== "all").every((s) => next[s.id]);
      return next;
    });
  };

  const handleDayClick = (date) => {
    setFocusDate(date);
    setSelectedDate(date);
    setView("day");
  };

  const handleEventClick = useCallback((event) => {
    if (justDraggedRef.current) return;
    setSelectedEvent(event);
  }, []);

  const handleDragEnd = useCallback(() => {
    setDropPreview(null);
    justDraggedRef.current = true;
    window.setTimeout(() => {
      justDraggedRef.current = false;
    }, 200);
  }, []);

  const handleDragOver = useCallback((day, time, dayKey) => {
    setDropPreview({ dayKey: dayKey ?? formatApiDate(day), time });
  }, []);

  const handleDrop = useCallback((eventId, targetDate, targetStartTime) => {
    const event = events.find((ev) => String(ev.id) === String(eventId));
    if (!event) return;
    if (event.readOnly) {
      showStatus("События из Яндекс Календаря редактируются в calendar.yandex.ru.");
      return;
    }
    setDropPreview(null);
    setPendingAction({
      type: "move",
      event,
      targetDate,
      targetStartTime,
    });
  }, [events, showStatus]);

  const dndEnabled = !isMobile;

  const { draggingId, onEventPointerDown } = useSchedulePointerDrag({
    enabled: dndEnabled,
    events,
    onDragOver: handleDragOver,
    onDrop: handleDrop,
    onDragEnd: handleDragEnd,
  });

  const mapApiScope = (scope) => parseScheduleScope(scope === "single" ? "single" : scope);

  const handleConfirmAction = useCallback(async (scope, options = {}) => {
    if (!pendingAction || actionSavingRef.current) return;
    actionSavingRef.current = true;
    setActionSaving(true);

    const action = pendingAction;
    const { type, event, targetDate, targetStartTime } = action;
    const snapshotEvents = events;
    const local = isLocalEvent(event);
    const apiScope = mapApiScope(scope);
    const planCancelAction = options.planCancelAction;

    try {
      if (type === "move") {
        const nextEvents = applyMoveEvents(snapshotEvents, event, targetDate, targetStartTime, scope);
        const updated = nextEvents.find((ev) => ev.id === event.id);
        setEvents(nextEvents);
        if (local && updated) {
          const data = await updateScheduleEvent(event.id, {
            ...buildEventDateTime(updated),
            scope: apiScope,
            notify_participants: true,
          });
          if (apiScope === "series" || apiScope === "following") {
            const range = getSeriesRefreshRange(focusDate);
            const refreshed = await fetchScheduleEvents(range);
            if (refreshed?.events) setEvents(refreshed.events);
          } else if (data?.event) {
            setEvents((prev) => prev.map((ev) => (ev.id === event.id ? data.event : ev)));
          }
        }
        showStatus(scope === "entire" ? "Вся серия перенесена" : scope === "following" ? "Серия перенесена" : "Занятие перенесено");
        // Перенос времени — не финансовое событие: урок ещё состоится.
      } else if (type === "delete") {
        if (local) {
          await deleteScheduleEvent(event.id, { scope: apiScope, notifyParticipants: true });
        }
        setEvents((prev) => applyRemoveEvents(prev, event, scope));
        showStatus(scope === "entire" ? "Вся серия удалена" : scope === "following" ? "Серия удалена" : "Занятие удалено");
        setSelectedEvent(null);
      } else if (type === "cancel") {
        if (local) {
          await updateScheduleEvent(event.id, {
            status: "cancelled",
            scope: apiScope,
            notify_participants: true,
            plan_cancel_action: planCancelAction || "shift",
          });
          const range = getCalendarFetchRange(view, focusDate);
          const refreshed = await fetchScheduleEvents(range);
          if (refreshed?.events) setEvents(refreshed.events);
          else setEvents((prev) => applyCancelEvents(prev, event, scope));
        } else {
          setEvents((prev) => applyCancelEvents(prev, event, scope));
        }
        const planMsg = planCancelAction === "skip"
          ? "Занятие отменено, тема пропущена для ученика"
          : "Занятие отменено, тема перенесена на следующее занятие";
        showStatus(scope === "entire" ? "Вся серия отменена" : scope === "following" ? "Серия отменена" : planMsg);
        setSelectedEvent(null);
        openBillingPrompt(event, "cancelled");
      }
      setPendingAction(null);
    } catch (err) {
      if (type === "move") {
        setEvents(snapshotEvents);
      }
      showStatus(err.message || "Не удалось выполнить действие.");
    } finally {
      actionSavingRef.current = false;
      setActionSaving(false);
    }
  }, [pendingAction, events, showStatus, view, focusDate, openBillingPrompt]);

  return (
    <CabinetPageShell className="cb-section--schedule cb-section--schedule-cal">
      {toast}
      {statusMessage ? (
        <div className="cb-soon-toast" role="status">{statusMessage}</div>
      ) : null}

      <ScheduleToolbar
        view={view}
        onViewChange={setView}
        focusDate={focusDate}
        onToday={handleToday}
        onPrev={handlePrev}
        onNext={handleNext}
        onAddLesson={() => openCreateLesson()}
        isMobile={isMobile}
        accountEmail={calendarAccountEmail}
      />

      <div className={`cb-sch-layout${yandexEmbedEnabled ? " cb-sch-layout--embed" : ""}`}>
        {!yandexEmbedEnabled ? (
          <ScheduleSidebar
            open={sidebarOpen}
            onToggle={() => setSidebarOpen((v) => !v)}
            focusDate={focusDate}
            selectedDate={selectedDate}
            onSelectDate={handleSelectDate}
            calendars={calendars}
            onCalendarToggle={handleCalendarToggle}
            onCreate={() => openCreateLesson()}
            upcomingEvents={filteredEvents}
            onEventClick={handleEventClick}
            yandexCalendarEnabled={yandexCalendarEnabled}
          />
        ) : null}

        <div className="cb-sch-main">
          {!yandexEmbedEnabled && calendarSource === "yandex" && yandexCalendarEnabled && !yandexLayerIds ? (
            <div className="cb-sch-calendar-hint">
              <p>
                Интеграция с Яндекс Календарём пока не настроена. Обратитесь к администратору платформы.
              </p>
            </div>
          ) : null}
          {!yandexEmbedEnabled && calendarError ? (
            <div className="cb-sch-calendar-banner" role="alert">
              <p>{calendarError}</p>
              {yandexCalendarEnabled && calendarSource === "yandex" && calendarAuthorizeUrl ? (
                <a
                  href={calendarAuthorizeUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="cb-btn cb-btn--outline cb-btn--sm"
                >
                  Получить OAuth-токен
                </a>
              ) : null}
            </div>
          ) : null}
          {!yandexEmbedEnabled && calendarLoading ? (
            <p className="cb-sch-calendar-loading">
              {calendarSource === "yandex" ? "Загрузка Яндекс Календаря…" : "Загрузка расписания…"}
            </p>
          ) : null}
          {yandexEmbedEnabled && yandexLayerIds ? (
            <YandexCalendarEmbed view={view} layerIds={yandexLayerIds} tzId={yandexTzId} />
          ) : null}
          {!yandexEmbedEnabled && view === "week" && (
            <WeekGrid
              events={visibleEvents}
              focusDate={focusDate}
              dndEnabled={dndEnabled}
              draggingId={draggingId}
              dropPreview={dropPreview}
              onEventClick={handleEventClick}
              onPointerDown={onEventPointerDown}
              onSlotClick={handleSlotClick}
              onAddLesson={() => openCreateLesson()}
            />
          )}
          {!yandexEmbedEnabled && view === "day" && (
            <DayGrid
              events={visibleEvents}
              focusDate={focusDate}
              dndEnabled={dndEnabled}
              draggingId={draggingId}
              dropPreview={dropPreview}
              onEventClick={handleEventClick}
              onPointerDown={onEventPointerDown}
              onSlotClick={handleSlotClick}
              onAddLesson={() => openCreateLesson({ date: formatApiDate(focusDate) })}
            />
          )}
          {!yandexEmbedEnabled && view === "month" && (
            <MonthGrid
              events={visibleEvents}
              focusDate={focusDate}
              dndEnabled={dndEnabled}
              draggingId={draggingId}
              dropPreview={dropPreview}
              onEventClick={handleEventClick}
              onDayClick={handleDayClick}
              onPointerDown={onEventPointerDown}
            />
          )}
          {!yandexEmbedEnabled && view === "list" && (
            <ListView
              events={visibleEvents}
              onOpen={handleEventClick}
              onStart={handleStartLesson}
              onCreateLink={handleCreateMeetingLink}
              onAddLesson={() => openCreateLesson()}
            />
          )}
        </div>
      </div>

      {isMobile ? (
        <button
          type="button"
          className="cb-sch-fab"
          onClick={() => openCreateLesson()}
          aria-label="Добавить урок"
        >
          <CabinetIcon name="plus" />
        </button>
      ) : null}

      {selectedEvent ? (
        <EventDetailPopover
          event={selectedEvent}
          isMobile={isMobile}
          highlightMaterials={prepareMaterialsPrompt}
          onSkipMaterials={() => {
            skipOnboardingMaterials();
            setPrepareMaterialsPrompt(false);
          }}
          onClose={() => {
            setSelectedEvent(null);
            setPrepareMaterialsPrompt(false);
          }}
          onEdit={() => {
            setEditEvent(selectedEvent);
            setSelectedEvent(null);
          }}
          onOpenLesson={(focusMaterials) => handleOpenLesson(selectedEvent, focusMaterials)}
          onAddMaterials={() => void handleAddMaterials(selectedEvent)}
          onRemoveMaterial={(row) => void handleRemoveLessonMaterial(row)}
          onAddHomework={() => void handleAddHomework(selectedEvent)}
          onStart={handleStartLesson}
          onCreateLink={handleCreateMeetingLink}
          onOpenMeetingPage={handleStartLesson}
          onRequestDelete={() => {
            setPendingAction({ type: "delete", event: selectedEvent });
          }}
          onRequestCancel={() => {
            setPendingAction({ type: "cancel", event: selectedEvent });
          }}
          onDuplicate={() => handleDuplicateLesson(selectedEvent)}
          onSaveLink={handleSaveTelemostLink}
          savingLinkId={savingLinkId}
          startingId={startingId}
          creatingLinkId={creatingLinkId}
          billingBadges={billingBadges}
          onEventUpdated={(patch) => {
            if (!patch) return;
            const id = patch.id || selectedEvent?.id;
            if (!id) return;
            setEvents((prev) => prev.map((ev) => (ev.id === id ? { ...ev, ...patch } : ev)));
            setSelectedEvent((prev) => (prev?.id === id ? { ...prev, ...patch } : prev));
          }}
          onRegisterPayment={(ev, payableBadges = []) => {
            const rows = payableBadges.length
              ? payableBadges
              : (billingBadges || []).filter((b) =>
                ["awaiting_payment", "partially_paid"].includes(b.financial_status),
              );
            const studentId = rows[0]?.student_id || ev.studentId || ev.student_id || null;
            const ids = rows.map((b) => b.record_id).filter(Boolean);
            const amount = rows.reduce((sum, b) => sum + Number(b.amount || 0), 0);
            const eventPk = scheduleEventNumericId(ev?.id);
            setSelectedEvent(null);
            openLessonPayment(studentId, ids, amount || null, eventPk);
          }}
          onOpenJournal={(ev) => {
            const id = ev?.id || selectedEvent?.id;
            if (openLessonSummaryTab(id)) {
              setSelectedEvent(null);
            } else {
              showToast("Не удалось открыть итоги урока");
            }
          }}
        />
      ) : null}

      <FinalizeLessonBillingModal
        open={Boolean(finalizeBillingEvent)}
        eventId={finalizeBillingEvent?.id}
        mode={finalizeBillingMode}
        onClose={() => setFinalizeBillingEvent(null)}
        onDone={(result) => {
          const eventPk = finalizeBillingEvent?.id;
          setFinalizeBillingEvent(null);
          if (!result?.silent) showToast("Финансы урока оформлены");
          if (eventPk) refreshBillingBadges(eventPk);
        }}
        onRequestPayment={({ studentId, eventBillingIds, amount, eventId }) => {
          openLessonPayment(studentId, eventBillingIds, amount, eventId);
        }}
      />
      <BillingPaymentModal
        open={paymentModalOpen}
        onClose={() => {
          setPaymentModalOpen(false);
          setPaymentEventBillingIds(null);
          setPaymentDefaultAmount(null);
          setPaymentEventId(null);
        }}
        students={paymentStudents}
        defaultStudentId={paymentForStudentId}
        defaultAmount={paymentDefaultAmount}
        eventBillingIds={paymentEventBillingIds}
        onDone={() => {
          showToast("Оплата сохранена");
          if (paymentEventId) refreshBillingBadges(paymentEventId);
        }}
      />

      {homeworkAssignModal ? (
        <HomeworkAssignModal
          student={homeworkAssignModal.student || null}
          group={homeworkAssignModal.group || null}
          students={homeworkAssignModal.students || null}
          scheduleEventId={homeworkAssignModal.scheduleEventId || null}
          studentSubjectId={homeworkAssignModal.studentSubjectId || null}
          onClose={() => setHomeworkAssignModal(null)}
          onAssigned={() => {
            const eventPk = homeworkAssignModal.scheduleEventId || null;
            setHomeworkAssignModal(null);
            showToast("Домашнее задание выдано");
            if (!eventPk) return;
            const range = getCalendarFetchRange(view, focusDate);
            fetchScheduleEvents(range)
              .then((data) => {
                const next = Array.isArray(data?.events) ? data.events : [];
                setEvents(next);
                const refreshed = next.find((ev) => scheduleEventNumericId(ev.id) === Number(eventPk));
                if (refreshed) setSelectedEvent(refreshed);
              })
              .catch(() => {});
          }}
        />
      ) : null}

      <PlanItemResourcesPicker
        scope="lesson"
        open={Boolean(lessonResourcePicker)}
        initialTab={lessonResourcePicker?.initialTab || "library"}
        attachedMaterialIds={lessonResourcePicker?.attachedMaterialIds || []}
        attachedInteractiveIds={lessonResourcePicker?.attachedInteractiveIds || []}
        suggestContext={lessonResourcePicker?.suggestContext || null}
        onClose={() => {
          if (!lessonResourceBusy) setLessonResourcePicker(null);
        }}
        onAttachMaterial={handleAttachLessonMaterial}
        onAttachInteractive={handleAttachLessonInteractive}
      />

      {pendingAction ? (
        <ConfirmActionModal
          action={pendingAction}
          saving={actionSaving}
          onClose={() => {
            if (!actionSavingRef.current) setPendingAction(null);
          }}
          onConfirm={handleConfirmAction}
        />
      ) : null}

      {editEvent ? (
        <EditScheduleLessonModal
          event={editEvent}
          onClose={() => setEditEvent(null)}
          onSave={handleEditSave}
          onEventUpdated={(patch) => {
            if (!patch?.id && !editEvent?.id) return;
            const id = patch.id || editEvent.id;
            setEvents((prev) => prev.map((ev) => (ev.id === id ? { ...ev, ...patch } : ev)));
            setEditEvent((prev) => (prev?.id === id ? { ...prev, ...patch } : prev));
            setSelectedEvent((prev) => (prev?.id === id ? { ...prev, ...patch } : prev));
          }}
        />
      ) : null}

      {lessonDetail ? (
        <PlanItemDetailModal
          itemId={lessonDetail.itemId}
          initialItem={lessonDetail.initialItem}
          canEdit={false}
          initialFocusSection={lessonDetail.focusMaterials ? "materials" : null}
          onClose={() => setLessonDetail(null)}
        />
      ) : null}

      {createOpen ? (
        <CreateScheduleLessonModal
          onClose={() => {
            setCreateOpen(false);
            setCreateDraft(null);
          }}
          onCreate={handleCreateLesson}
          dialogTitle={createDraft?.dialogTitle}
          defaultDate={createDraft?.date || formatApiDate(selectedDate)}
          defaultStartTime={createDraft?.startTime}
          defaultEndTime={createDraft?.endTime}
          defaultLessonTitle={createDraft?.lessonTitle}
          defaultTopic={createDraft?.topic}
          defaultType={createDraft?.type}
          defaultFormat={createDraft?.format}
          defaultGroupId={createDraft?.groupId}
          defaultStudentId={createDraft?.studentId}
          defaultStudentIds={createDraft?.studentIds}
        />
      ) : null}
    </CabinetPageShell>
  );
}
