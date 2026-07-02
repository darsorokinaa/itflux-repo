import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  createScheduleEvent,
  deleteScheduleEvent,
  fetchCalendarEvents,
  fetchCalendarStatus,
  fetchScheduleEvents,
  startTelemostLesson,
  updateScheduleEvent,
} from "../../utils/cabinetAuth";
import { useCabinetCall } from "../CabinetCallContext";
import { isTelemostMeetingUrl } from "../telemostPopup";
import CreateScheduleLessonModal from "../components/CreateScheduleLessonModal";
import EditScheduleLessonModal from "../components/EditScheduleLessonModal";
import EventDetailCard from "../components/EventDetailCard";
import PlanItemDetailModal from "../components/PlanItemDetailModal";
import CabinetIcon from "../CabinetIcons";
import { CabinetPageShell, useSoonToast } from "../CabinetSectionUi";
import {
  applySeriesTimeUpdate,
  getSeriesRefreshRange,
  parseScheduleScope,
} from "../scheduleLessonUtils";
import {
  planItemHomeworkPopoverRows,
  planItemLessonPopoverRows,
  planItemTaskPopoverRows,
  scheduleEventPlanItemToModalItem,
} from "../planItemAttachments";

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

function eventStartDateTime(event) {
  if (event.startsAt) return new Date(event.startsAt);
  const d = eventDate(event);
  const [h, m] = (event.startTime || "00:00").split(":").map(Number);
  d.setHours(h, m, 0, 0);
  return d;
}

function getUpcomingEvents(events, limit = 3) {
  const now = new Date();
  return [...events]
    .filter((ev) => ev.status !== "cancelled")
    .sort((a, b) => eventStartDateTime(a) - eventStartDateTime(b))
    .filter((ev) => eventStartDateTime(ev) >= now)
    .slice(0, limit);
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
  if (view === "day") {
    return { from: formatApiDate(focusDate), to: formatApiDate(focusDate) };
  }
  if (view === "month") {
    const start = new Date(focusDate.getFullYear(), focusDate.getMonth(), 1);
    const end = new Date(focusDate.getFullYear(), focusDate.getMonth() + 1, 0);
    return { from: formatApiDate(start), to: formatApiDate(end) };
  }
  if (view === "list") {
    const start = startOfDay(new Date());
    const end = addDays(start, 60);
    return { from: formatApiDate(start), to: formatApiDate(end) };
  }
  const ws = startOfWeek(focusDate);
  const we = endOfWeek(focusDate);
  return { from: formatApiDate(ws), to: formatApiDate(we) };
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
  return `${wd.charAt(0).toUpperCase()}${wd.slice(1)}, ${d.getDate()} ${MONTHS[d.getMonth()]}, ${event.startTime}–${event.endTime}`;
}

function isRecurring(event) {
  return Boolean(event.seriesId || event.hasOrphanSeries || event.isRecurring);
}

function seriesScopeKey(event) {
  return event?.logicalSeriesKey || event?.seriesId || null;
}

function buildEventDateTime(event) {
  const date = eventDate(event);
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, "0");
  const d = String(date.getDate()).padStart(2, "0");
  return {
    starts_at: `${y}-${m}-${d}T${event.startTime}:00`,
    ends_at: `${y}-${m}-${d}T${event.endTime}:00`,
  };
}

