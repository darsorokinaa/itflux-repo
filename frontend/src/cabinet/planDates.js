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
