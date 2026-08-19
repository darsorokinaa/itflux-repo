import { createPortal } from "react-dom";

export default function MaterialDemoWarningModal({
  open,
  onCancel,
  onConfirm,
  submitting = false,
  durationMinutes = 40,
}) {
  if (!open || typeof document === "undefined") return null;
  return createPortal(
    <div
      className="material-demo-warning-overlay"
      role="presentation"
      onClick={(event) => {
        if (event.target === event.currentTarget && !submitting) onCancel();
      }}
    >
      <div
        className="material-demo-warning"
        role="dialog"
        aria-modal="true"
        aria-labelledby="material-demo-warning-title"
        onClick={(event) => event.stopPropagation()}
      >
        <h2 id="material-demo-warning-title">Демоверсия урока</h2>
        <p>
          После запуска у вас будет <strong>{durationMinutes} минут</strong> доступа к
          демоверсии.
        </p>
        <p>
          В течение этих {durationMinutes} минут вы можете закрывать и снова открывать материал{" "}
          <strong>неограниченное количество раз</strong>. Таймер при этом не сбрасывается и
          продолжает отсчитываться от момента первого запуска.
        </p>
        <p>Материалы доступны только внутри платформы. Скачивание файлов в деморежиме недоступно.</p>
        <p className="material-demo-warning__emphasis">
          Копирование, сохранение и распространение материалов демоверсии запрещено.
        </p>
        <div className="material-demo-warning__actions">
          <button
            type="button"
            className="material-access-btn material-access-btn--ghost"
            onClick={onCancel}
            disabled={submitting}
          >
            Отмена
          </button>
          <button
            type="button"
            className="material-access-btn material-access-btn--primary"
            onClick={onConfirm}
            disabled={submitting}
          >
            {submitting ? "Запускаем…" : `Запустить демоверсию на ${durationMinutes} минут`}
          </button>
        </div>
      </div>
    </div>,
    document.body,
  );
}
