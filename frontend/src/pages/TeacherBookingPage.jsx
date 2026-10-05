import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { bookPublicSlot, fetchPublicBookingPage, previewPublicBooking } from "../utils/cabinetAuth";
import { rememberReturnPath } from "../accessGate/accessGate";
import { usePageTitle } from "../cabinet/hooks/usePageTitle";
import { SCHEDULE_TIMEZONES, wallClockToUtcMs } from "../cabinet/timezones";
import "../styles/teacher-booking.css";

const WEEKDAY_HEADS = ["Пн", "Вт", "Ср", "Чт", "Пт", "Сб", "Вс"];
const WEEKDAY_DATIVE = [
  "воскресеньям",
  "понедельникам",
  "вторникам",
  "средам",
  "четвергам",
  "пятницам",
  "субботам",
];
const MAX_SERIES = 60;

const ICONS = {
  clock: (
    <>
      <circle cx="12" cy="12" r="8.5" />
      <path d="M12 7v5l3 2" />
    </>
  ),
  video: (
    <>
      <rect x="3" y="5.5" width="12" height="13" rx="3" />
      <path d="m15 10 5-3v10l-5-3" />
    </>
  ),
  calendar: (
    <>
      <rect x="3.5" y="5.5" width="17" height="15" rx="3" />
      <path d="M7.5 3v5m9-5v5m-13 3h17m-12 4h2m3 0h2" />
    </>
  ),
  check: <path d="m5 12 4.5 4.5L19 7" />,
  arrow: <path d="M5 12h14m-5-5 5 5-5 5" />,
  arrowLeft: <path d="M19 12H5m7-7-7 7 7 7" />,
  repeat: <path d="m16 3 4 4-4 4M4 11V9a2 2 0 0 1 2-2h14M8 21l-4-4 4-4m12 0v2a2 2 0 0 1-2 2H4" />,
  globe: (
    <>
      <circle cx="12" cy="12" r="9" />
      <ellipse cx="12" cy="12" rx="4" ry="9" />
      <path d="M3 12h18" />
    </>
  ),
  info: (
    <>
      <circle cx="12" cy="12" r="9" />
      <path d="M12 11v6m0-10h.01" />
    </>
  ),
  math: <path d="M4 7h6M7 4v6m7-5 6 6m0-6-6 6M4 17h6m4-1h6m-6 4h6" />,
  person: (
    <>
      <circle cx="12" cy="8" r="3.5" />
      <path d="M5 20v-2a7 7 0 0 1 14 0v2" />
    </>
  ),
  down: <path d="m6 9 6 6 6-6" />,
  close: <path d="m6 6 12 12M6 18 18 6" />,
  download: <path d="M12 3v12m-4-4 4 4 4-4M4 16v3a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-3" />,
  shield: (
    <>
      <path d="m12 3 8 3v5c0 5-4 8-8 10-4-2-8-5-8-10V6l8-3Z" />
      <path d="m8 12 3 3 5-6" />
    </>
  ),
  link: (
    <>
      <path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71" />
      <path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71" />
    </>
  ),
};

function BookingIcon({ name }) {
  return (
    <svg className="cb-bk-icon" viewBox="0 0 24 24" aria-hidden="true">
      {ICONS[name]}
    </svg>
  );
}

function parseDay(iso) {
  return new Date(`${iso}T12:00:00`);
}

