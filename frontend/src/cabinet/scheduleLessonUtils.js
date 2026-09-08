const MONTHS = [
  "января", "февраля", "марта", "апреля", "мая", "июня",
  "июля", "августа", "сентября", "октября", "ноября", "декабря",
];

const WEEKDAYS = [
  "воскресенье", "понедельник", "вторник", "среда", "четверг", "пятница", "суббота",
];

export function formatApiDate(date) {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, "0");
  const d = String(date.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

export const UPCOMING_CALENDAR_DAYS = 21;

function startOfLocalDay(date) {
  const next = new Date(date);
  next.setHours(0, 0, 0, 0);
  return next;
}

function addLocalDays(date, days) {
  const next = new Date(date);
  next.setDate(next.getDate() + days);
  return next;
}

function startOfLocalWeek(date) {
  const next = startOfLocalDay(date);
  const day = (next.getDay() + 6) % 7;
  return addLocalDays(next, -day);
}

export function unionDateRanges(a, b) {
  return {
    from: a.from < b.from ? a.from : b.from,
    to: a.to > b.to ? a.to : b.to,
  };
}

export function getVisibleCalendarRange(view, focusDate, now = new Date()) {
  if (view === "day") {
    return { from: formatApiDate(focusDate), to: formatApiDate(focusDate) };
  }
  if (view === "month") {
    const start = new Date(focusDate.getFullYear(), focusDate.getMonth(), 1);
    const end = new Date(focusDate.getFullYear(), focusDate.getMonth() + 1, 0);
    return { from: formatApiDate(start), to: formatApiDate(end) };
  }
  if (view === "list") {
    const start = startOfLocalDay(now);
    const end = addLocalDays(start, 60);
    return { from: formatApiDate(start), to: formatApiDate(end) };
  }
  const weekStart = startOfLocalWeek(focusDate);
  const weekEnd = addLocalDays(weekStart, 6);
  return { from: formatApiDate(weekStart), to: formatApiDate(weekEnd) };
}

export function getUpcomingCalendarRange(now = new Date()) {
  const start = startOfLocalDay(now);
  return {
    from: formatApiDate(start),
    to: formatApiDate(addLocalDays(start, UPCOMING_CALENDAR_DAYS)),
  };
}

function rangeDaySpan(range) {
  const from = Date.parse(`${range.from}T00:00:00`);
  const to = Date.parse(`${range.to}T00:00:00`);
  if (Number.isNaN(from) || Number.isNaN(to)) return 0;
  return Math.round((to - from) / 86400000) + 1;
}

export function getCalendarFetchWindows(view, focusDate, now = new Date()) {
  const visible = getVisibleCalendarRange(view, focusDate, now);
  const upcoming = getUpcomingCalendarRange(now);
  const united = unionDateRanges(visible, upcoming);
  if (rangeDaySpan(united) > rangeDaySpan(visible) + rangeDaySpan(upcoming) + 3) {
    return [visible, upcoming];
  }
  return [united];
}

export function getCalendarFetchRange(view, focusDate, now = new Date()) {
  return getCalendarFetchWindows(view, focusDate, now).reduce(
    (acc, range) => (acc ? unionDateRanges(acc, range) : range),
    null,
  );
}

export function mergeScheduleEventLists(batches) {
  const byId = new Map();
  for (const batch of batches) {
    const events = Array.isArray(batch) ? batch : batch?.events;
    for (const event of events || []) {
      if (event && event.id != null) byId.set(String(event.id), event);
    }
  }
  return Array.from(byId.values()).sort((a, b) => {
    const startA = Date.parse(a.startsAt || "") || 0;
    const startB = Date.parse(b.startsAt || "") || 0;
    if (startA !== startB) return startA - startB;
    return String(a.id).localeCompare(String(b.id), "en");
  });
}

export function normalizeTimeValue(value) {
  if (!value) return "00:00";
  const parts = String(value).trim().split(":");
  const hours = Number.parseInt(parts[0], 10);
  const minutes = Number.parseInt(parts[1], 10);
  if (Number.isNaN(hours) || Number.isNaN(minutes)) return "00:00";
  return `${String(hours).padStart(2, "0")}:${String(minutes).padStart(2, "0")}`;
}

function pad2(value) {
  return String(value).padStart(2, "0");
}

/** Часы:минуты в часовом поясе браузера — как на главной странице кабинета. */
export function formatEventLocalClock(iso) {
  if (!iso) return "";
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "";
  return `${pad2(date.getHours())}:${pad2(date.getMinutes())}`;
}

export function eventLocalStartTime(event) {
  return formatEventLocalClock(event?.startsAt) || normalizeTimeValue(event?.startTime);
}

export function eventLocalEndTime(event) {
  return formatEventLocalClock(event?.endsAt) || normalizeTimeValue(event?.endTime);
}

export function eventLocalTimeRange(event) {
  const start = eventLocalStartTime(event);
  const end = eventLocalEndTime(event);
  if (!start) return "";
  return end ? `${start}–${end}` : start;
}

export function eventStartDateTime(event, now = new Date()) {
  if (event?.startsAt) {
    const dt = new Date(event.startsAt);
    if (!Number.isNaN(dt.getTime())) return dt;
  }
  const next = new Date(now);
  next.setHours(0, 0, 0, 0);
  const offset = Number(event?.dayOffset);
  if (Number.isFinite(offset) && offset) next.setDate(next.getDate() + offset);
  const [hours, minutes] = normalizeTimeValue(event?.startTime).split(":").map(Number);
  next.setHours(hours, minutes, 0, 0);
  return next;
}

function normalizePersonName(value) {
  return String(value || "").trim().toLowerCase().replace(/\s+/g, " ");
}

function personNamesOverlap(a, b) {
  const left = normalizePersonName(a);
  const right = normalizePersonName(b);
  if (!left || !right) return false;
  if (left === right) return true;
  const shorter = left.length <= right.length ? left : right;
  const longer = left.length <= right.length ? right : left;
  return longer.startsWith(`${shorter} `) || longer.endsWith(` ${shorter}`) || longer.includes(` ${shorter} `);
}

export function eventDisplayTitle(event) {
  const title = String(event?.title || "").trim();
  const audience = String(event?.audience || "").trim();
  if (audience && title && audience !== title && personNamesOverlap(title, audience)) {
    return audience.length >= title.length ? audience : title;
  }
  return title || audience || "Занятие";
}

export function eventDisplaySubtitle(event) {
  const title = eventDisplayTitle(event);
  const audience = String(event?.audience || "").trim();
  const subject = String(event?.studentSubjectLabel || "").trim();
  const parts = [];
  if (audience && audience !== title && !personNamesOverlap(audience, title)) parts.push(audience);
  if (subject) parts.push(subject);
  return parts.length ? parts.join(" · ") : "";
}

export function upcomingEventDateLabel(event, now = new Date()) {
  const start = eventStartDateTime(event, now);
  if (Number.isNaN(start.getTime())) return "";
  const today = new Date(now);
  today.setHours(0, 0, 0, 0);
  const target = new Date(start);
  target.setHours(0, 0, 0, 0);
  const diff = Math.round((target - today) / 86400000);
  if (diff === 0) return "сегодня";
  if (diff === 1) return "завтра";
  return `${target.getDate()} ${MONTHS[target.getMonth()]}`;
}

function studentIdentity(event) {
  if (event?.studentId != null && event.studentId !== "") return `s:${event.studentId}`;
  const ids = Array.isArray(event?.participantStudentIds)
    ? event.participantStudentIds.filter((id) => id != null && id !== "")
    : [];
  if (ids.length === 1) return `s:${ids[0]}`;
  if (ids.length > 1) return `p:${[...ids].map(String).sort().join(",")}`;
  return "";
}

function sameUpcomingLesson(a, b) {
  const aStart = eventStartDateTime(a).getTime();
  const bStart = eventStartDateTime(b).getTime();
  if (Number.isNaN(aStart) || Number.isNaN(bStart)) return false;
  if (Math.abs(aStart - bStart) > 60 * 1000) return false;
  const aId = studentIdentity(a);
  const bId = studentIdentity(b);
  if (aId && bId) return aId === bId;
  return personNamesOverlap(a.audience || a.title, b.audience || b.title);
}

function preferUpcomingEvent(a, b) {
  const aTitle = eventDisplayTitle(a);
  const bTitle = eventDisplayTitle(b);
  if (aTitle.length !== bTitle.length) return aTitle.length >= bTitle.length ? a : b;
  if (studentIdentity(a) && !studentIdentity(b)) return a;
  if (studentIdentity(b) && !studentIdentity(a)) return b;
  return a;
}

export function getUpcomingEvents(events, limit = 3, now = new Date()) {
  const nowMs = now.getTime();
  const future = (Array.isArray(events) ? events : [])
    .filter((ev) => ev && ev.status !== "cancelled")
    .map((ev) => ({ ev, start: eventStartDateTime(ev, now) }))
    .filter(({ start }) => {
      const time = start.getTime();
      return !Number.isNaN(time) && time >= nowMs;
    })
    .sort((a, b) => {
      const delta = a.start.getTime() - b.start.getTime();
      if (delta !== 0) return delta;
      return eventDisplayTitle(a.ev).localeCompare(eventDisplayTitle(b.ev), "ru");
    });

  const picked = [];
  for (const { ev } of future) {
    const dupAt = picked.findIndex((other) => sameUpcomingLesson(other, ev));
    if (dupAt >= 0) {
      picked[dupAt] = preferUpcomingEvent(picked[dupAt], ev);
      continue;
    }
    picked.push(ev);
    if (picked.length >= limit) break;
  }
  return picked;
}

export function combineLocalDateAndTime(date, time) {
  const [hours, minutes] = normalizeTimeValue(time).split(":").map(Number);
  const next = new Date(date);
  next.setHours(hours, minutes, 0, 0);
  return next;
}

export function formatLocalDateTimeIso(date) {
  const offsetMin = -date.getTimezoneOffset();
  const sign = offsetMin >= 0 ? "+" : "-";
  const abs = Math.abs(offsetMin);
  return (
    `${date.getFullYear()}-${pad2(date.getMonth() + 1)}-${pad2(date.getDate())}`
    + `T${pad2(date.getHours())}:${pad2(date.getMinutes())}:00`
    + `${sign}${pad2(Math.floor(abs / 60))}:${pad2(abs % 60)}`
  );
}

export function localClockToTimeZone(date, time, timeZone) {
  const dt = combineLocalDateAndTime(date, time);
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).formatToParts(dt);
  const get = (type) => parts.find((part) => part.type === type)?.value || "";
  const hour = get("hour") === "24" ? "00" : get("hour");
  return {
    date: `${get("year")}-${get("month")}-${get("day")}`,
    time: `${pad2(hour)}:${pad2(get("minute"))}`,
  };
}

