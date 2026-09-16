export const DEFAULT_TIMEZONE = "Europe/Moscow";

export const SCHEDULE_TIMEZONES = [
  { value: "Europe/Kaliningrad", city: "Калининград", offset: "UTC+2" },
  { value: "Europe/Kyiv", city: "Киев", offset: "UTC+2" },
  { value: "Europe/Moscow", city: "Москва, Санкт-Петербург", offset: "UTC+3" },
  { value: "Europe/Simferopol", city: "Симферополь", offset: "UTC+3" },
  { value: "Europe/Minsk", city: "Минск", offset: "UTC+3" },
  { value: "Europe/Istanbul", city: "Стамбул", offset: "UTC+3" },
  { value: "Europe/Samara", city: "Самара, Ижевск", offset: "UTC+4" },
  { value: "Europe/Astrakhan", city: "Астрахань", offset: "UTC+4" },
  { value: "Europe/Saratov", city: "Саратов", offset: "UTC+4" },
  { value: "Europe/Ulyanovsk", city: "Ульяновск", offset: "UTC+4" },
  { value: "Asia/Baku", city: "Баку", offset: "UTC+4" },
  { value: "Asia/Yerevan", city: "Ереван", offset: "UTC+4" },
  { value: "Asia/Tbilisi", city: "Тбилиси", offset: "UTC+4" },
  { value: "Asia/Yekaterinburg", city: "Екатеринбург, Пермь, Челябинск", offset: "UTC+5" },
  { value: "Asia/Qyzylorda", city: "Кызылорда", offset: "UTC+5" },
  { value: "Asia/Almaty", city: "Алматы, Астана", offset: "UTC+5" },
  { value: "Asia/Tashkent", city: "Ташкент", offset: "UTC+5" },
  { value: "Asia/Omsk", city: "Омск", offset: "UTC+6" },
  { value: "Asia/Novosibirsk", city: "Новосибирск, Барнаул", offset: "UTC+7" },
  { value: "Asia/Tomsk", city: "Томск", offset: "UTC+7" },
  { value: "Asia/Krasnoyarsk", city: "Красноярск", offset: "UTC+7" },
  { value: "Asia/Novokuznetsk", city: "Новокузнецк", offset: "UTC+7" },
  { value: "Asia/Irkutsk", city: "Иркутск, Улан-Удэ", offset: "UTC+8" },
  { value: "Asia/Chita", city: "Чита", offset: "UTC+9" },
  { value: "Asia/Yakutsk", city: "Якутск", offset: "UTC+9" },
  { value: "Asia/Vladivostok", city: "Владивосток, Хабаровск", offset: "UTC+10" },
  { value: "Asia/Magadan", city: "Магадан", offset: "UTC+11" },
  { value: "Asia/Sakhalin", city: "Южно-Сахалинск", offset: "UTC+11" },
  { value: "Asia/Kamchatka", city: "Петропавловск-Камчатский", offset: "UTC+12" },
  { value: "Asia/Anadyr", city: "Анадырь", offset: "UTC+12" },
];

const BY_VALUE = new Map(SCHEDULE_TIMEZONES.map((item) => [item.value, item]));

export function timezoneOptionLabel(item) {
  if (!item) return "";
  return item.offset ? `${item.city} (${item.offset})` : item.city;
}

export function timezoneCityLabel(timeZone) {
  const name = String(timeZone || "").trim();
  const item = BY_VALUE.get(name);
  if (item) return item.city.split(",")[0].trim();
  if (!name) return "";
  return name.split("/").pop()?.replace(/_/g, " ") || name;
}

export function isKnownTimezone(timeZone) {
  return BY_VALUE.has(String(timeZone || "").trim());
}

export function browserTimeZone() {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || "";
  } catch {
    return "";
  }
}

export function pickDefaultTimezone(preferred) {
  const wanted = String(preferred || "").trim();
  if (isKnownTimezone(wanted)) return wanted;
  const device = browserTimeZone();
  if (isKnownTimezone(device)) return device;
  return DEFAULT_TIMEZONE;
}

function localeOptions(timeZone) {
  return timeZone ? { timeZone } : {};
}

