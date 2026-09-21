import { useEffect, useMemo, useRef, useState } from "react";
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

const RECURRENCE_OPTIONS = [
  { value: "none", label: "Не повторять" },
  { value: "daily", label: "Каждый день" },
  { value: "weekly", label: "Каждую неделю" },
  { value: "biweekly", label: "Каждые 2 недели" },
  { value: "monthly", label: "Каждый месяц" },
  { value: "weekdays", label: "По будням" },
  { value: "custom", label: "Настроить" },
];

const TRAVEL_PRESETS = [
  { value: 0, label: "Нет" },
  { value: 15, label: "15 минут" },
  { value: 30, label: "30 минут" },
  { value: 45, label: "45 минут" },
  { value: 60, label: "1 час" },
  { value: 90, label: "1 час 30 минут" },
  { value: "custom", label: "Другое" },
];

function formatApiDate(d) {
  if (typeof d === "string") return d.slice(0, 10);
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

function eventLocalParts(event) {
  if (!event?.startsAt) return { date: formatApiDate(new Date()), start: "10:00", end: "11:00" };
  const start = new Date(event.startsAt);
  const end = event.endsAt ? new Date(event.endsAt) : new Date(start.getTime() + 60 * 60 * 1000);
  const pad = (n) => String(n).padStart(2, "0");
  return {
    date: formatApiDate(start),
    start: `${pad(start.getHours())}:${pad(start.getMinutes())}`,
    end: `${pad(end.getHours())}:${pad(end.getMinutes())}`,
  };
}

function travelSelectValue(minutes) {
  const n = Number(minutes) || 0;
  if (TRAVEL_PRESETS.some((item) => item.value === n)) return n;
  return n ? "custom" : 0;
}

function formatConflictTime(iso) {
  if (!iso) return "";
  try {
    return new Date(iso).toLocaleString("ru-RU", {
      day: "numeric",
      month: "short",
      hour: "2-digit",
      minute: "2-digit",
    });
  } catch {
    return String(iso);
  }
}

export default function PersonalEventModal({
  onClose,
  onSave,
  onDelete,
  onSwitchToLesson,
  defaultDate,
  defaultStartTime,
  defaultEndTime,
  defaultTitle = "",
  event = null,
}) {
  const isEdit = Boolean(event?.id);
  const initial = eventLocalParts(event);
  const [title, setTitle] = useState(event?.title || defaultTitle || "");
  const [date, setDate] = useState(defaultDate || initial.date);
  const [startTime, setStartTime] = useState(defaultStartTime || initial.start);
  const [endTime, setEndTime] = useState(defaultEndTime || initial.end);
  const [allDay, setAllDay] = useState(Boolean(event?.allDay));
  const [description, setDescription] = useState(event?.description || "");
  const [location, setLocation] = useState(event?.location || "");
  const [travelBefore, setTravelBefore] = useState(travelSelectValue(event?.travelBeforeMinutes));
  const [travelAfter, setTravelAfter] = useState(travelSelectValue(event?.travelAfterMinutes));
  const [travelBeforeCustom, setTravelBeforeCustom] = useState(String(event?.travelBeforeMinutes || 15));
  const [travelAfterCustom, setTravelAfterCustom] = useState(String(event?.travelAfterMinutes || 15));
  const [recurrenceType, setRecurrenceType] = useState(event?.recurrence?.type || "none");
  const [interval, setInterval] = useState(String(event?.recurrence?.interval || 1));
  const [weekdays, setWeekdays] = useState(
    Array.isArray(event?.recurrence?.weekdays) && event.recurrence.weekdays.length
      ? event.recurrence.weekdays.map(Number)
      : [],
  );
  const [repeatUntil, setRepeatUntil] = useState(event?.recurrence?.until || "");
  const [repeatCount, setRepeatCount] = useState(event?.recurrence?.count ? String(event.recurrence.count) : "");
  const [repeatEndMode, setRepeatEndMode] = useState(event?.recurrence?.until ? "date" : event?.recurrence?.count ? "count" : "none");
  const [editScope, setEditScope] = useState("single");
  const [saving, setSaving] = useState(false);
  const savingRef = useRef(false);
  const [error, setError] = useState("");
  const [conflict, setConflict] = useState(null);

  const showTravel = !allDay;
  const recurring = Boolean(event?.seriesId || event?.isRecurring);

  useEffect(() => {
    if (defaultDate) setDate(defaultDate);
    if (defaultStartTime) setStartTime(defaultStartTime);
    if (defaultEndTime) setEndTime(defaultEndTime);
  }, [defaultDate, defaultStartTime, defaultEndTime]);

  const travelMinutes = (value, custom) => {
    if (value === "custom") return Math.max(0, Number(custom) || 0);
    return Number(value) || 0;
  };

  const toggleWeekday = (value) => {
    setWeekdays((prev) => (
      prev.includes(value) ? prev.filter((d) => d !== value) : [...prev, value].sort()
    ));
  };

  const buildPayload = (force = false) => {
    const payload = {
      title: title.trim() || "Личное дело",
      type: "personal",
      event_type: "personal",
      format: "offline",
      starts_at: `${date}T${allDay ? "00:00" : startTime}:00`,
      ends_at: `${date}T${allDay ? "23:59" : endTime}:00`,
      all_day: allDay,
      description: description.trim(),
      location: location.trim(),
      travel_before_minutes: showTravel ? travelMinutes(travelBefore, travelBeforeCustom) : 0,
      travel_after_minutes: showTravel ? travelMinutes(travelAfter, travelAfterCustom) : 0,
      visibility: "private",
      skip_plan: true,
      notify_participants: false,
      jitsi_auto_create: false,
      recurrence_type: isEdit ? undefined : recurrenceType,
      recurrence_interval: recurrenceType === "custom" ? Number(interval) || 1 : undefined,
      recurrence_weekdays: recurrenceType === "custom" ? weekdays : undefined,
      recurrence_until: !isEdit && repeatEndMode === "date" && repeatUntil ? repeatUntil : undefined,
      recurrence_count: !isEdit && repeatEndMode === "count" && repeatCount ? Number(repeatCount) : undefined,
      force,
      scope: isEdit ? editScope : undefined,
    };
    return payload;
  };

  const handleSubmit = async (e, force = false) => {
    e?.preventDefault?.();
    if (savingRef.current) return;
    setError("");
    setConflict(null);
    if (!allDay && startTime && endTime && endTime <= startTime) {
      setError("Время окончания должно быть позже начала.");
      return;
    }
    savingRef.current = true;
    setSaving(true);
    try {
      await onSave(buildPayload(force), event);
      onClose();
    } catch (err) {
      if (err.code === "schedule_conflict" || err.message?.includes("конфликт") || err.message?.includes("уже есть")) {
        setConflict(err.conflicts || true);
        setError("Есть конфликт расписания.");
      } else {
        setError(err.message || "Не удалось сохранить событие.");
      }
    } finally {
      savingRef.current = false;
      setSaving(false);
    }
  };

  const heading = title.trim() || (isEdit ? "Личное дело" : "Новое личное дело");

  if (typeof document === "undefined") return null;

  return createPortal(
    <div className="cb-sch-overlay" onClick={onClose} role="presentation">
      <div
        className="cb-sch-modal cb-sch-modal--wide"
        onClick={(ev) => ev.stopPropagation()}
        role="dialog"
        aria-labelledby="sch-personal-title"
      >
        <div className="cb-sch-modal__head">
          <h2 id="sch-personal-title">{heading}</h2>
          <button type="button" className="cb-sch-popover__close" onClick={onClose} aria-label="Закрыть">
            <CabinetIcon name="close" />
          </button>
        </div>
        <form className="cb-sch-form cb-sch-form--sections" onSubmit={(e) => handleSubmit(e, false)}>
          {error ? <p className="cb-sch-form__error" role="alert">{error}</p> : null}
          {conflict ? (
            <div className="cb-sch-form__conflict">
              <p><strong>Есть конфликт расписания</strong></p>
              {Array.isArray(conflict) && conflict.length ? (
                <ul className="cb-sch-form__conflict-list">
                  {conflict.flatMap((block) => (
                    (block.events || []).map((ev) => (
                      <li key={`${block.type}-${ev.id}`}>
                        {ev.starts_at ? `${formatConflictTime(ev.starts_at)} ` : ""}
                        {ev.title || "Занятие"}
                      </li>
                    ))
                  ))}
                </ul>
              ) : (
                <p>Это время пересекается с существующим занятием. Существующий урок не будет перенесён.</p>
              )}
              <p className="cb-sch-form__hint">
                Можно изменить время или сохранить с предупреждением. Интервал всё равно станет недоступен для новых записей учеников.
              </p>
              <button type="button" className="cb-btn cb-btn--outline cb-btn--sm" onClick={(e) => handleSubmit(e, true)}>
                Сохранить с предупреждением
              </button>
            </div>
          ) : null}

          <section className="cb-sch-form__section">
            <label className="cb-sch-field">
              <span>Тип</span>
              <select
                value="personal"
                onChange={(e) => {
                  if (e.target.value === "lesson") {
                    onSwitchToLesson?.({
                      date,
                      startTime,
                      endTime,
                      title: title.trim(),
                    });
                  }
                }}
                disabled={isEdit}
              >
                {!isEdit && onSwitchToLesson ? <option value="lesson">Урок</option> : null}
                <option value="personal">Личное дело</option>
              </select>
            </label>
            <label className="cb-sch-field">
              <span>Название</span>
              <input
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                placeholder="Университет"
                required
                autoFocus={!isEdit}
              />
            </label>
          </section>

          <section className="cb-sch-form__section">
            <h3>Время</h3>
            <label className="cb-sch-switch">
              <input type="checkbox" checked={allDay} onChange={(e) => setAllDay(e.target.checked)} />
              <span>Весь день</span>
            </label>
            <div className="cb-sch-form__row">
              <label className="cb-sch-field">
                <span>Дата</span>
                <input type="date" value={date} onChange={(e) => setDate(e.target.value)} required />
              </label>
              {!allDay ? (
                <>
                  <label className="cb-sch-field">
                    <span>Начало</span>
                    <input type="time" value={startTime} onChange={(e) => setStartTime(e.target.value)} />
                  </label>
                  <label className="cb-sch-field">
                    <span>Окончание</span>
                    <input type="time" value={endTime} onChange={(e) => setEndTime(e.target.value)} />
                  </label>
                </>
              ) : null}
            </div>
          </section>

          <section className="cb-sch-form__section">
            <label className="cb-sch-field">
              <span>Место</span>
              <input
                value={location}
                onChange={(e) => setLocation(e.target.value)}
                placeholder="МГТУ им. Баумана"
              />
            </label>
            <label className="cb-sch-field">
              <span>Описание / заметка</span>
              <textarea
                rows={3}
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                placeholder="Коротко, для себя"
              />
            </label>
          </section>

          {showTravel ? (
            <section className="cb-sch-form__section">
              <h3>Время на дорогу</h3>
              <p className="cb-sch-form__hint">
                Эти минуты автоматически блокируют запись учеников до и после события. Позже сюда можно будет подключить расчёт маршрута по карте.
              </p>
              <TravelField
                label="Дорога до события"
                value={travelBefore}
                custom={travelBeforeCustom}
                onValue={setTravelBefore}
                onCustom={setTravelBeforeCustom}
              />
              <TravelField
                label="Дорога после события"
                value={travelAfter}
                custom={travelAfterCustom}
                onValue={setTravelAfter}
                onCustom={setTravelAfterCustom}
              />
            </section>
          ) : null}

          {!isEdit ? (
            <section className="cb-sch-form__section">
              <h3>Повторение</h3>
              <label className="cb-sch-field">
                <span>Повторять</span>
                <select value={recurrenceType} onChange={(e) => setRecurrenceType(e.target.value)}>
                  {RECURRENCE_OPTIONS.map((opt) => (
                    <option key={opt.value} value={opt.value}>{opt.label}</option>
                  ))}
                </select>
              </label>
              {recurrenceType === "custom" ? (
                <>
                  <label className="cb-sch-field">
                    <span>Каждые N недель</span>
                    <input type="number" min="1" max="12" value={interval} onChange={(e) => setInterval(e.target.value)} />
                  </label>
                  <div className="cb-sch-field">
                    <span>Дни недели</span>
                    <div className="cb-sch-chip-list">
                      {WEEKDAYS.map((d) => (
                        <button
                          key={d.value}
                          type="button"
                          className={`cb-sch-chip ${weekdays.includes(d.value) ? "cb-sch-chip--active" : ""}`}
                          onClick={() => toggleWeekday(d.value)}
                        >
                          {d.label}
                        </button>
                      ))}
                    </div>
                  </div>
                </>
              ) : null}
              {recurrenceType !== "none" ? (
                <>
                  <label className="cb-sch-field">
                    <span>Окончание</span>
                    <select value={repeatEndMode} onChange={(e) => setRepeatEndMode(e.target.value)}>
                      <option value="none">Без даты окончания</option>
                      <option value="date">До выбранной даты</option>
                      <option value="count">Количество повторений</option>
                    </select>
                  </label>
                  {repeatEndMode === "date" ? (
                    <label className="cb-sch-field">
                      <span>Повторять до</span>
                      <input type="date" value={repeatUntil} onChange={(e) => setRepeatUntil(e.target.value)} />
                    </label>
                  ) : null}
                  {repeatEndMode === "count" ? (
                    <label className="cb-sch-field">
                      <span>Количество</span>
                      <input type="number" min="1" value={repeatCount} onChange={(e) => setRepeatCount(e.target.value)} />
                    </label>
                  ) : null}
                </>
              ) : null}
            </section>
          ) : null}

          {isEdit && recurring ? (
            <section className="cb-sch-form__section">
              <h3>Что изменить?</h3>
              <div className="cb-sch-chip-list">
                {[
                  { value: "single", label: "Только это событие" },
                  { value: "following", label: "Это и последующие" },
                  { value: "series", label: "Всю серию" },
                ].map((opt) => (
                  <button
                    key={opt.value}
                    type="button"
                    className={`cb-sch-chip ${editScope === opt.value ? "cb-sch-chip--active" : ""}`}
                    onClick={() => setEditScope(opt.value)}
                  >
                    {opt.label}
                  </button>
                ))}
              </div>
            </section>
          ) : null}

          <div className="cb-sch-modal__actions">
            {isEdit && onDelete ? (
              <button
                type="button"
                className="cb-btn cb-btn--danger"
                onClick={() => onDelete(event)}
                disabled={saving}
              >
                Удалить
              </button>
            ) : null}
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

function TravelField({ label, value, custom, onValue, onCustom }) {
  return (
    <div className="cb-sch-form__row">
      <label className="cb-sch-field">
        <span>{label}</span>
        <select value={value} onChange={(e) => onValue(e.target.value === "custom" ? "custom" : Number(e.target.value))}>
          {TRAVEL_PRESETS.map((opt) => (
            <option key={String(opt.value)} value={opt.value}>{opt.label}</option>
          ))}
        </select>
      </label>
      {value === "custom" ? (
        <label className="cb-sch-field">
          <span>Минут</span>
          <input type="number" min="1" max="720" value={custom} onChange={(e) => onCustom(e.target.value)} />
        </label>
      ) : null}
    </div>
  );
}