function isLocalEvent(event) {
  return event?.source === "local" || String(event?.id || "").startsWith("local-");
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
  const timeDelta = newStart - parseTime(event.startTime);

  const patch = (ev) => {
    const evDuration = parseTime(ev.endTime) - parseTime(ev.startTime);
    const evNewStart = parseTime(ev.startTime) + timeDelta;
    const startTime = minutesToTime(evNewStart);
    const endTime = minutesToTime(evNewStart + evDuration);
    const newDayOffset = dayOffsetFromToday(eventDate(ev)) + dayDelta;
    const updated = {
      ...ev,
      dayOffset: newDayOffset,
      startTime,
      endTime,
    };
    if (ev.startsAt) {
      const newDate = addDays(startOfDay(new Date()), newDayOffset);
      const y = newDate.getFullYear();
      const mo = String(newDate.getMonth() + 1).padStart(2, "0");
      const d = String(newDate.getDate()).padStart(2, "0");
      updated.startsAt = `${y}-${mo}-${d}T${startTime}:00`;
      updated.endsAt = `${y}-${mo}-${d}T${endTime}:00`;
    }
    return updated;
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
          const time = target.time ?? event?.startTime ?? "09:00";
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
      const time = target.time ?? event?.startTime ?? "09:00";
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
        <button type="button" className="cb-sch-btn cb-sch-btn--today" onClick={onToday}>
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
        <button type="button" className="cb-sch-btn cb-sch-btn--primary cb-sch-btn--add" onClick={onAddLesson}>
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
          {upcoming.map((ev) => (
            <li key={ev.id}>
              <button
                type="button"
                className="cb-sch-upcoming__item"
                onClick={() => onEventClick(ev)}
              >
                <span className="cb-sch-upcoming__time">{ev.startTime}</span>
                <span className="cb-sch-upcoming__text">
                <span className="cb-sch-upcoming__title">{eventDisplayTitle(ev)}</span>
                {eventDisplaySubtitle(ev) ? (
                  <span className="cb-sch-upcoming__meta">{eventDisplaySubtitle(ev)}</span>
                ) : null}
                </span>
              </button>
            </li>
          ))}
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
        <button type="button" className="cb-sch-btn cb-sch-btn--outline cb-sch-btn--create" onClick={onCreate}>
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

function eventDisplayTitle(event) {
  return (event.title || event.audience || "Занятие").trim();
}

function eventDisplaySubtitle(event) {
  const title = eventDisplayTitle(event);
  const audience = (event.audience || "").trim();
  if (!audience || audience === title) return null;
  return audience;
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
  const shortBlock = !compact && eventDurationMinutes(event.startTime, event.endTime) < 35;
  const isOnline = event.format === "Онлайн" || Boolean(event.link);
  const cancelled = event.status === "cancelled";
  const recurring = isRecurring(event);
  const displayTitle = eventDisplayTitle(event);
  const displaySubtitle = eventDisplaySubtitle(event);
  const planTopic = (event.topic || "").trim();
  const cardSubtitle = displaySubtitle || (planTopic && planTopic !== displayTitle ? planTopic : "");

  const cardStyle = {
    ...style,
    borderLeftColor: accent,
    ...(compact ? { borderLeftColor: accent } : {}),
  };

  const content = !compact ? (
    <>
      <div className="cb-sch-event__head">
        <span className="cb-sch-event__time">{event.startTime}–{event.endTime}</span>
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
        <span className="cb-sch-event__pill-time">{event.startTime}</span>
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
              ? eventHeight(draggingEvent.startTime, draggingEvent.endTime)
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
            top: timeToTop(ev.startTime),
            height: eventHeight(ev.startTime, ev.endTime),
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
      <button type="button" className="cb-sch-btn cb-sch-btn--primary" onClick={onAddLesson}>
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
            <button type="button" className="cb-sch-btn cb-sch-btn--primary" onClick={onAddLesson}>
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

function ListView({ events, onEventClick, onOpen, onStart, onAddLesson }) {
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
          <button type="button" className="cb-sch-btn cb-sch-btn--primary" onClick={onAddLesson}>
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
              const hasLink = Boolean(ev.link && isTelemostMeetingUrl(ev.link));
              const canStart = ev.status === "planned" && ev.format === "Онлайн";
              return (
                <article key={ev.id} className="cb-sch-list-card">
                  <div className="cb-sch-list-card__accent" style={{ background: accent }} aria-hidden="true" />
                  <div className="cb-sch-list-card__body">
                    <div className="cb-sch-list-card__row">
                      <span className="cb-sch-list-card__time">{ev.startTime}–{ev.endTime}</span>
                      <span className={`cb-sch-list-card__status cb-sch-list-card__status--${ev.status}`}>
                        {ev.statusLabel}
                      </span>
                    </div>
                    <h3 className="cb-sch-list-card__title">{eventDisplayTitle(ev)}</h3>
                    <p className="cb-sch-list-card__meta">
                      {EVENT_TYPES[ev.type]?.label || "Занятие"}
                      {eventDisplaySubtitle(ev) ? (
                        <>
                          <span>·</span>
                          {eventDisplaySubtitle(ev)}
                        </>
                      ) : null}
                      {ev.format === "Онлайн" ? (
                        <>
                          <span>·</span>
                          онлайн
                        </>
                      ) : null}
                    </p>
                    {ev.topic ? <p className="cb-sch-list-card__topic">{ev.topic}</p> : null}
                  </div>
                  <div className="cb-sch-list-card__actions">
                    <button type="button" className="cb-sch-btn cb-sch-btn--outline cb-sch-btn--sm" onClick={() => onOpen(ev)}>
                      Открыть
                    </button>
                    {canStart && onStart ? (
                      <button type="button" className="cb-sch-btn cb-sch-btn--primary cb-sch-btn--sm" onClick={() => onStart(ev)}>
                        {hasLink ? "Начать" : "Создать ссылку"}
                      </button>
                    ) : null}
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

function ConfirmActionModal({ action, onClose, onConfirm }) {
  if (!action) return null;

  const { type, event, targetDate, targetStartTime } = action;
  const recurring = isRecurring(event);
  const hasPlan = Boolean(event.hasPlan || event.planItem || event.studentId || event.groupId);
  const planTopic = event.planItem?.topic || event.planItem?.title || event.topic || "";
  const [planAction, setPlanAction] = useState("shift");

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
    if (type === "cancel" && hasPlan) {
      onConfirm(scope, { planCancelAction: planAction });
      return;
    }
    onConfirm(scope);
  };

  return (
    <div className="cb-sch-overlay" onClick={onClose} role="presentation">
      <div
        className="cb-sch-confirm"
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-labelledby="sch-confirm-title"
      >
        <button type="button" className="cb-sch-popover__close" onClick={onClose} aria-label="Закрыть">
          <CabinetIcon name="close" />
        </button>
        <h2 id="sch-confirm-title" className="cb-sch-confirm__title">{copy.title}</h2>
        <p className="cb-sch-confirm__text">{copy.text}</p>
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
              >
                Перенести на следующее занятие
              </button>
              <button
                type="button"
                className={`cb-sch-confirm__plan-btn${planAction === "skip" ? " cb-sch-confirm__plan-btn--active" : ""}`}
                onClick={() => setPlanAction("skip")}
              >
                Пропустить для ученика
              </button>
            </div>
          </div>
        ) : null}
        <div className="cb-sch-confirm__actions">
          <button
            type="button"
            className={`cb-sch-btn cb-sch-btn--sm${copy.danger ? " cb-sch-btn--danger" : " cb-sch-btn--primary"}`}
            onClick={() => confirm("single")}
          >
            {copy.single}
          </button>
          {recurring ? (
            <>
              <button
                type="button"
                className={`cb-sch-btn cb-sch-btn--sm${copy.danger ? " cb-sch-btn--danger-outline" : " cb-sch-btn--outline"}`}
                onClick={() => confirm("following")}
              >
                {copy.following}
              </button>
              <button
                type="button"
                className={`cb-sch-btn cb-sch-btn--sm${copy.danger ? " cb-sch-btn--danger-outline" : " cb-sch-btn--outline"}`}
                onClick={() => confirm("entire")}
              >
                {copy.entire}
              </button>
            </>
          ) : null}
          <button type="button" className="cb-sch-btn cb-sch-btn--ghost cb-sch-btn--sm" onClick={onClose}>
            Не менять
          </button>
        </div>
      </div>
    </div>
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
  const item = getEventPlanItem(event);
  if (item) {
    return item.topic || item.title || "";
  }
  return displayEventField(event.topic, "");
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
  return planItemHomeworkPopoverRows(getEventPlanItem(event));
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

function participantInitials(name) {
  const parts = (name || "").trim().split(/\s+/).filter(Boolean);
  if (parts.length >= 2) {
    return `${parts[0][0]}${parts[1][0]}`.toUpperCase();
  }
  const value = (name || "?").trim();
  return value.slice(0, 2).toUpperCase();
}

function eventStatusMeta(event) {
  if (event.status === "cancelled") return { label: "Отменено", mod: "cancelled" };
  if (event.status === "done" || event.status === "completed") return { label: "Проведено", mod: "done" };
  if (event.status === "moved") return { label: "Перенесено", mod: "moved" };
  return null;
}

function EventDetailPopover(props) {
  const { event } = props;
  const typeInfo = EVENT_TYPES[event.type];
  const statusMeta = eventStatusMeta(event);
  const planItem = getEventPlanItem(event);
  const materials = getEventPlanMaterials(event);
  const homework = getEventPlanHomework(event);
  const topic = planItem
    ? (planItem.topic || planItem.title)
    : getEventPlanTopics(event);
  const hasAbout = planItem && (
    hasText(planItem.goal) || hasText(planItem.description) || hasText(planItem.teacherComment)
  );

  return (
    <EventDetailCard
      {...props}
      typeLabel={typeInfo?.label || "Занятие"}
      accentColor={eventAccentColor(event)}
      profileName={displayEventTitle(eventDisplayTitle(event))}
      dateLabel={formatEventDateShort(event)}
      timeRange={`${event.startTime}–${event.endTime}`}
      statusMeta={statusMeta}
      recurring={isRecurring(event)}
      isOnline={event.format === "Онлайн"}
      isCancelled={event.status === "cancelled"}
      isDone={event.status === "done" || event.status === "completed"}
      canStart={event.status === "planned" && event.format === "Онлайн"}
      hasLink={Boolean(event.link && isTelemostMeetingUrl(event.link))}
      canEditLink={!event.readOnly && event.format === "Онлайн"}
      materials={materials}
      homework={homework}
      planItem={planItem}
      hasAbout={hasAbout}
      topic={topic || ""}
      participants={Array.isArray(event.participants) ? event.participants : []}
      participantsFallback={formatEventParticipants(event) || "—"}
      shortenMeetingUrl={shortenMeetingUrl}
    />
  );
}

function useMobileDefaultView() {
  const [isMobile, setIsMobile] = useState(() =>
    typeof window !== "undefined" && window.matchMedia("(max-width: 768px)").matches,
  );

  useEffect(() => {
    const mq = window.matchMedia("(max-width: 768px)");
    const handler = (e) => setIsMobile(e.matches);
    mq.addEventListener("change", handler);
    return () => mq.removeEventListener("change", handler);
  }, []);

  return isMobile;
}

export default function CabinetSchedulePage() {
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
  const [embedHelpUrl, setEmbedHelpUrl] = useState("https://yandex.ru/support/yandex-360/customers/calendar/web/ru/widget");
  const [view, setView] = useState(() => (typeof window !== "undefined" && window.matchMedia("(max-width: 768px)").matches ? "list" : "week"));
  const [focusDate, setFocusDate] = useState(() => startOfDay(new Date()));
  const [selectedDate, setSelectedDate] = useState(() => startOfDay(new Date()));
  const [sidebarOpen, setSidebarOpen] = useState(() =>
    typeof window !== "undefined" && !window.matchMedia("(max-width: 768px)").matches,
  );
  const [calendars, setCalendars] = useState({
    all: true,
    yandex: true,
  });
  const [selectedEvent, setSelectedEvent] = useState(null);
  const [createOpen, setCreateOpen] = useState(false);
  const [createDraft, setCreateDraft] = useState(null);
  const [editEvent, setEditEvent] = useState(null);
  const [lessonDetail, setLessonDetail] = useState(null);
  const [startingId, setStartingId] = useState(null);
  const [savingLinkId, setSavingLinkId] = useState(null);
  const [statusMessage, setStatusMessage] = useState("");
  const [dropPreview, setDropPreview] = useState(null);
  const [pendingAction, setPendingAction] = useState(null);
  const { notifySoon, toast } = useSoonToast();
  const { prepareCall, openCall, abortCall } = useCabinetCall();

  const handleOpenLesson = useCallback((event, focusMaterials = false) => {
    const item = getEventPlanItem(event);
    if (!item?.id) {
      notifySoon();
      return;
    }
    setLessonDetail({
      itemId: item.id,
      initialItem: scheduleEventPlanItemToModalItem(item, event),
      focusMaterials,
    });
    setSelectedEvent(null);
  }, [notifySoon]);

  useEffect(() => {
    if (isMobile && view === "week") setView("list");
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
          if (data?.help_url) setEmbedHelpUrl(data.help_url);
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

  const showStatus = useCallback((message) => {
    setStatusMessage(message);
    window.setTimeout(() => setStatusMessage(""), 4000);
  }, []);

  const handleStartLesson = useCallback(async (event) => {
    setStartingId(event.id);

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
  }, [showStatus, prepareCall, openCall, abortCall]);

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
    if (payload.format === "online" && data?.event?.link) {
      showStatus(data?.events_created > 1
        ? `Создано занятий: ${data.events_created}`
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

  const handleSlotClick = useCallback((day, startTime) => {
    openCreateLesson({
      date: formatApiDate(day),
      startTime,
      endTime: addMinutesToTime(startTime, 45),
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
    if (!pendingAction) return;
    const { type, event, targetDate, targetStartTime } = pendingAction;
    const local = isLocalEvent(event);
    const apiScope = mapApiScope(scope);
    const planCancelAction = options.planCancelAction;

    try {
      if (type === "move") {
        const nextEvents = applyMoveEvents(events, event, targetDate, targetStartTime, scope);
        const updated = nextEvents.find((ev) => ev.id === event.id);
        setEvents(nextEvents);
        if (local && updated) {
          await updateScheduleEvent(event.id, {
            ...buildEventDateTime(updated),
            scope: apiScope,
            notify_participants: true,
          });
          if (apiScope === "series" || apiScope === "following") {
            const range = getSeriesRefreshRange(focusDate);
            const refreshed = await fetchScheduleEvents(range);
            if (refreshed?.events) setEvents(refreshed.events);
          }
        }
        showStatus(scope === "entire" ? "Вся серия перенесена" : scope === "following" ? "Серия перенесена" : "Занятие перенесено");
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
      }
    } catch (err) {
      showStatus(err.message || "Не удалось выполнить действие.");
    }

    setPendingAction(null);
  }, [pendingAction, events, showStatus, view, focusDate]);

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
          {isMobile && !yandexEmbedEnabled ? (
            <div className="cb-sch-mobile-upcoming">
              <UpcomingLessons
                events={filteredEvents}
                onEventClick={handleEventClick}
                compact
              />
            </div>
          ) : null}
          {!yandexEmbedEnabled && calendarSource === "yandex" && yandexCalendarEnabled && !yandexLayerIds ? (
            <div className="cb-sch-calendar-hint">
              <p>
                Чтобы показать <strong>оригинальный интерфейс Яндекс Календаря</strong>, скопируйте
                {" "}
                <code>layer_ids</code>
                {" "}
                из настроек календаря (Доступ → Код для вставки) и добавьте в
                {" "}
                <code>YANDEX_CALENDAR_LAYER_IDS</code>
                {" "}
                в
                {" "}
                <code>Generator/.env</code>
                .
              </p>
              <a
                href="https://calendar.yandex.ru/"
                target="_blank"
                rel="noopener noreferrer"
                className="cb-sch-btn cb-sch-btn--outline cb-sch-btn--sm"
              >
                Открыть calendar.yandex.ru
              </a>
              <a
                href={embedHelpUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="cb-sch-btn cb-sch-btn--ghost cb-sch-btn--sm"
              >
                Как получить код вставки
              </a>
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
                  className="cb-sch-btn cb-sch-btn--outline cb-sch-btn--sm"
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
              onEventClick={handleEventClick}
              onOpen={handleEventClick}
              onStart={handleStartLesson}
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
          onClose={() => setSelectedEvent(null)}
          onEdit={() => {
            setEditEvent(selectedEvent);
            setSelectedEvent(null);
          }}
          onOpenLesson={(focusMaterials) => handleOpenLesson(selectedEvent, focusMaterials)}
          onStart={handleStartLesson}
          onRequestDelete={() => {
            setPendingAction({ type: "delete", event: selectedEvent });
          }}
          onRequestCancel={() => {
            setPendingAction({ type: "cancel", event: selectedEvent });
          }}
          onDuplicate={notifySoon}
          onSaveLink={handleSaveTelemostLink}
          savingLinkId={savingLinkId}
          startingId={startingId}
        />
      ) : null}

      {pendingAction ? (
        <ConfirmActionModal
          action={pendingAction}
          onClose={() => setPendingAction(null)}
          onConfirm={handleConfirmAction}
        />
      ) : null}

      {editEvent ? (
        <EditScheduleLessonModal
          event={editEvent}
          onClose={() => setEditEvent(null)}
          onSave={handleEditSave}
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
          defaultDate={createDraft?.date || formatApiDate(selectedDate)}
          defaultStartTime={createDraft?.startTime}
          defaultEndTime={createDraft?.endTime}
        />
      ) : null}
    </CabinetPageShell>
  );
}