export function buildScheduleDateTimePayload(date, startTime, endTime) {
  const start = normalizeTimeValue(startTime);
  const end = normalizeTimeValue(endTime);
  return {
    starts_at: `${date}T${start}:00`,
    ends_at: `${date}T${end}:00`,
  };
}

export function parseScheduleScope(scope) {
  if (scope === "entire" || scope === "all") return "series";
  if (scope === "series" || scope === "following" || scope === "single") return scope;
  return "single";
}

export function eventScheduleDate(event) {
  if (event.startsAt) {
    const d = new Date(event.startsAt);
    if (!Number.isNaN(d.getTime())) return formatApiDate(d);
  }
  const today = new Date();
  today.setDate(today.getDate() + (event.dayOffset || 0));
  return formatApiDate(today);
}

function parseClockTime(value) {
  const [h, m] = normalizeTimeValue(value).split(":").map(Number);
  return h * 60 + m;
}

function formatClockTime(totalMinutes) {
  const mins = ((totalMinutes % (24 * 60)) + (24 * 60)) % (24 * 60);
  const h = String(Math.floor(mins / 60)).padStart(2, "0");
  const m = String(mins % 60).padStart(2, "0");
  return `${h}:${m}`;
}

export function matchesSeriesScope(event, anchor, scope) {
  const key = event.logicalSeriesKey || event.seriesId;
  const anchorKey = anchor.logicalSeriesKey || anchor.seriesId;
  if (!key || key !== anchorKey) return false;
  if (scope === "series") return true;
  if (scope === "following") {
    const anchorDate = eventScheduleDate(anchor);
    const eventDate = eventScheduleDate(event);
    return eventDate >= anchorDate;
  }
  return event.id === anchor.id;
}