function isoFromDate(date) {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

function todayIso() {
  return isoFromDate(new Date());
}

function addDays(iso, days) {
  const date = parseDay(iso);
  date.setDate(date.getDate() + days);
  return isoFromDate(date);
}

function initials(name) {
  const parts = String(name || "").trim().split(/\s+/).filter(Boolean);
  if (!parts.length) return "П";
  return parts.slice(0, 2).map((part) => part[0]).join("").toUpperCase();
}

function capitalize(value) {
  const text = String(value || "");
  return text ? text.charAt(0).toUpperCase() + text.slice(1) : "";
}

function hm(value) {
  const text = String(value || "");
  const [h, m] = text.split(":");
  if (!h) return "";
  return `${String(h).padStart(2, "0")}:${String(m || "00").padStart(2, "0")}`;
}

function lessonWord(n) {
  const mod10 = n % 10;
  const mod100 = n % 100;
  if (mod10 === 1 && mod100 !== 11) return "занятие";
  if ([2, 3, 4].includes(mod10) && ![12, 13, 14].includes(mod100)) return "занятия";
  return "занятий";
}

function minuteWord(n) {
  const mod10 = n % 10;
  const mod100 = n % 100;
  if (mod10 === 1 && mod100 !== 11) return "минута";
  if ([2, 3, 4].includes(mod10) && ![12, 13, 14].includes(mod100)) return "минуты";
  return "минут";
}

function formatDayHeading(iso) {
  if (!iso) return "";
  const date = parseDay(iso);
  const weekday = date.toLocaleDateString("ru-RU", { weekday: "long" });
  const rest = date.toLocaleDateString("ru-RU", { day: "numeric", month: "long" });
  return `${capitalize(weekday)}, ${rest}`;
}

function formatLongDate(iso) {
  if (!iso) return "";
  return parseDay(iso).toLocaleDateString("ru-RU", { day: "numeric", month: "long" });
}

function formatFullDate(iso) {
  if (!iso) return "";
  const date = parseDay(iso);
  const day = date.toLocaleDateString("ru-RU", { day: "numeric", month: "long" });
  const weekday = date.toLocaleDateString("ru-RU", { weekday: "long" });
  return `${day}, ${weekday}`;
}

function formatMonthLabel(year, month) {
  const raw = new Date(year, month, 1).toLocaleDateString("ru-RU", {
    month: "long",
    year: "numeric",
  });
  return capitalize(raw);
}

function formatWindow(from, to) {
  if (!from || !to) return "";
  const start = parseDay(from);
  const end = parseDay(to);
  if (start.getMonth() === end.getMonth() && start.getFullYear() === end.getFullYear()) {
    const month = end.toLocaleDateString("ru-RU", { month: "long" });
    return `${start.getDate()}–${end.getDate()} ${month}`;
  }
  return `${formatLongDate(from)} – ${formatLongDate(to)}`;
}

function monthCells(year, month) {
  const first = new Date(year, month, 1);
  const pad = (first.getDay() + 6) % 7;
  const daysInMonth = new Date(year, month + 1, 0).getDate();
  const cells = [];
  for (let i = 0; i < pad; i += 1) {
    const date = new Date(year, month, 1 - (pad - i));
    cells.push({ date: isoFromDate(date), day: date.getDate(), inMonth: false });
  }
  for (let day = 1; day <= daysInMonth; day += 1) {
    cells.push({ date: isoFromDate(new Date(year, month, day)), day, inMonth: true });
  }
  while (cells.length % 7 !== 0) {
    const last = parseDay(cells[cells.length - 1].date);
    last.setDate(last.getDate() + 1);
    cells.push({ date: isoFromDate(last), day: last.getDate(), inMonth: false });
  }
  return cells;
}

function slotDurationMinutes(slot) {
  if (!slot?.start_time || !slot?.end_time) return 60;
  const [sh, sm] = hm(slot.start_time).split(":").map(Number);
  const [eh, em] = hm(slot.end_time).split(":").map(Number);
  const minutes = (eh * 60 + em) - (sh * 60 + sm);
  return minutes > 0 ? minutes : 60;
}

function weeklyDates(startIso, endIso) {
  if (!startIso || !endIso || endIso < startIso) return [];
  const dates = [];
  let cursor = startIso;
  while (cursor <= endIso && dates.length <= MAX_SERIES) {
    dates.push(cursor);
    cursor = addDays(cursor, 7);
  }
  return dates;
}

function defaultUntil(page, date) {
  const candidate = page?.default_repeat_until || page?.date_to || "";
  if (candidate && (!date || candidate >= date)) return candidate;
  if (!date) return candidate;
  return addDays(date, 21);
}

function timezoneCaption(timeZone) {
  const item = SCHEDULE_TIMEZONES.find((row) => row.value === timeZone);
  if (!item) return "Время преподавателя";
  const city = item.city.split(",")[0].trim();
  return item.offset ? `${city} · ${item.offset}` : city;
}

function foldIcsLine(line) {
  const encoder = new TextEncoder();
  let result = "";
  let current = "";
  let length = 0;
  for (const char of line) {
    const size = encoder.encode(char).length;
    if (length + size > 74) {
      result += `${current}\r\n`;
      current = " ";
      length = 1;
    }
    current += char;
    length += size;
  }
  return result + current;
}

function downloadBookingCalendar({ dates, start, end, timeZone, subject, teacherName }) {
  const stamp = new Date().toISOString().replace(/[-:]/g, "").replace(/\.\d{3}Z$/, "Z");
  const toStamp = (date, time) => {
    const utc = wallClockToUtcMs(date, time, timeZone || "Europe/Moscow");
    if (Number.isNaN(utc)) return "";
    return new Date(utc).toISOString().replace(/[-:]/g, "").replace(/\.\d{3}Z$/, "Z");
  };
  const lines = [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    "PRODID:-//ITFlux//Student Booking//RU",
    "CALSCALE:GREGORIAN",
  ];
  const uid = Date.now().toString(36);
  const summary = `${subject || "Занятие"} — ${teacherName}`;
  dates.forEach((date, index) => {
    const dtStart = toStamp(date, start);
    const dtEnd = toStamp(date, end);
    if (!dtStart || !dtEnd) return;
    lines.push(
      "BEGIN:VEVENT",
      `UID:booking-${uid}-${index}@itflux`,
      `DTSTAMP:${stamp}`,
      `DTSTART:${dtStart}`,
      `DTEND:${dtEnd}`,
      `SUMMARY:${summary}`,
      "END:VEVENT",
    );
  });
  lines.push("END:VCALENDAR");
  const file = new Blob([`${lines.map(foldIcsLine).join("\r\n")}\r\n`], { type: "text/calendar;charset=utf-8" });
  const url = URL.createObjectURL(file);
  const link = document.createElement("a");
  link.href = url;
  link.download = "itflux-booking.ics";
  document.body.append(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

function BookingBrand() {
  return (
    <header className="cb-bk-header">
      <Link to="/" className="cb-bk-brand-link" aria-label="Цифровой поток">
        <div className="cb-bk-brand">Цифровой <span>поток</span></div>
        <div className="cb-bk-brand-caption">Образовательная платформа</div>
      </Link>
    </header>
  );
}

export default function TeacherBookingPage() {
  const { token } = useParams();
  const navigate = useNavigate();
  const now = new Date();
  const [page, setPage] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [formError, setFormError] = useState("");
  const [selectedDate, setSelectedDate] = useState("");
  const [selectedSlot, setSelectedSlot] = useState(null);
  const [saving, setSaving] = useState(false);
  const [doneBooking, setDoneBooking] = useState(null);
  const [repeat, setRepeat] = useState("once");
  const [repeatUntil, setRepeatUntil] = useState("");
  const [preview, setPreview] = useState(null);
  const [previewLoading, setPreviewLoading] = useState(false);
  const [announcement, setAnnouncement] = useState("");
  const [viewMonth, setViewMonth] = useState({
    year: now.getFullYear(),
    month: now.getMonth(),
  });
  const monthReady = useRef(false);
  const helpRef = useRef(null);
  const successHeadingRef = useRef(null);

  usePageTitle(page?.teacher?.name ? `Запись к ${page.teacher.name}` : "Запись на занятие");

  const load = useCallback((options = {}) => {
    const silent = Boolean(options.silent);
    if (!silent) {
      setLoading(true);
      setError("");
    }
    fetchPublicBookingPage(token)
      .then((data) => {
        const firstDate = data?.dates?.[0]?.date || "";
        setPage(data);
        if (!monthReady.current && firstDate) {
          const date = parseDay(firstDate);
          setViewMonth({ year: date.getFullYear(), month: date.getMonth() });
          monthReady.current = true;
        }
        setSelectedDate((prev) => {
          if (prev && data?.dates?.some((item) => item.date === prev)) return prev;
          return firstDate;
        });
        setRepeatUntil((prev) => prev || data?.default_repeat_until || "");
      })
      .catch((err) => {
        if (silent) return;
        setError(err.message || "Не удалось загрузить расписание.");
        setPage(null);
      })
      .finally(() => {
        if (!silent) setLoading(false);
      });
  }, [token]);

  useEffect(() => {
    monthReady.current = false;
    load();
  }, [load]);

  const dates = page?.dates || [];
  const availableSet = useMemo(() => new Set(dates.map((item) => item.date)), [dates]);
  const daySlots = useMemo(
    () => dates.find((item) => item.date === selectedDate)?.slots || [],
    [dates, selectedDate],
  );
  const duration = slotDurationMinutes(selectedSlot || daySlots[0] || dates[0]?.slots?.[0]);
  const cells = useMemo(
    () => monthCells(viewMonth.year, viewMonth.month),
    [viewMonth.year, viewMonth.month],
  );
  const rows = useMemo(() => {
    const next = [];
    for (let index = 0; index < cells.length; index += 7) next.push(cells.slice(index, index + 7));
    return next;
  }, [cells]);

  const monthBounds = useMemo(() => {
    if (!dates.length) return null;
    const first = parseDay(dates[0].date);
    const last = parseDay(dates[dates.length - 1].date);
    return {
      min: first.getFullYear() * 12 + first.getMonth(),
      max: last.getFullYear() * 12 + last.getMonth(),
    };
  }, [dates]);

  const monthIndex = viewMonth.year * 12 + viewMonth.month;
  const canPrevMonth = !monthBounds || monthIndex > monthBounds.min;
  const canNextMonth = !monthBounds || monthIndex < monthBounds.max;
  const teacherName = page?.teacher?.name || "Преподаватель";
  const subject = preview?.subject_label || page?.subject_label || "Занятие";
  const zoneLabel = timezoneCaption(preview?.timezone || page?.timezone);
  const needsAuth = Boolean(page && !page.authenticated);
  const notStudent = Boolean(page?.authenticated && page.role && page.role !== "student");
  const notLinked = Boolean(page?.authenticated && page.role === "student" && !page.linked);
  const canPreview = Boolean(page?.authenticated && page.role === "student" && page.linked && selectedSlot);
  const weeklyInvalid = repeat === "weekly" && (!repeatUntil || (selectedDate && repeatUntil < selectedDate));
  const localSeries = repeat === "weekly" ? weeklyDates(selectedDate, repeatUntil) : (selectedDate ? [selectedDate] : []);
  const previewDates = useMemo(() => {
    if (!preview) return null;
    return [...(preview.available_dates || []), ...(preview.occupied || [])]
      .map((item) => item.date)
      .sort();
  }, [preview]);
  const occurrenceDates = previewDates?.length ? previewDates : localSeries;
  const occupiedSet = useMemo(
    () => new Set((preview?.occupied || []).map((item) => item.date)),
    [preview],
  );
  const partialOk = Boolean(preview && preview.occupied_count > 0 && preview.available_count > 0);
  const bookedCount = preview
    ? (preview.occupied_count > 0 ? preview.available_count : preview.total)
    : occurrenceDates.length;

  let validation = "";
  if (repeat === "weekly" && selectedDate && weeklyInvalid) {
    validation = "Укажите дату окончания не раньше первого занятия.";
  } else if (repeat === "weekly" && localSeries.length > MAX_SERIES) {
    validation = `Слишком много занятий в серии (максимум ${MAX_SERIES}). Выберите более раннюю дату окончания.`;
  } else if (preview?.occupied_count > 0 && selectedSlot) {
    const busy = (preview.occupied || []).map((item) => formatLongDate(item.date)).join(", ");
    validation = `Время ${hm(selectedSlot.start_time)} занято ${busy}. Выберите другое время или сократите серию.`;
    validation += partialOk
      ? " Можно забронировать только свободные даты."
      : " Запись не будет создана.";
  } else if (formError) {
    validation = formError;
  }

  const waitingPreview = canPreview && !weeklyInvalid && (previewLoading || !preview) && !formError;
  const ready = Boolean(selectedSlot)
    && !notStudent
    && !notLinked
    && !waitingPreview
    && (!validation || partialOk)
    && bookedCount > 0;

  const returnPath = `/book/${token}`;
  const loginHref = `/cabinet/login?next=${encodeURIComponent(returnPath)}`;

  const handleLogin = () => {
    rememberReturnPath(returnPath);
    navigate(loginHref);
  };

  const shiftMonth = (delta) => {
    setViewMonth((prev) => {
      const date = new Date(prev.year, prev.month + delta, 1);
      return { year: date.getFullYear(), month: date.getMonth() };
    });
  };

  const selectDate = (iso) => {
    const parsed = parseDay(iso);
    setViewMonth({ year: parsed.getFullYear(), month: parsed.getMonth() });
    setSelectedDate(iso);
    setSelectedSlot(null);
    setFormError("");
    setPreview(null);
    if (repeat === "weekly") {
      setRepeatUntil((prev) => (!prev || prev < iso ? defaultUntil(page, iso) : prev));
    }
    const slots = dates.find((item) => item.date === iso)?.slots || [];
    setAnnouncement(slots.length
      ? `${formatDayHeading(iso)}. Выберите свободное время.`
      : `${formatDayHeading(iso)}. Нет свободного времени.`);
  };

  const selectSlot = (slot) => {
    setSelectedSlot(slot);
    setFormError("");
    setAnnouncement(`Выбрано ${hm(slot.start_time)}–${hm(slot.end_time)}, ${formatLongDate(slot.date)}`);
  };

  const chooseRepeat = (value) => {
    setRepeat(value);
    setFormError("");
    if (value === "weekly") {
      setRepeatUntil((prev) => {
        const min = selectedDate || "";
        if (prev && (!min || prev >= min)) return prev;
        return defaultUntil(page, min);
      });
    }
  };

  useEffect(() => {
    if (!canPreview || weeklyInvalid) {
      setPreview(null);
      setPreviewLoading(false);
      return undefined;
    }
    let cancelled = false;
    setPreviewLoading(true);
    const payload = {
      date: selectedSlot.date,
      start_time: selectedSlot.start_time,
      recurrence_type: repeat === "weekly" ? "weekly" : "none",
      recurrence_until: repeat === "weekly" ? repeatUntil : selectedSlot.date,
    };
    previewPublicBooking(token, payload)
      .then((data) => {
        if (cancelled) return;
        setPreview(data);
        setFormError("");
      })
      .catch((err) => {
        if (cancelled) return;
        setPreview(null);
        if (err.code === "slot_taken") {
          setSelectedSlot(null);
          setFormError(err.message || "Это время уже занято.");
          load({ silent: true });
          return;
        }
        setFormError(err.message || "Не удалось проверить доступность серии.");
      })
      .finally(() => {
        if (!cancelled) setPreviewLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [canPreview, weeklyInvalid, selectedSlot, repeat, repeatUntil, token, load]);

  const recurrencePayload = () => ({
    date: selectedSlot.date,
    start_time: selectedSlot.start_time,
    recurrence_type: repeat === "weekly" ? "weekly" : "none",
    recurrence_until: repeat === "weekly" ? repeatUntil : selectedSlot.date,
  });

  const handleConfirm = async (event) => {
    event.preventDefault();
    if (!selectedSlot || !ready || saving) return;
    if (needsAuth) {
      handleLogin();
      return;
    }
    setSaving(true);
    setFormError("");
    try {
      const data = await bookPublicSlot(token, {
        ...recurrencePayload(),
        book_available_only: partialOk,
      });
      setDoneBooking({ ...data.booking, preview: data.preview });
      setSelectedSlot(null);
      load({ silent: true });
    } catch (err) {
      const nextPreview = err.data?.preview;
      if (err.code === "partial_unavailable" && nextPreview) {
        setPreview(nextPreview);
        setFormError("");
      } else if (err.code === "slot_taken") {
        setFormError(err.message || "Это время уже занято.");
        setSelectedSlot(null);
        load({ silent: true });
      } else {
        setFormError(err.message || "Не удалось записаться.");
      }
    } finally {
      setSaving(false);
    }
  };

  const onCalendarKeyDown = (event) => {
    const button = event.target.closest("button[data-date]");
    if (!button) return;
    const offset = { ArrowLeft: -1, ArrowRight: 1, ArrowUp: -7, ArrowDown: 7 }[event.key];
    if (!offset) return;
    event.preventDefault();
    const next = event.currentTarget.querySelector(`button[data-date="${addDays(button.dataset.date, offset)}"]`);
    if (next && !next.disabled) next.focus();
  };

  const jumpNearest = () => {
    const list = dates.map((item) => item.date);
    const next = list.find((date) => date >= (selectedDate || todayIso())) || list[0];
    if (next) selectDate(next);
  };

  useEffect(() => {
    if (!doneBooking) return;
    window.scrollTo({ top: 0, behavior: "auto" });
    successHeadingRef.current?.focus({ preventScroll: true });
  }, [doneBooking]);

  const openHelp = () => helpRef.current?.showModal();
  const closeHelp = () => helpRef.current?.close();

  const startLabel = hm(selectedSlot?.start_time);
  const endLabel = hm(selectedSlot?.end_time);
  const timeRange = startLabel && endLabel ? `${startLabel}–${endLabel}` : "";
  const weekly = repeat === "weekly";
  const lastDate = occurrenceDates[occurrenceDates.length - 1];
  const totalText = bookedCount > 0 && selectedSlot
    ? `${bookedCount} ${lessonWord(bookedCount)} · ${bookedCount * duration} ${minuteWord(bookedCount * duration)}`
    : "Проверьте даты";
  const repeatText = weekly
    ? `Каждую неделю${lastDate ? ` · до ${formatLongDate(lastDate)}` : ""}`
    : "Один раз";
  const confirmLabel = saving
    ? "Запись…"
    : needsAuth && selectedSlot
      ? "Войти и записаться"
      : partialOk
        ? `Забронировать ${preview.available_count} ${lessonWord(preview.available_count)}`
        : weekly && bookedCount > 1
          ? `Записаться на ${bookedCount} ${lessonWord(bookedCount)}`
          : "Подтвердить запись";
  const confirmHint = notStudent
    ? "Записаться можно только из аккаунта ученика."
    : notLinked
      ? (page?.not_linked_message || "Запись доступна ученикам этого преподавателя.")
      : waitingPreview
        ? "Проверяем доступность серии…"
        : validation
          ? (partialOk ? "Часть дат занята" : "Проверьте параметры записи")
          : !selectedSlot
            ? "Сначала выберите свободное время"
            : weekly && bookedCount > 1
              ? "Все даты серии будут забронированы"
              : "Одно занятие, без повторения";
  const summaryNote = weekly
    ? "Выбранное время будет закреплено за вами на все даты серии."
    : "Проверьте дату и время перед подтверждением записи.";
  const windowLabel = formatWindow(page?.date_from, page?.date_to);
  const maxUntil = selectedDate ? addDays(selectedDate, 366) : "";

  const helpDialog = (
    <dialog
      className="cb-bk-dialog"
      ref={helpRef}
      aria-labelledby="booking-help-title"
      onClick={(event) => {
        const rect = event.currentTarget.getBoundingClientRect();
        const outside = event.clientX < rect.left || event.clientX > rect.right
          || event.clientY < rect.top || event.clientY > rect.bottom;
        if (event.target === event.currentTarget && outside) event.currentTarget.close();
      }}
    >
      <div className="cb-bk-dialog-head">
        <h2 id="booking-help-title">Как работает запись</h2>
        <button type="button" className="cb-bk-icon-btn" onClick={closeHelp} aria-label="Закрыть">
          <BookingIcon name="close" />
        </button>
      </div>
      <p><strong>1. Выберите дату и время.</strong><br />Точки в календаре отмечают дни со свободным временем. Часы указаны по времени преподавателя.</p>
      <p><strong>2. Настройте повторение.</strong><br />Можно записаться на один урок или на серию по тому же дню недели. Для серии укажите дату окончания и раскройте все даты в итоге.</p>
      <p><strong>3. Проверьте и подтвердите.</strong><br />{page?.confirm_warning || "После подтверждения занятие появится в расписании. Если нужно изменить время, согласуйте это с преподавателем."}</p>
    </dialog>
  );

  if (loading && !page) {
    return (
      <div className="cb-booking-page">
        <BookingBrand />
        <div className="cb-bk-main">
          <div className="cb-bk-intro">
            <div>
              <div className="cb-bk-eyebrow">В удобном для вас ритме</div>
              <h1>Запись на занятие</h1>
              <p className="cb-bk-intro-copy">Выберите дату и время — остальное уже настроено.</p>
            </div>
          </div>
          <div className="cb-bk-card cb-bk-loading">Загрузка расписания…</div>
        </div>
      </div>
    );
  }

  if (!page) {
    const unavailableLead = !error || /не найдена|не действует|не удалось загрузить/i.test(error)
      ? "Похоже, эта ссылка больше не действует. Попросите актуальную ссылку у преподавателя."
      : error;
    return (
      <div className="cb-booking-page">
        <BookingBrand />
        <div className="cb-bk-state-wrap">
          <div className="cb-bk-state" role="status">
            <div className="cb-bk-state-icon" aria-hidden="true">
              <BookingIcon name="link" />
            </div>
            <h1>Запись недоступна</h1>
            <p>{unavailableLead}</p>
            <Link className="cb-bk-primary" to="/">На главную</Link>
          </div>
        </div>
      </div>
    );
  }

  if (doneBooking) {
    const donePreview = doneBooking.preview;
    const doneDates = (donePreview?.available_dates || []).map((item) => item.date);
    const many = doneDates.length > 1 || (donePreview?.available_count || 0) > 1;
    const count = donePreview?.available_count || doneDates.length || doneBooking.events_count || 1;
    const doneStart = hm(donePreview?.start_time || doneBooking.start_time);
    const doneEnd = hm(donePreview?.end_time || doneBooking.end_time);
    const doneFirst = donePreview?.first_date || doneBooking.first_date || doneBooking.date;
    const doneLast = doneDates[doneDates.length - 1] || donePreview?.recurrence?.until;
    const doneSubject = donePreview?.subject_label || page.subject_label || "Занятие";
    const doneDuration = slotDurationMinutes({ start_time: doneStart, end_time: doneEnd });
    return (
      <div className="cb-booking-page">
        <BookingBrand />
        <div className="cb-bk-main">
          <section className="cb-bk-success" aria-labelledby="booking-success-heading">
            <div className="cb-bk-success-mark" aria-hidden="true">
              <BookingIcon name="check" />
            </div>
            <h2 id="booking-success-heading" tabIndex={-1} ref={successHeadingRef}>
              {many ? `Вы записаны на ${count} ${lessonWord(count)}` : "Вы записаны на занятие"}
            </h2>
            <p>
              {many
                ? "Занятия будут проходить каждую неделю в выбранное время."
                : "Всё готово! Вот детали вашей записи."}
            </p>
            <div className="cb-bk-success-details">
              <div className="cb-bk-success-detail">
                <BookingIcon name="person" />
                <strong>{teacherName}{doneSubject ? ` · ${doneSubject}` : ""}</strong>
              </div>
              <div className="cb-bk-success-detail">
                <BookingIcon name="calendar" />
                <span>{capitalize(formatFullDate(doneFirst))}{many ? " · первое занятие" : ""}</span>
              </div>
              <div className="cb-bk-success-detail">
                <BookingIcon name="clock" />
                <span>{doneStart}{doneEnd ? `–${doneEnd}` : ""} · {timezoneCaption(donePreview?.timezone || page.timezone)}</span>
              </div>
              <div className="cb-bk-success-detail">
                <BookingIcon name="repeat" />
                <span>
                  {many && doneLast
                    ? `Каждую неделю, до ${formatLongDate(doneLast)}`
                    : `Один раз · ${doneDuration} ${minuteWord(doneDuration)}`}
                </span>
              </div>
            </div>
            {many ? (
              <ul className="cb-bk-success-list">
                {doneDates.map((date) => (
                  <li key={date}>
                    <span>{capitalize(formatFullDate(date))}</span>
                    <span>{doneStart}{doneEnd ? `–${doneEnd}` : ""}</span>
                  </li>
                ))}
              </ul>
            ) : null}
            <div className="cb-bk-success-actions">
              <Link className="cb-bk-primary" to="/cabinet/student/lessons">Перейти в расписание</Link>
              <button
                className="cb-bk-secondary"
                type="button"
                onClick={() => downloadBookingCalendar({
                  dates: doneDates.length ? doneDates : [doneFirst],
                  start: doneStart,
                  end: doneEnd,
                  timeZone: donePreview?.timezone || page.timezone,
                  subject: doneSubject,
                  teacherName,
                })}
              >
                <BookingIcon name="download" />
                Скачать для календаря
              </button>
            </div>
          </section>
          <footer className="cb-bk-page-foot">
            <span>© Цифровой поток · Учиться в своём ритме</span>
          </footer>
        </div>
      </div>
    );
  }

  return (
    <div className="cb-booking-page">
      <BookingBrand />
      <div className="cb-bk-main">
        <div className="cb-bk-intro">
          <div>
            <div className="cb-bk-eyebrow">В удобном для вас ритме</div>
            <h1>Запись на занятие</h1>
            <p className="cb-bk-intro-copy">Выберите дату и время — остальное уже настроено.</p>
          </div>
          <span className={`cb-bk-badge${dates.length ? "" : " is-closed"}`}>
            {dates.length ? "Запись открыта" : "Нет свободного времени"}
          </span>
        </div>

        <form className="cb-bk-card" onSubmit={handleConfirm} noValidate>
          <header className="cb-bk-teacher">
            <span className="cb-bk-avatar" aria-hidden="true">{initials(teacherName)}</span>
            <div>
              <h2 className="cb-bk-teacher-name">{teacherName}</h2>
              <p className="cb-bk-teacher-meta">
                Ваш преподаватель{page.subject_label ? ` · ${page.subject_label}` : ""}
              </p>
            </div>
            <div className="cb-bk-lesson-meta">
              <span><BookingIcon name="clock" />{duration} {minuteWord(duration)}</span>
              <span><BookingIcon name="video" />Онлайн</span>
            </div>
          </header>

          {needsAuth ? (
            <div className="cb-bk-notice">
              <p>{page.auth_required_message}</p>
              <button type="button" onClick={handleLogin}>Войти</button>
            </div>
          ) : null}
          {notStudent ? (
            <div className="cb-bk-notice">
              <p>Записаться можно только из аккаунта ученика.</p>
            </div>
          ) : null}
          {notLinked ? (
            <div className="cb-bk-notice">
              <p>{page.not_linked_message}</p>
            </div>
          ) : null}

          <div className="cb-bk-layout">
            <section className="cb-bk-scheduler" aria-label="Параметры записи">
              <div className="cb-bk-schedule">
                <section aria-labelledby="booking-date-heading">
                  <h2 className="cb-bk-step" id="booking-date-heading">
                    <span className="cb-bk-step-num" aria-hidden="true">1</span>
                    Выберите дату
                  </h2>
                  <div className="cb-bk-cal-head">
                    <div className="cb-bk-cal-title">
                      <button
                        type="button"
                        className="cb-bk-cal-nav"
                        disabled={!canPrevMonth}
                        aria-label="Предыдущий месяц"
                        onClick={() => shiftMonth(-1)}
                      >
                        <BookingIcon name="arrowLeft" />
                      </button>
                      <h3>{formatMonthLabel(viewMonth.year, viewMonth.month)}</h3>
                      <button
                        type="button"
                        className="cb-bk-cal-nav"
                        disabled={!canNextMonth}
                        aria-label="Следующий месяц"
                        onClick={() => shiftMonth(1)}
                      >
                        <BookingIcon name="arrow" />
                      </button>
                    </div>
                    {windowLabel ? <span className="cb-bk-cal-period">{windowLabel}</span> : null}
                  </div>
                  <table className="cb-bk-cal" onKeyDown={onCalendarKeyDown}>
                    <caption className="cb-bk-sr">
                      Выбор даты первого занятия, {formatMonthLabel(viewMonth.year, viewMonth.month)}
                    </caption>
                    <thead>
                      <tr>
                        {WEEKDAY_HEADS.map((day) => <th key={day} scope="col">{day}</th>)}
                      </tr>
                    </thead>
                    <tbody>
                      {rows.map((row) => (
                        <tr key={row[0].date}>
                          {row.map((cell) => {
                            const available = availableSet.has(cell.date);
                            const selected = selectedDate === cell.date;
                            const isToday = cell.date === todayIso();
                            const label = `${capitalize(formatFullDate(cell.date))}${
                              available ? ", есть свободное время" : ", запись недоступна"
                            }`;
                            return (
                              <td key={cell.date}>
                                <button
                                  type="button"
                                  className={[
                                    "cb-bk-day",
                                    cell.inMonth ? "" : "is-outside",
                                    available ? "is-available" : "",
                                    isToday ? "is-today" : "",
                                  ].filter(Boolean).join(" ")}
                                  data-date={cell.date}
                                  aria-label={label}
                                  aria-pressed={selected}
                                  aria-current={isToday ? "date" : undefined}
                                  disabled={!available}
                                  onClick={() => selectDate(cell.date)}
                                >
                                  {cell.day}
                                </button>
                              </td>
                            );
                          })}
                        </tr>
                      ))}
                    </tbody>
                  </table>
                  {dates.length ? <p className="cb-bk-legend">Есть свободное время</p> : null}
                  {page.date_from && page.date_to ? (
                    <p className="cb-bk-window">
                      Первое занятие можно выбрать с {formatLongDate(page.date_from)} по {formatLongDate(page.date_to)}.
                    </p>
                  ) : null}
                </section>

                <section aria-labelledby="booking-time-heading">
                  <h2 className="cb-bk-step" id="booking-time-heading">
                    <span className="cb-bk-step-num" aria-hidden="true">2</span>
                    Выберите время
                  </h2>
                  <div className="cb-bk-time-head">
                    <h3 className="cb-bk-time-date" id="booking-time-date">
                      {selectedDate ? formatDayHeading(selectedDate) : "Выберите дату"}
                    </h3>
                    <p className="cb-bk-tz">
                      <BookingIcon name="globe" />
                      {zoneLabel}
                    </p>
                  </div>
                  {dates.length === 0 || daySlots.length === 0 ? (
                    <div className="cb-bk-empty">
                      <BookingIcon name="calendar" />
                      <strong>
                        {dates.length === 0
                          ? "Свободного времени нет"
                          : "В этот день нет свободного времени"}
                      </strong>
                      <p>
                        {dates.length === 0
                          ? "Преподаватель ещё не открыл окна для записи."
                          : "Выберите другую дату в календаре."}
                      </p>
                      {dates.length > 0 ? (
                        <button className="cb-bk-text-btn" type="button" onClick={jumpNearest}>
                          Ближайшее свободное время
                        </button>
                      ) : null}
                    </div>
                  ) : (
                    <div
                      className="cb-bk-slots"
                      role="radiogroup"
                      aria-labelledby="booking-time-heading booking-time-date"
                    >
                      {daySlots.map((slot) => {
                        const active = selectedSlot?.date === slot.date && selectedSlot?.start_time === slot.start_time;
                        return (
                          <button
                            key={`${slot.date}-${slot.start_time}`}
                            type="button"
                            role="radio"
                            aria-checked={active}
                            className={`cb-bk-slot${active ? " is-selected" : ""}`}
                            onClick={() => selectSlot(slot)}
                          >
                            <span className="cb-bk-slot-face">
                              {hm(slot.start_time)}
                              <BookingIcon name="check" />
                            </span>
                          </button>
                        );
                      })}
                    </div>
                  )}
                  {daySlots.length > 0 && !selectedSlot ? (
                    <p className="cb-bk-slot-hint">
                      Показано время начала. Длительность каждого занятия — {duration} {minuteWord(duration)}.
                    </p>
                  ) : null}
                  {selectedSlot ? (
                    <div className="cb-bk-duration">
                      <BookingIcon name="clock" />
                      <span>{timeRange} · {duration} {minuteWord(duration)}</span>
                    </div>
                  ) : null}
                </section>
              </div>

              <section className="cb-bk-repeat" aria-labelledby="booking-repeat-heading">
                <div className="cb-bk-repeat-head">
                  <div>
                    <h2 className="cb-bk-repeat-title" id="booking-repeat-heading">Повторять занятие?</h2>
                    <p className="cb-bk-repeat-caption">Можно записаться на один урок или на серию.</p>
                  </div>
                  <div className="cb-bk-segmented" role="radiogroup" aria-labelledby="booking-repeat-heading">
                    <button
                      type="button"
                      role="radio"
                      className="cb-bk-segment"
                      aria-checked={repeat === "once"}
                      onClick={() => chooseRepeat("once")}
                    >
                      Один раз
                    </button>
                    <button
                      type="button"
                      role="radio"
                      className="cb-bk-segment"
                      aria-checked={weekly}
                      onClick={() => chooseRepeat("weekly")}
                    >
                      Каждую неделю
                    </button>
                  </div>
                </div>
                {weekly ? (
                  <div className="cb-bk-repeat-details">
                    <p className="cb-bk-repeat-explainer" id="booking-repeat-explainer">
                      По {selectedDate ? WEEKDAY_DATIVE[parseDay(selectedDate).getDay()] : "выбранным дням"}
                      {startLabel ? ` в ${startLabel}` : ""}
                      <small>В одно и то же время, до выбранной даты окончания.</small>
                    </p>
                    <div className="cb-bk-date-field">
                      <label htmlFor="booking-end-date">Последняя дата серии</label>
                      <input
                        id="booking-end-date"
                        type="date"
                        value={repeatUntil}
                        min={selectedDate || undefined}
                        max={maxUntil || undefined}
                        aria-describedby="booking-repeat-explainer"
                        aria-invalid={weeklyInvalid}
                        onChange={(event) => {
                          setRepeatUntil(event.target.value);
                          setFormError("");
                        }}
                      />
                    </div>
                  </div>
                ) : null}
                {validation ? (
                  <p className="cb-bk-validation" role="alert">{validation}</p>
                ) : null}
              </section>
            </section>

            <aside className="cb-bk-summary" aria-label="Итог записи">
              <h2 className="cb-bk-kicker">Ваша запись</h2>
              <div className="cb-bk-subject">
                <span className="cb-bk-subject-icon" aria-hidden="true">
                  <BookingIcon name="math" />
                </span>
                <div>
                  <strong>{subject}</strong>
                  <small>Индивидуальное занятие</small>
                </div>
              </div>
              <dl className="cb-bk-facts">
                <div className="cb-bk-fact">
                  <BookingIcon name="calendar" />
                  <div>
                    <dt>{weekly ? "Первое занятие" : "Дата занятия"}</dt>
                    <dd>{selectedDate ? formatFullDate(selectedDate) : "Выберите дату"}</dd>
                  </div>
                </div>
                <div className="cb-bk-fact">
                  <BookingIcon name="clock" />
                  <div>
                    <dt>Время</dt>
                    <dd className={timeRange ? "" : "is-pending"}>{timeRange || "Выберите время"}</dd>
                  </div>
                </div>
                <div className="cb-bk-fact">
                  <BookingIcon name="repeat" />
                  <div>
                    <dt>Повторение</dt>
                    <dd>{repeatText}</dd>
                  </div>
                </div>
              </dl>
              <div className="cb-bk-divider" />
              <p className="cb-bk-total">
                <span>Всего</span>
                <strong>{selectedSlot ? totalText : "Выберите время"}</strong>
              </p>
              {weekly && occurrenceDates.length > 0 ? (
                <details className="cb-bk-series">
                  <summary>
                    Даты всех занятий
                    <BookingIcon name="down" />
                  </summary>
                  <ol>
                    {occurrenceDates.map((date) => {
                      const conflict = Boolean(selectedSlot) && occupiedSet.has(date);
                      return (
                        <li key={date} className={conflict ? "is-conflict" : ""}>
                          <span>{formatLongDate(date)}</span>
                          <span>{conflict ? "Время занято" : (timeRange || "Время не выбрано")}</span>
                        </li>
                      );
                    })}
                  </ol>
                </details>
              ) : null}
              <p className="cb-bk-note">
                <BookingIcon name="info" />
                <span>{summaryNote}</span>
              </p>
              <div className="cb-bk-confirm">
                <div className="cb-bk-mobile-total">
                  {selectedDate ? formatLongDate(selectedDate) : "Дата не выбрана"}
                  <small>{timeRange ? `${timeRange} · ${zoneLabel}` : "Выберите время"}</small>
                </div>
                <button className="cb-bk-primary" type="submit" disabled={!ready || saving}>
                  <span>{confirmLabel}</span>
                  <BookingIcon name="arrow" />
                </button>
                <p className="cb-bk-hint">{confirmHint}</p>
              </div>
            </aside>
          </div>

          <footer className="cb-bk-foot">
            <p className="cb-bk-foot-info">
              <BookingIcon name="shield" />
              Время будет закреплено за вами после подтверждения.
            </p>
            <button className="cb-bk-text-btn" type="button" onClick={openHelp}>
              Как работает запись?
            </button>
          </footer>
        </form>

        <footer className="cb-bk-page-foot">
          <span>© Цифровой поток · Учиться в своём ритме</span>
        </footer>
      </div>
      {helpDialog}
      <div className="cb-bk-sr" aria-live="polite" aria-atomic="true">{announcement}</div>
    </div>
  );
}