export function formatTimeInZone(iso, timeZone) {
  if (!iso) return "";
  try {
    return new Date(iso).toLocaleTimeString("ru-RU", {
      hour: "2-digit",
      minute: "2-digit",
      ...localeOptions(timeZone),
    });
  } catch {
    return "";
  }
}

export function formatDateInZone(iso, timeZone) {
  if (!iso) return "—";
  try {
    return new Date(iso).toLocaleDateString("ru-RU", {
      day: "numeric",
      month: "short",
      ...localeOptions(timeZone),
    });
  } catch {
    return "—";
  }
}

/** Стена часов date+time в поясе fromTz → UTC ms. */
export function wallClockToUtcMs(dateStr, timeStr, timeZone) {
  const [year, month, day] = String(dateStr || "").split("-").map(Number);
  const [hour, minute] = String(timeStr || "00:00").split(":").map(Number);
  if (![year, month, day, hour, minute].every(Number.isFinite)) return NaN;
  const utcGuess = Date.UTC(year, month - 1, day, hour, minute, 0);
  try {
    const parts = Object.fromEntries(
      new Intl.DateTimeFormat("en-US", {
        timeZone: timeZone || DEFAULT_TIMEZONE,
        hour12: false,
        year: "numeric",
        month: "2-digit",
        day: "2-digit",
        hour: "2-digit",
        minute: "2-digit",
        second: "2-digit",
      }).formatToParts(new Date(utcGuess)).map((part) => [part.type, part.value]),
    );
    let shownHour = Number(parts.hour);
    if (shownHour === 24) shownHour = 0;
    const asIfUtc = Date.UTC(
      Number(parts.year),
      Number(parts.month) - 1,
      Number(parts.day),
      shownHour,
      Number(parts.minute),
      Number(parts.second),
    );
    return utcGuess - (asIfUtc - utcGuess);
  } catch {
    return utcGuess;
  }
}

export function formatWallClockInTimeZone(dateStr, timeStr, fromTz, toTz) {
  const utcMs = wallClockToUtcMs(dateStr, timeStr, fromTz);
  if (Number.isNaN(utcMs)) return "";
  return formatTimeInZone(new Date(utcMs).toISOString(), toTz);
}

export function studentTimezoneNote(timeZone) {
  const city = timezoneCityLabel(timeZone);
  return city ? `по вашему времени · ${city}` : "по вашему времени";
}

export function dateKeyInTimeZone(iso, timeZone) {
  if (!iso) return "unknown";
  try {
    const d = new Date(iso);
    if (Number.isNaN(d.getTime())) return "unknown";
    if (!timeZone) {
      return `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`;
    }
    const parts = Object.fromEntries(
      new Intl.DateTimeFormat("en-CA", {
        timeZone,
        year: "numeric",
        month: "2-digit",
        day: "2-digit",
      }).formatToParts(d).map((part) => [part.type, part.value]),
    );
    return `${parts.year}-${parts.month}-${parts.day}`;
  } catch {
    return "unknown";
  }
}

export function formatClockRangeInZone(startsAt, endsAt, timeZone) {
  const start = formatTimeInZone(startsAt, timeZone);
  if (!start) return "";
  const end = endsAt ? formatTimeInZone(endsAt, timeZone) : "";
  return end ? `${start}–${end}` : start;
}

export function formatDayLabelInZone(iso, timeZone, now = new Date()) {
  if (!iso) return "";
  try {
    const key = dateKeyInTimeZone(iso, timeZone);
    const todayKey = dateKeyInTimeZone(now.toISOString(), timeZone);
    if (key === todayKey) return "Сегодня";
    const tomorrow = new Date(now.getTime() + 86400000);
    if (key === dateKeyInTimeZone(tomorrow.toISOString(), timeZone)) return "Завтра";
    return new Date(iso).toLocaleDateString("ru-RU", {
      weekday: "long",
      day: "numeric",
      month: "long",
      ...localeOptions(timeZone),
    });
  } catch {
    return "";
  }
}

export function ensureTimezoneOption(timeZone) {
  const name = String(timeZone || "").trim();
  if (!name) return SCHEDULE_TIMEZONES;
  if (isKnownTimezone(name)) return SCHEDULE_TIMEZONES;
  return [
    ...SCHEDULE_TIMEZONES,
    { value: name, city: timezoneCityLabel(name), offset: "" },
  ];
}