export function applySeriesTimeUpdate(events, anchorEvent, { startTime, endTime, scope, anchorDate }) {
  const normalizedScope = parseScheduleScope(scope);
  const nextStart = normalizeTimeValue(startTime);
  const nextEnd = normalizeTimeValue(endTime);

  if (normalizedScope === "single" || !(anchorEvent.seriesId || anchorEvent.hasOrphanSeries || anchorEvent.isRecurring)) {
    return events.map((ev) => (
      ev.id === anchorEvent.id
        ? { ...ev, startTime: nextStart, endTime: nextEnd }
        : ev
    ));
  }

  const anchorDateChanged = Boolean(
    anchorDate && anchorDate !== eventScheduleDate(anchorEvent),
  );

  return events.map((ev) => {
    if (!matchesSeriesScope(ev, anchorEvent, normalizedScope)) return ev;
    if (!anchorDateChanged) {
      return { ...ev, startTime: nextStart, endTime: nextEnd };
    }
    const startDelta = parseClockTime(nextStart) - parseClockTime(anchorEvent.startTime || "00:00");
    const duration = parseClockTime(ev.endTime || "00:00") - parseClockTime(ev.startTime || "00:00");
    const updatedStart = formatClockTime(parseClockTime(ev.startTime || "00:00") + startDelta);
    const updatedEnd = formatClockTime(parseClockTime(updatedStart) + duration);
    return { ...ev, startTime: updatedStart, endTime: updatedEnd };
  });
}

