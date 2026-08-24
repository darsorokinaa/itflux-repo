/** Общие хелперы отображения статусов ДЗ ученика */

export const STUDENT_HW_STATUS_LABELS = {
  new: "Не начато",
  in_progress: "В процессе",
  submitted: "Отправлено",
  reviewing: "На проверке",
  checked: "Проверено",
  overdue: "Просрочено",
  needs_fix: "Требуется исправление",
  completed: "Проверено",
};

export function studentHwStatusLabel(status, fallback = "") {
  return STUDENT_HW_STATUS_LABELS[status] || fallback || "Задание";
}

export function studentHwActionLabel(status) {
  if (status === "checked" || status === "completed") return "Перейти к результатам";
  if (status === "needs_fix") return "Исправить работу";
  if (status === "submitted" || status === "reviewing") return "Посмотреть работу";
  if (status === "in_progress") return "Продолжить";
  if (status === "overdue") return "Выполнить";
  return "Выполнить";
}

export function pluralRu(n, one, few, many) {
  const abs = Math.abs(n) % 100;
  const last = abs % 10;
  if (abs > 10 && abs < 20) return many;
  if (last === 1) return one;
  if (last >= 2 && last <= 4) return few;
  return many;
}

export function greetingByHour(date = new Date()) {
  const h = date.getHours();
  if (h >= 5 && h < 12) return "Доброе утро";
  if (h >= 12 && h < 17) return "Добрый день";
  if (h >= 17 && h < 23) return "Добрый вечер";
  return "Доброй ночи";
}

export function formatCountdownTo(iso) {
  if (!iso) return "";
  const start = new Date(iso).getTime();
  if (Number.isNaN(start)) return "";
  const diff = start - Date.now();
  if (diff <= 0) return "";
  const minutes = Math.round(diff / 60000);
  if (minutes < 60) {
    return `через ${minutes} ${pluralRu(minutes, "минуту", "минуты", "минут")}`;
  }
  const hours = Math.floor(minutes / 60);
  const rem = minutes % 60;
  if (hours < 24) {
    if (rem === 0) return `через ${hours} ${pluralRu(hours, "час", "часа", "часов")}`;
    return `через ${hours} ${pluralRu(hours, "час", "часа", "часов")} ${rem} мин`;
  }
  const days = Math.floor(hours / 24);
  return `через ${days} ${pluralRu(days, "день", "дня", "дней")}`;
}

export function formatDayLabel(iso) {
  if (!iso) return "";
  try {
    const d = new Date(iso);
    const now = new Date();
    if (d.toDateString() === now.toDateString()) return "Сегодня";
    const tomorrow = new Date(now);
    tomorrow.setDate(tomorrow.getDate() + 1);
    if (d.toDateString() === tomorrow.toDateString()) return "Завтра";
    return d.toLocaleDateString("ru-RU", { weekday: "long", day: "numeric", month: "long" });
  } catch {
    return "";
  }
}

export function masteryLabel(status) {
  const map = {
    completed: "Освоено",
    checked: "Освоено",
    in_progress: "Нужна практика",
    repeat: "Есть ошибки",
    new: "Изучено",
  };
  return map[status] || "Изучено";
}
