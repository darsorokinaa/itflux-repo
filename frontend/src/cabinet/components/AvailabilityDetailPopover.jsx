import { createPortal } from "react-dom";
import CabinetIcon from "../CabinetIcons";

const MONTHS = [
  "января", "февраля", "марта", "апреля", "мая", "июня",
  "июля", "августа", "сентября", "октября", "ноября", "декабря",
];
const WEEKDAYS = [
  "понедельник", "вторник", "среда", "четверг", "пятница", "суббота", "воскресенье",
];

function formatDayLabel(event) {
  if (!event?.startsAt) return "";
  const dateObj = new Date(event.startsAt);
  const wd = WEEKDAYS[(dateObj.getDay() + 6) % 7];
  return `${wd.charAt(0).toUpperCase()}${wd.slice(1)}, ${dateObj.getDate()} ${MONTHS[dateObj.getMonth()]}`;
}

export default function AvailabilityDetailPopover({
  event,
  onClose,
  onDelete,
  onCreateLesson,
}) {
  if (typeof document === "undefined") return null;

  return createPortal(
    <div className="cb-sch-overlay" onClick={onClose} role="presentation">
      <div
        className="cb-sch-modal cb-sch-modal--appt cb-sch-modal--appt-sm cb-sch-avail-popover"
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
          <p className="cb-sch-appt-time">
            {formatDayLabel(event)}
            <br />
            {event.startTime}–{event.endTime}
          </p>
          <div className="cb-sch-form__actions cb-sch-avail-popover__actions">
            {onCreateLesson ? (
              <button type="button" className="cb-btn cb-btn--outline" onClick={onCreateLesson}>
                Создать урок
              </button>
            ) : null}
            {event.availabilityId && onDelete ? (
              <button type="button" className="cb-btn cb-btn--danger" onClick={() => onDelete(event)}>
                Удалить
              </button>
            ) : null}
            <button type="button" className="cb-btn cb-btn--ghost" onClick={onClose}>
              Закрыть
            </button>
          </div>
        </div>
      </div>
    </div>,
    document.body,
  );
}
