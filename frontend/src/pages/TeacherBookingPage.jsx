import { useEffect, useMemo, useRef, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { bookPublicSlot, fetchPublicBookingPage } from "../utils/cabinetAuth";
import { rememberReturnPath } from "../accessGate/accessGate";
import { usePageTitle } from "../cabinet/hooks/usePageTitle";
import CabinetIcon from "../cabinet/CabinetIcons";
import "../styles/teacher-booking.css";

const WEEKDAY_SHORT = ["пн", "вт", "ср", "чт", "пт", "сб", "вс"];

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

function initials(name) {
  const parts = String(name || "").trim().split(/\s+/).filter(Boolean);
  if (!parts.length) return "П";
  return parts.slice(0, 2).map((part) => part[0]).join("").toUpperCase();
}

function capitalize(value) {
  const text = String(value || "");
  return text ? text.charAt(0).toUpperCase() + text.slice(1) : "";
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

function formatMonthLabel(year, month) {
  const raw = new Date(year, month, 1).toLocaleDateString("ru-RU", {
    month: "long",
    year: "numeric",
  });
  return capitalize(raw);
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
  const [sh, sm] = slot.start_time.split(":").map(Number);
  const [eh, em] = slot.end_time.split(":").map(Number);
  const minutes = (eh * 60 + em) - (sh * 60 + sm);
  return minutes > 0 ? minutes : 60;
}

export default function TeacherBookingPage() {
  const { token } = useParams();
  const navigate = useNavigate();
  const now = new Date();
  const [page, setPage] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [selectedDate, setSelectedDate] = useState("");
  const [selectedSlot, setSelectedSlot] = useState(null);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const [doneBooking, setDoneBooking] = useState(null);
  const [viewMonth, setViewMonth] = useState({
    year: now.getFullYear(),
    month: now.getMonth(),
  });
  const monthReady = useRef(false);

  usePageTitle(page?.teacher?.name ? `Запись к ${page.teacher.name}` : "Запись на занятие");

  const load = () => {
    setLoading(true);
    setError("");
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
      })
      .catch((err) => {
        setError(err.message || "Не удалось загрузить расписание.");
        setPage(null);
      })
      .finally(() => setLoading(false));
  };

  useEffect(() => {
    monthReady.current = false;
    load();
  }, [token]);

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

  const returnPath = `/book/${token}`;
  const loginHref = `/cabinet/login?next=${encodeURIComponent(returnPath)}`;

  const needsAuth = Boolean(page && !page.authenticated);
  const notStudent = Boolean(page?.authenticated && page.role && page.role !== "student");
  const notLinked = Boolean(page?.authenticated && page.role === "student" && !page.linked);

  const handleLogin = () => {
    rememberReturnPath(returnPath);
    navigate(loginHref);
  };

  const handleSlotClick = (slot) => {
    setSelectedSlot(slot);
    setError("");
    if (needsAuth) {
      handleLogin();
      return;
    }
    if (notStudent || notLinked) return;
    setConfirmOpen(true);
  };

  const handleConfirm = async () => {
    if (!selectedSlot) return;
    setSaving(true);
    setError("");
    try {
      const data = await bookPublicSlot(token, {
        date: selectedSlot.date,
        start_time: selectedSlot.start_time,
      });
      setDoneBooking(data.booking);
      setConfirmOpen(false);
      setSelectedSlot(null);
      load();
    } catch (err) {
      setError(err.message || "Не удалось записаться.");
      if (err.code === "slot_taken") {
        setConfirmOpen(false);
        setSelectedSlot(null);
        load();
      }
    } finally {
      setSaving(false);
    }
  };

  const teacherName = page?.teacher?.name || "Преподаватель";

  if (loading) {
    return (
      <div className="cb-booking-page">
        <header className="cb-booking-header">
          <h1>Запись на занятие</h1>
          <p>Выберите удобную дату и свободное время</p>
        </header>
        <div className="cb-booking-empty">
          <p>Загрузка расписания…</p>
        </div>
      </div>
    );
  }

  if (!page) {
    const unavailableLead =
      !error || /не найдена|не действует|не удалось загрузить/i.test(error)
        ? "Похоже, эта ссылка больше не действует. Попросите актуальную ссылку у преподавателя."
        : error;

    return (
      <div className="cb-booking-page cb-booking-page--state">
        <div className="cb-booking-state" role="status">
          <div className="cb-booking-state__icon" aria-hidden="true">
            <CabinetIcon name="link" />
          </div>
          <h1 className="cb-booking-state__title">Запись недоступна</h1>
          <p className="cb-booking-state__text">{unavailableLead}</p>
          <div className="cb-booking-state__actions">
            <Link className="cb-booking-state__cta" to="/">
              На главную
            </Link>
          </div>
        </div>
      </div>
    );
  }

  if (doneBooking) {
    return (
      <div className="cb-booking-page">
        <div className="cb-booking-success cb-card">
          <CabinetIcon name="check" />
          <h2>Вы записаны</h2>
          <p>Занятие с {teacherName} запланировано на {formatDayHeading(doneBooking.first_date || doneBooking.date)} в {doneBooking.start_time}</p>
          <Link className="cb-btn cb-btn--primary" to="/cabinet/student/lessons">
            Перейти в расписание
          </Link>
        </div>
      </div>
    );
  }

  return (
    <div className="cb-booking-page">
      <header className="cb-booking-header">
        <h1>Запись на занятие</h1>
        <p>Выберите удобную дату и время</p>
      </header>

      <div className="cb-booking-teacher">
        <div className="cb-booking-teacher__avatar" aria-hidden="true">{initials(teacherName)}</div>
        <div className="cb-booking-teacher__info">
          <h2>{teacherName}</h2>
          {page.date_from && page.date_to ? (
            <p>Запись доступна с {formatLongDate(page.date_from)} по {formatLongDate(page.date_to)}</p>
          ) : null}
        </div>
      </div>

      {error ? (
        <div className="cb-booking-notice" role="alert">
          <p>{error}</p>
        </div>
      ) : null}
      {needsAuth ? (
        <div className="cb-booking-notice">
          <p>{page.auth_required_message}</p>
          <button type="button" className="cb-btn cb-btn--primary cb-btn--sm" onClick={handleLogin}>
            Войти
          </button>
        </div>
      ) : null}
      {notStudent ? (
        <div className="cb-booking-notice">
          <p>Записаться можно только из аккаунта ученика.</p>
        </div>
      ) : null}
      {notLinked ? (
        <div className="cb-booking-notice">
          <p>{page.not_linked_message}</p>
        </div>
      ) : null}

      <div className="cb-booking-grid">
        <div className="cb-card cb-booking-calendar">
          <div className="cb-booking-cal-head">
            <h3>{formatMonthLabel(viewMonth.year, viewMonth.month)}</h3>
            <div className="cb-booking-cal-nav">
              <button
                type="button"
                disabled={!canPrevMonth}
                aria-label="Предыдущий месяц"
                onClick={() => setViewMonth((prev) => {
                  const date = new Date(prev.year, prev.month - 1, 1);
                  return { year: date.getFullYear(), month: date.getMonth() };
                })}
              >
                <CabinetIcon name="arrowLeft" />
              </button>
              <button
                type="button"
                disabled={!canNextMonth}
                aria-label="Следующий месяц"
                onClick={() => setViewMonth((prev) => {
                  const date = new Date(prev.year, prev.month + 1, 1);
                  return { year: date.getFullYear(), month: date.getMonth() };
                })}
              >
                <CabinetIcon name="arrow" />
              </button>
            </div>
          </div>
          <div className="cb-booking-cal-grid" role="grid" aria-label="Календарь свободных дней">
            {WEEKDAY_SHORT.map((day) => (
              <div key={day} className="cb-booking-cal-wd">{day}</div>
            ))}
            {cells.map((cell) => {
              const available = availableSet.has(cell.date);
              const selected = selectedDate === cell.date;
              const isToday = cell.date === todayIso();
              return (
                <button
                  key={cell.date}
                  type="button"
                  role="gridcell"
                  aria-selected={selected}
                  disabled={!available}
                  className={[
                    "cb-booking-cal-day",
                    cell.inMonth ? "" : " is-outside",
                    available ? " is-available" : "",
                    selected ? " is-selected" : "",
                    isToday && !selected ? " is-today" : "",
                  ].join("")}
                  onClick={() => {
                    setSelectedDate(cell.date);
                    setSelectedSlot(null);
                  }}
                >
                  {cell.day}
                </button>
              );
            })}
          </div>
        </div>

        <div className="cb-card cb-booking-slots">
          <div className="cb-booking-slots-head">
            <h3>{selectedDate ? formatDayHeading(selectedDate) : "Выберите день"}</h3>
            <p>Доступное время</p>
          </div>

          {dates.length === 0 ? (
            <div className="cb-booking-empty">
              <CabinetIcon name="calendar" />
              <p>Свободных дней в опубликованном периоде нет.</p>
            </div>
          ) : daySlots.length === 0 ? (
            <div className="cb-booking-empty">
              <CabinetIcon name="calendar" />
              <p>На этот день свободного времени нет.<br />Выберите другую дату в календаре.</p>
            </div>
          ) : (
            <div className="cb-booking-slot-list">
              {daySlots.map((slot) => {
                const active = selectedSlot?.date === slot.date && selectedSlot?.start_time === slot.start_time;
                return (
                  <button
                    key={`${slot.date}-${slot.start_time}`}
                    type="button"
                    className={`cb-booking-slot${active ? " is-selected" : ""}`}
                    onClick={() => handleSlotClick(slot)}
                  >
                    {slot.start_time}
                  </button>
                );
              })}
            </div>
          )}
        </div>
      </div>

      {confirmOpen && selectedSlot ? (
        <div className="cb-sch-overlay" onClick={() => !saving && setConfirmOpen(false)} role="presentation">
          <div className="cb-sch-modal cb-sch-modal--appt" onClick={(ev) => ev.stopPropagation()} role="dialog" aria-labelledby="booking-confirm-title">
            <div className="cb-sch-modal__head">
              <h2 id="booking-confirm-title">Подтвердить запись</h2>
              <button type="button" className="cb-sch-popover__close" onClick={() => !saving && setConfirmOpen(false)} aria-label="Закрыть">
                <CabinetIcon name="close" />
              </button>
            </div>
            
            <div className="cb-booking-dialog-facts">
              <li>
                <CabinetIcon name="user" />
                {teacherName}
              </li>
              <li>
                <CabinetIcon name="calendar" />
                {formatDayHeading(selectedSlot.date)}
              </li>
              <li>
                <CabinetIcon name="clock" />
                {selectedSlot.start_time}–{selectedSlot.end_time} ({duration} мин)
              </li>
            </div>

            <p className="cb-booking-dialog-warning">{page.confirm_warning}</p>

            <div className="cb-sch-form__actions">
              <button type="button" className="cb-btn cb-btn--outline" onClick={() => setConfirmOpen(false)} disabled={saving}>
                Назад
              </button>
              <button type="button" className="cb-btn cb-btn--primary" onClick={handleConfirm} disabled={saving}>
                {saving ? "Запись…" : "Подтвердить запись"}
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}
