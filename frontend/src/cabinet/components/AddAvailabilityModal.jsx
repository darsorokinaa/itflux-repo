import { useMemo, useState } from "react";
import { createPortal } from "react-dom";
import CabinetIcon from "../CabinetIcons";

const WEEKDAYS = [
  { value: 0, label: "Пн" },
  { value: 1, label: "Вт" },
  { value: 2, label: "Ср" },
  { value: 3, label: "Чт" },
  { value: 4, label: "Пт" },
  { value: 5, label: "Сб" },
  { value: 6, label: "Вс" },
];

const DURATION_OPTIONS = [30, 45, 60, 90];

function formatApiDate(d) {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

function addDays(date, days) {
  const next = new Date(date);
  next.setDate(next.getDate() + days);
  return next;
}

function startOfWeek(date) {
  const d = new Date(date);
  d.setHours(0, 0, 0, 0);
  const day = (d.getDay() + 6) % 7;
  d.setDate(d.getDate() - day);
  return d;
}

export default function AddAvailabilityModal({
  onClose,
  onSave,
  defaultDate,
  defaultStartTime = "15:00",
  defaultEndTime = "18:00",
  defaultDuration = 60,
}) {
  const today = formatApiDate(new Date());
  const [mode, setMode] = useState("range");
  const [dateFrom, setDateFrom] = useState(defaultDate || today);
  const [dateTo, setDateTo] = useState(defaultDate || today);
  const [datesText, setDatesText] = useState(defaultDate || today);
  const [weekdays, setWeekdays] = useState([]);
  const [startTime, setStartTime] = useState(defaultStartTime);
  const [endTime, setEndTime] = useState(defaultEndTime);
  const [duration, setDuration] = useState(defaultDuration);
  const [customDuration, setCustomDuration] = useState("");
  const [extraStart, setExtraStart] = useState("");
  const [extraEnd, setExtraEnd] = useState("");
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);

  const durationValue = useMemo(() => {
    if (customDuration) {
      const parsed = Number(customDuration);
      return Number.isFinite(parsed) ? parsed : duration;
    }
    return duration;
  }, [customDuration, duration]);

  const applyPreset = (preset) => {
    const now = new Date();
    if (preset === "today") {
      setMode("range");
      setDateFrom(today);
      setDateTo(today);
      return;
    }
    if (preset === "next-week") {
      const nextMon = addDays(startOfWeek(now), 7);
      setMode("range");
      setDateFrom(formatApiDate(nextMon));
      setDateTo(formatApiDate(addDays(nextMon, 6)));
      setWeekdays([0, 1, 2, 3, 4]);
      return;
    }
    if (preset === "week") {
      const mon = startOfWeek(now);
      setMode("range");
      setDateFrom(formatApiDate(mon));
      setDateTo(formatApiDate(addDays(mon, 6)));
    }
  };

  const toggleWeekday = (value) => {
    setWeekdays((prev) => (
      prev.includes(value) ? prev.filter((item) => item !== value) : [...prev, value]
    ));
  };

  const handleSubmit = async (event) => {
    event.preventDefault();
    setError("");
    const payload = {
      start_time: startTime,
      end_time: endTime,
      slot_duration_minutes: durationValue,
    };
    if (extraStart && extraEnd) {
      payload.intervals = [{ start_time: extraStart, end_time: extraEnd }];
    }
    if (mode === "dates") {
      payload.dates = datesText.split(/[,\s]+/).map((item) => item.trim()).filter(Boolean);
      if (!payload.dates.length) {
        setError("Укажите хотя бы одну дату.");
        return;
      }
    } else {
      payload.date_from = dateFrom;
      payload.date_to = dateTo;
      if (weekdays.length) payload.weekdays = weekdays;
    }
    setSaving(true);
    try {
      await onSave(payload);
    } catch (err) {
      setError(err.message || "Не удалось сохранить свободное время.");
    } finally {
      setSaving(false);
    }
  };

  if (typeof document === "undefined") return null;

  return createPortal(
    <div className="cb-sch-overlay" onClick={onClose} role="presentation">
      <div
        className="cb-sch-modal cb-sch-modal--appt"
        onClick={(ev) => ev.stopPropagation()}
        role="dialog"
        aria-labelledby="avail-create-title"
      >
        <div className="cb-sch-modal__head">
          <h2 id="avail-create-title">Свободное время</h2>
          <button type="button" className="cb-sch-popover__close" onClick={onClose} aria-label="Закрыть">
            <CabinetIcon name="close" />
          </button>
        </div>
        <p className="cb-sch-modal__lead">
          Ученики увидят эти интервалы и смогут закрепить постоянное время занятий.
        </p>
        <form className="cb-sch-form cb-sch-form--sections" onSubmit={handleSubmit}>
          {error ? <p className="cb-sch-form__error" role="alert">{error}</p> : null}

          <div className="cb-sch-form__section">
            <h3>Когда</h3>
            <div className="cb-sch-chip-list">
              <button type="button" className="cb-sch-chip" onClick={() => applyPreset("today")}>Сегодня</button>
              <button type="button" className="cb-sch-chip" onClick={() => applyPreset("week")}>Эта неделя</button>
              <button type="button" className="cb-sch-chip" onClick={() => applyPreset("next-week")}>Следующая неделя</button>
            </div>
            <div className="cb-sch-chip-list">
              <button
                type="button"
                className={`cb-sch-chip${mode === "range" ? " cb-sch-chip--active" : ""}`}
                onClick={() => setMode("range")}
              >
                Период
              </button>
              <button
                type="button"
                className={`cb-sch-chip${mode === "dates" ? " cb-sch-chip--active" : ""}`}
                onClick={() => setMode("dates")}
              >
                Конкретные дни
              </button>
            </div>
            {mode === "range" ? (
              <div className="cb-sch-form__row cb-sch-form__row--2">
                <label className="cb-sch-field">
                  <span>С</span>
                  <input type="date" value={dateFrom} onChange={(e) => setDateFrom(e.target.value)} required />
                </label>
                <label className="cb-sch-field">
                  <span>По</span>
                  <input type="date" value={dateTo} onChange={(e) => setDateTo(e.target.value)} required />
                </label>
              </div>
            ) : (
              <label className="cb-sch-field">
                <span>Даты через запятую</span>
                <input
                  value={datesText}
                  onChange={(e) => setDatesText(e.target.value)}
                  placeholder="2026-09-07, 2026-09-09"
                />
              </label>
            )}
          </div>

          {mode === "range" ? (
            <div className="cb-sch-form__section">
              <h3>Дни недели</h3>
              <p className="cb-sch-form__hint">Если не выбрать, откроются все дни периода</p>
              <div className="cb-sch-weekdays">
                {WEEKDAYS.map((day) => (
                  <button
                    key={day.value}
                    type="button"
                    className={`cb-sch-weekday${weekdays.includes(day.value) ? " cb-sch-weekday--active" : ""}`}
                    onClick={() => toggleWeekday(day.value)}
                  >
                    {day.label}
                  </button>
                ))}
              </div>
            </div>
          ) : null}

          <div className="cb-sch-form__section">
            <h3>Время</h3>
            <div className="cb-sch-form__row cb-sch-form__row--2">
              <label className="cb-sch-field">
                <span>Начало</span>
                <input type="time" value={startTime} onChange={(e) => setStartTime(e.target.value)} required />
              </label>
              <label className="cb-sch-field">
                <span>Окончание</span>
                <input type="time" value={endTime} onChange={(e) => setEndTime(e.target.value)} required />
              </label>
            </div>
            <label className="cb-sch-field">
              <span>Дополнительный интервал</span>
              <div className="cb-sch-form__row cb-sch-form__row--2">
                <input type="time" value={extraStart} onChange={(e) => setExtraStart(e.target.value)} />
                <input type="time" value={extraEnd} onChange={(e) => setExtraEnd(e.target.value)} />
              </div>
            </label>
          </div>

          <div className="cb-sch-form__section">
            <h3>Длительность занятия</h3>
            <div className="cb-sch-chip-list">
              {DURATION_OPTIONS.map((item) => (
                <button
                  key={item}
                  type="button"
                  className={`cb-sch-chip${!customDuration && duration === item ? " cb-sch-chip--active" : ""}`}
                  onClick={() => {
                    setDuration(item);
                    setCustomDuration("");
                  }}
                >
                  {item} мин
                </button>
              ))}
              <input
                className="cb-sch-chip-input"
                type="number"
                min="15"
                max="240"
                placeholder="Другое"
                value={customDuration}
                onChange={(e) => setCustomDuration(e.target.value)}
              />
            </div>
          </div>

          <div className="cb-sch-form__actions">
            <button type="button" className="cb-btn cb-btn--outline" onClick={onClose} disabled={saving}>
              Отмена
            </button>
            <button type="submit" className="cb-btn cb-btn--primary" disabled={saving}>
              {saving ? "Сохранение…" : "Сохранить"}
            </button>
          </div>
        </form>
      </div>
    </div>,
    document.body,
  );
}
