import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";

/**
 * Модальное окно для сообщения об ошибке в задании.
 */
export default function ReportErrorModal({ open, onClose, onSubmit, taskNumber }) {
  const [comment, setComment] = useState("");
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;

  // Сброс формы только при открытии (не при каждом ре-рендере родителя)
  useEffect(() => {
    if (open) {
      setComment("");
    }
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const handleKey = (e) => {
      if (e.key === "Escape") onCloseRef.current();
    };
    document.addEventListener("keydown", handleKey);
    return () => document.removeEventListener("keydown", handleKey);
  }, [open]);

  const [submitting, setSubmitting] = useState(false);
  const handleSubmit = async (e) => {
    e.preventDefault();
    setSubmitting(true);
    try {
      await onSubmit?.({ errorType: "other", comment: comment.trim() });
      onClose();
    } catch (err) {
      alert(err.message || "Не удалось отправить. Попробуйте позже.");
    } finally {
      setSubmitting(false);
    }
  };

  if (!open) return null;

  const modalContent = (
    <div className="results-modal-overlay report-error-overlay" onClick={onClose}>
      <div className="results-modal-window report-error-modal" onClick={(e) => e.stopPropagation()}>
        <div className="results-modal-header">
          <h3 className="results-modal-title">
            Сообщить об ошибке{taskNumber != null ? ` (задание ${taskNumber})` : ""}
          </h3>
          <button
            type="button"
            className="results-modal-close"
            onClick={onClose}
            aria-label="Закрыть"
          >
            ×
          </button>
        </div>
        <form onSubmit={handleSubmit} className="report-error-form">
          <p className="report-error-hint">
            Используйте эту кнопку только если нашли ошибку в самом задании: опечатку, неверное условие или неправильный ответ в базе. Если вы не уверены в своём решении — попробуйте разобрать задание ещё раз.
          </p>

          <div className="report-error-field">
            <label htmlFor="report-error-comment" className="report-error-label">
              Комментарий (необязательно)
            </label>
            <textarea
              id="report-error-comment"
              className="report-error-comment"
              value={comment}
              onChange={(e) => setComment(e.target.value)}
              placeholder="Опишите ошибку подробнее, если нужно"
              rows={3}
            />
          </div>

          <div className="report-error-actions">
            <button type="button" className="student-name-btn-cancel" onClick={onClose}>
              Отмена
            </button>
            <button
              type="submit"
              className="student-name-btn-ok report-error-submit"
              disabled={submitting}
            >
              {submitting ? "Отправка…" : "Отправить"}
            </button>
          </div>
        </form>
      </div>
    </div>
  );

  return createPortal(modalContent, document.body);
}
