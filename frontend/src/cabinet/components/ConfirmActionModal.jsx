import CabinetModal from "./CabinetModal";

/**
 * Универсальное подтверждение действия в кабинете.
 * Не путать с локальным ConfirmActionModal в расписании (серии/перенос).
 */
export default function ConfirmActionModal({
  open,
  title = "Подтвердите действие",
  text,
  confirmLabel = "Подтвердить",
  cancelLabel = "Отмена",
  secondaryConfirmLabel,
  danger = false,
  loading = false,
  confirmDisabled = false,
  onConfirm,
  onSecondaryConfirm,
  onClose,
}) {
  if (!open) return null;

  return (
    <CabinetModal
      title={title}
      onClose={loading ? undefined : onClose}
      footer={(
        <>
          <button
            type="button"
            className="cb-btn cb-btn--secondary"
            onClick={onClose}
            disabled={loading}
          >
            {cancelLabel}
          </button>
          {secondaryConfirmLabel && onSecondaryConfirm ? (
            <button
              type="button"
              className="cb-btn cb-btn--ghost"
              onClick={onSecondaryConfirm}
              disabled={loading || confirmDisabled}
            >
              {secondaryConfirmLabel}
            </button>
          ) : null}
          <button
            type="button"
            className={`cb-btn ${danger ? "cb-btn--danger" : "cb-btn--primary"}`}
            onClick={onConfirm}
            disabled={loading || confirmDisabled}
          >
            {loading ? "Выполняем…" : confirmLabel}
          </button>
        </>
      )}
    >
      {typeof text === "string" ? <p className="cb-confirm-text">{text}</p> : text}
    </CabinetModal>
  );
}
