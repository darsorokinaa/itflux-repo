import { useEffect, useState } from "react";
import CabinetIcon from "../CabinetIcons";
import SeriesScopeModal from "./SeriesScopeModal";
import {
  buildScheduleDateTimePayload,
  eventScheduleDate,
  normalizeTimeValue,
} from "../scheduleLessonUtils";

export default function EditScheduleLessonModal({ event, onClose, onSave }) {
  const [date, setDate] = useState(eventScheduleDate(event));
  const [startTime, setStartTime] = useState(normalizeTimeValue(event.startTime || "15:00"));
  const [endTime, setEndTime] = useState(normalizeTimeValue(event.endTime || "15:45"));
  const [link, setLink] = useState(event.link || "");
  const [notifyParticipants, setNotifyParticipants] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [scopeOpen, setScopeOpen] = useState(false);
  const [scopeTimeChanged, setScopeTimeChanged] = useState(false);

  useEffect(() => {
    setDate(eventScheduleDate(event));
    setStartTime(normalizeTimeValue(event.startTime || "15:00"));
    setEndTime(normalizeTimeValue(event.endTime || "15:45"));
    setLink(event.link || "");
  }, [event]);

  const buildPayload = () => ({
    title: (event.audience || event.title || "").trim(),
    ...buildScheduleDateTimePayload(date, startTime, endTime),
    telemost_url: link.trim(),
    link: link.trim(),
    notify_participants: notifyParticipants,
  });

  const eventTimesUnchanged = () => (
    date === eventScheduleDate(event)
    && normalizeTimeValue(startTime) === normalizeTimeValue(event.startTime || "15:00")
    && normalizeTimeValue(endTime) === normalizeTimeValue(event.endTime || "15:45")
  );

  const submitWithScope = async (scope) => {
    setSaving(true);
    setError("");
    try {
      await onSave({ ...buildPayload(), scope });
      setScopeOpen(false);
      onClose();
    } catch (err) {
      setScopeOpen(false);
      setError(err.message || "Не удалось сохранить изменения.");
    } finally {
      setSaving(false);
    }
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    const hasSeries = Boolean(event.seriesId || event.hasOrphanSeries || event.isRecurring);

    if (hasSeries) {
      setScopeTimeChanged(!eventTimesUnchanged());
      setScopeOpen(true);
      return;
    }

    setSaving(true);
    setError("");
    try {
      await onSave(buildPayload());
      onClose();
    } catch (err) {
      setError(err.message || "Не удалось сохранить изменения.");
    } finally {
      setSaving(false);
    }
  };

  return (
    <>
      {!scopeOpen ? (
      <div className="cb-sch-overlay" onClick={onClose} role="presentation">
        <div
          className="cb-sch-modal cb-sch-modal--wide"
          onClick={(ev) => ev.stopPropagation()}
          role="dialog"
          aria-labelledby="sch-edit-title"
        >
          <div className="cb-sch-modal__head">
            <h2 id="sch-edit-title">Изменить занятие</h2>
            <button type="button" className="cb-sch-popover__close" onClick={onClose} aria-label="Закрыть">
              <CabinetIcon name="close" />
            </button>
          </div>
          <form className="cb-sch-form cb-sch-form--sections" onSubmit={handleSubmit}>
            {error ? <p className="cb-sch-form__error" role="alert">{error}</p> : null}

            <section className="cb-sch-form__section">
              <h3>Занятие</h3>
              <p className="cb-sch-form__hint">
                {event.audience || event.title || "Участники не указаны"}
              </p>
            </section>

            <section className="cb-sch-form__section">
              <h3>Время</h3>
              <div className="cb-sch-form__row">
                <label className="cb-sch-field">
                  <span>Дата</span>
                  <input type="date" value={date} onChange={(e) => setDate(e.target.value)} required />
                </label>
                <label className="cb-sch-field">
                  <span>Начало</span>
                  <input type="time" value={startTime} onChange={(e) => setStartTime(e.target.value)} />
                </label>
                <label className="cb-sch-field">
                  <span>Окончание</span>
                  <input type="time" value={endTime} onChange={(e) => setEndTime(e.target.value)} />
                </label>
              </div>
            </section>

            <section className="cb-sch-form__section">
              <h3>Онлайн-встреча</h3>
              <label className="cb-sch-field">
                <span>Ссылка</span>
                <input
                  type="text"
                  inputMode="url"
                  value={link}
                  onChange={(e) => setLink(e.target.value)}
                  placeholder="https://…"
                />
              </label>
            </section>

            <section className="cb-sch-form__section">
              <h3>Уведомления</h3>
              <label className="cb-sch-check">
                <input
                  type="checkbox"
                  checked={notifyParticipants}
                  onChange={(e) => setNotifyParticipants(e.target.checked)}
                />
                <span>Уведомить участников</span>
              </label>
            </section>

            <div className="cb-sch-modal__actions">
              <button type="submit" className="cb-sch-btn cb-sch-btn--primary" disabled={saving}>
                {saving ? "Сохранение…" : "Сохранить"}
              </button>
              <button type="button" className="cb-sch-btn cb-sch-btn--outline" onClick={onClose}>Отмена</button>
            </div>
          </form>
        </div>
      </div>
      ) : null}

      {scopeOpen ? (
        <SeriesScopeModal
          onClose={() => setScopeOpen(false)}
          onConfirm={submitWithScope}
          saving={saving}
          timeChanged={scopeTimeChanged}
        />
      ) : null}
    </>
  );
}
