import { useState } from "react";
import { createPortal } from "react-dom";
import CabinetIcon from "../CabinetIcons";

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

export default function ShareScheduleModal({
  onClose,
  onPublish,
  link,
}) {
  const today = formatApiDate(new Date());
  const nextWeekEnd = formatApiDate(addDays(startOfWeek(new Date()), 13));
  const [dateFrom, setDateFrom] = useState(link?.date_from || today);
  const [dateTo, setDateTo] = useState(link?.date_to || nextWeekEnd);
  const [copied, setCopied] = useState(false);
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);
  const url = link?.url || "";
  const isOpen = link?.is_active !== false && Boolean(url);

  const copyLink = async () => {
    if (!url) return;
    try {
      await navigator.clipboard.writeText(url);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 2000);
    } catch {
      setError("Не удалось скопировать ссылку.");
    }
  };

  const handleSubmit = async (event) => {
    event.preventDefault();
    setError("");
    setSaving(true);
    try {
      await onPublish({ date_from: dateFrom, date_to: dateTo, is_active: true });
    } catch (err) {
      setError(err.message || "Не удалось открыть запись.");
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
        aria-labelledby="avail-share-title"
      >
        <div className="cb-sch-modal__head">
          <h2 id="avail-share-title">Запись для учеников</h2>
          <button type="button" className="cb-sch-popover__close" onClick={onClose} aria-label="Закрыть">
            <CabinetIcon name="close" />
          </button>
        </div>
        <p className="cb-sch-modal__lead">
          Ученики смогут видеть свободное время и записываться на занятия
        </p>
        <form className="cb-sch-form cb-sch-form--sections" onSubmit={handleSubmit}>
          {error ? <p className="cb-sch-form__error" role="alert">{error}</p> : null}
          <div className="cb-sch-form__section">
            <h3>Период</h3>
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
          </div>
          {url ? (
            <div className="cb-sch-form__section">
              <h3>Ссылка для учеников</h3>
              <div className="cb-sch-link-row">
                <input value={url} readOnly aria-label="Ссылка для учеников" />
                <button type="button" className="cb-btn cb-btn--outline" onClick={copyLink}>
                  {copied ? "Ссылка скопирована" : "Скопировать ссылку"}
                </button>
              </div>
            </div>
          ) : null}
          <div className="cb-sch-form__actions">
            <button type="button" className="cb-btn cb-btn--outline" onClick={onClose}>
              Закрыть
            </button>
            <button type="submit" className="cb-btn cb-btn--primary" disabled={saving}>
              {saving ? "Сохранение…" : isOpen ? "Изменить период" : "Открыть запись"}
            </button>
          </div>
        </form>
      </div>
    </div>,
    document.body,
  );
}