export function getSeriesRefreshRange(focusDate, daysAhead = 120) {
  const from = new Date();
  from.setHours(0, 0, 0, 0);
  const to = new Date(focusDate);
  to.setDate(to.getDate() + daysAhead);
  return { from: formatApiDate(from), to: formatApiDate(to) };
}

export function getLessonsFetchRange() {
  const from = new Date();
  from.setDate(from.getDate() - 30);
  const to = new Date();
  to.setDate(to.getDate() + 60);
  return { from: formatApiDate(from), to: formatApiDate(to) };
}

export function formatDayHeading(date) {
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const target = new Date(date);
  target.setHours(0, 0, 0, 0);
  const diff = Math.round((target - today) / 86400000);
  const weekday = WEEKDAYS[target.getDay()];
  const label = `${target.getDate()} ${MONTHS[target.getMonth()]}, ${weekday}`;
  if (diff === 0) return `Сегодня, ${label}`;
  if (diff === 1) return `Завтра, ${label}`;
  if (diff === -1) return `Вчера, ${label}`;
  return label;
}

export function isTeachableLessonEvent(event) {
  return event.type === "group" || event.type === "individual";
}

export function sessionMatchesFilter(event, filter) {
  if (filter === "planned") return event.status === "planned";
  if (filter === "done") return event.status === "done";
  return true;
}

export function groupSessionsByDate(events) {
  const groups = new Map();
  for (const event of events) {
    const parsed = event.startsAt ? new Date(event.startsAt) : null;
    const dateKey = parsed && !Number.isNaN(parsed.getTime()) ? formatApiDate(parsed) : "";
    if (!dateKey) continue;
    if (!groups.has(dateKey)) groups.set(dateKey, []);
    groups.get(dateKey).push(event);
  }

  for (const [, list] of groups) {
    list.sort((a, b) => (a.startsAt || "").localeCompare(b.startsAt || ""));
  }

  return [...groups.entries()].sort(([a], [b]) => a.localeCompare(b));
}

export function sessionStatusTone(status) {
  if (status === "done") return "success";
  if (status === "draft") return "draft";
  return "info";
}

export function sessionTypeLabel(type) {
  if (type === "individual") return "Индивидуальное";
  if (type === "group") return "Групповое";
  return "Занятие";
}
