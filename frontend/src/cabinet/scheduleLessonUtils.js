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

export function normalizeTimeValue(value) {
  if (!value) return "00:00";
  const parts = String(value).trim().split(":");
  const hours = Number.parseInt(parts[0], 10);
  const minutes = Number.parseInt(parts[1], 10);
  if (Number.isNaN(hours) || Number.isNaN(minutes)) return "00:00";
  return `${String(hours).padStart(2, "0")}:${String(minutes).padStart(2, "0")}`;
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
    const dateKey = (event.startsAt || "").slice(0, 10);
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
