import { createPortal } from "react-dom";
import CabinetIcon from "../CabinetIcons";

const MONTHS = [
  "января", "февраля", "марта", "апреля", "мая", "июня",
  "июля", "августа", "сентября", "октября", "ноября", "декабря",
];

export default function AvailabilityDetailPopover({ event, onClose, onDelete }) {
  if (typeof document === "undefined") return null;
  
  const dateObj = new Date(event.startsAt);
  const dateStr = `${dateObj.getDate()} ${MONTHS[dateObj.getMonth()]}`;

  return createPortal(
    <div className="cb-sch-overlay" onClick={onClose} role="presentation">
      <div
        className="cb-sch-modal cb-sch-modal--appt cb-sch-modal--appt-sm"
        onClick={(ev) => ev.stopPropagation()}
        role="dialog"
        aria-labelledby="avail-detail-title"
      >
        <div className="cb-sch-modal__head">
          <h2 id="avail-detail-title">Доступно для записи</h2>
          <button type="button" className="cb-sch-popover__close" onClick={onClose} aria-label="Закрыть">
            <CabinetIcon name="close" />
          </button>
        </div>
        <div className="cb-sch-form">
          <p className="cb-sch-appt-time">{dateStr} · {event.startTime}–{event.endTime}</p>
          <div className="cb-sch-form__actions">
            {event.availabilityId && onDelete ? (
              <button type="button" className="cb-btn cb-btn--danger" onClick={() => onDelete(event)}>
                Удалить
              </button>
            ) : null}
            <button type="button" className="cb-btn cb-btn--outline" onClick={onClose}>
              Изменить
            </button>
          </div>
        </div>
      </div>
    </div>,
    document.body,
  );
}
