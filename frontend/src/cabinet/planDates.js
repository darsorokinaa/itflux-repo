export const PLAN_DATE_INTERVALS = [
  { id: "daily", label: "Каждый день" },
  { id: "four_weekly", label: "4 раза в неделю" },
  { id: "thrice_weekly", label: "3 раза в неделю" },
  { id: "twice_weekly", label: "2 раза в неделю" },
  { id: "weekly", label: "Раз в неделю" },
  { id: "biweekly", label: "Раз в две недели" },
];

export function parseLocalISODate(value) {
  if (!value) return null;
  const match = String(value).match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (!match) return null;
  const date = new Date(Number(match[1]), Number(match[2]) - 1, Number(match[3]));
  return Number.isNaN(date.getTime()) ? null : date;
}

export function formatLocalISODate(date) {
  if (!(date instanceof Date) || Number.isNaN(date.getTime())) return "";
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

export function addDaysLocal(iso, days) {
  const date = parseLocalISODate(iso);
  if (!date) return "";
  date.setDate(date.getDate() + Number(days || 0));
  return formatLocalISODate(date);
}

export function intervalStepDays(intervalId, index) {
  if (intervalId === "daily") return 1;
  if (intervalId === "thrice_weekly") return [2, 2, 3][index % 3];
  if (intervalId === "four_weekly") return [1, 2, 1, 3][index % 4];
  if (intervalId === "twice_weekly") return index % 2 === 0 ? 3 : 4;
  if (intervalId === "biweekly") return 14;
  return 7;
}

export function generatePlanDates(startIso, count, intervalId = "weekly") {
  if (!startIso || count <= 0) return [];
  const dates = [];
  let current = startIso;
  for (let index = 0; index < count; index += 1) {
    dates.push(current);
    current = addDaysLocal(current, intervalStepDays(intervalId, index));
  }
  return dates;
}

export function applyPlanDates(sessions, startIso, intervalId = "weekly", fromIndex = 0) {
  if (!Array.isArray(sessions) || !startIso) return sessions;
  const start = fromIndex === 0
    ? startIso
    : sessions[fromIndex]?.scheduledDate || startIso;
  const dates = generatePlanDates(start, Math.max(0, sessions.length - fromIndex), intervalId);
  return sessions.map((session, index) => {
    if (index < fromIndex) return session;
    return { ...session, scheduledDate: dates[index - fromIndex] || session.scheduledDate || "" };
  });
}

export function inferPlanDateInterval(sessions) {
  const first = parseLocalISODate(sessions?.[0]?.scheduledDate);
  const second = parseLocalISODate(sessions?.[1]?.scheduledDate);
  if (!first || !second) return "weekly";
  const diff = Math.round((second.getTime() - first.getTime()) / 86400000);
  if (diff === 14) return "biweekly";
  if (diff === 7) return "weekly";
  if (diff === 3 || diff === 4) return "twice_weekly";
  if (diff === 2) return "thrice_weekly";
  if (diff === 1) {
    const third = parseLocalISODate(sessions?.[2]?.scheduledDate);
    if (!third) return "daily";
    const secondGap = Math.round((third.getTime() - second.getTime()) / 86400000);
    return secondGap === 1 ? "daily" : "four_weekly";
  }
  return "weekly";
}

export function formatPlanDateLabel(iso) {
  const date = parseLocalISODate(iso);
  if (!date) return "";
  return date.toLocaleDateString("ru-RU", { day: "numeric", month: "short" });
}

export function nextPlanDateAfter(iso, index, intervalId = "weekly") {
  if (!iso) return "";
  return addDaysLocal(iso, intervalStepDays(intervalId, index));
}

export function calendarDateKey(value) {
  const match = String(value || "").match(/^(\d{4}-\d{2}-\d{2})/);
  return match ? match[1] : "";
}

export function calendarDaysBetween(fromIso, toIso) {
  const from = parseLocalISODate(fromIso);
  const to = parseLocalISODate(toIso);
  if (!from || !to) return null;
  return Math.round((to.getTime() - from.getTime()) / 86400000);
}

function ruPlural(n, one, few, many) {
  const abs = Math.abs(Number(n) || 0);
  const mod10 = abs % 10;
  const mod100 = abs % 100;
  if (mod10 === 1 && mod100 !== 11) return one;
  if (mod10 >= 2 && mod10 <= 4 && (mod100 < 12 || mod100 > 14)) return few;
  return many;
}

export function formatPlanDateNumeric(iso) {
  const date = parseLocalISODate(iso);
  if (!date) return "";
  const day = String(date.getDate()).padStart(2, "0");
  const month = String(date.getMonth() + 1).padStart(2, "0");
  return `${day}.${month}.${date.getFullYear()}`;
}

export function plannedDateAtIndex(sessions, index, intervalId = "weekly") {
  const start = calendarDateKey(sessions?.[0]?.scheduledDate);
  if (!start || index < 0) return "";
  return generatePlanDates(start, index + 1, intervalId)[index] || "";
}

export function isManualDateOverride(sessions, index, intervalId = "weekly") {
  if (index <= 0) return false;
  const current = calendarDateKey(sessions?.[index]?.scheduledDate);
  const planned = plannedDateAtIndex(sessions, index, intervalId);
  return Boolean(current && planned && current !== planned);
}

export function countSessionsOnDate(sessions, iso, exceptIndex = -1) {
  const day = calendarDateKey(iso);
  if (!day) return 0;
  return (sessions || []).filter((session, index) => (
    index !== exceptIndex && calendarDateKey(session?.scheduledDate) === day
  )).length;
}

export function describeDateDeviation(fromIso, toIso, intervalId = "weekly") {
  const days = calendarDaysBetween(fromIso, toIso);
  if (days == null || days === 0) {
    return { days: 0, sameDay: true, message: "", extra: "" };
  }
  const abs = Math.abs(days);
  const later = days > 0;
  const prefix = later
    ? "Эта дата отличается от текущего плана"
    : "Новая дата раньше текущего плана";

  let amount;
  if (abs % 7 === 0) {
    const weeks = abs / 7;
    amount = ` примерно на ${weeks} ${ruPlural(weeks, "неделю", "недели", "недель")}`;
  } else {
    amount = ` на ${abs} ${ruPlural(abs, "день", "дня", "дней")}`;
  }

  let extra = "";
  const step = intervalId === "weekly" ? 7
    : intervalId === "biweekly" ? 14
      : intervalId === "daily" ? 1
        : 0;
  if (step && abs === step) {
    extra = "Это сдвинет занятие примерно на одно занятие относительно плана.";
  } else if (step && abs === step * 2) {
    extra = "Это сдвинет занятие примерно на два занятия относительно плана.";
  }

  return {
    days,
    sameDay: false,
    message: `${prefix}${amount}.`,
    extra,
  };
}

export function compressPlanDatesAfterRemove(sessions, removedIndices) {
  if (!Array.isArray(sessions) || !sessions.length) return sessions;
  const removed = new Set(
    (Array.isArray(removedIndices) ? removedIndices : [removedIndices])
      .map(Number)
      .filter((index) => index >= 0 && index < sessions.length),
  );
  if (!removed.size) return sessions;

  const slots = sessions.map((session) => session.scheduledDate || "");
  const remaining = sessions.filter((_, index) => !removed.has(index));
  const firstRemoved = Math.min(...removed);
  const tailSlots = slots.slice(firstRemoved);
  let offset = 0;
  return remaining.map((session, index) => {
    if (index < firstRemoved) return session;
    const nextDate = tailSlots[offset] || "";
    offset += 1;
    if ((session.scheduledDate || "") === nextDate) return session;
    return { ...session, scheduledDate: nextDate };
  });
}

export function willCompressDatesAfterRemove(sessions, removedIndices) {
  const list = Array.isArray(sessions) ? sessions : [];
  const removed = (Array.isArray(removedIndices) ? removedIndices : [removedIndices])
    .map(Number)
    .filter((index) => index >= 0 && index < list.length);
  if (!removed.length) return false;
  if (!list.some((session) => session?.scheduledDate)) return false;
  return Math.max(...removed) < list.length - 1;
}
