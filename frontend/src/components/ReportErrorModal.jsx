import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";

const ERROR_TYPES = [
  { value: "typo", label: "Опечатка", hint: "В тексте задания есть опечатка или лишний символ" },
  { value: "wrong_condition", label: "Неверное условие", hint: "Условие не сходится, противоречит логике" },
  { value: "wrong_answer", label: "Не сходится ответ", hint: "Получается другой результат, а проверка зачитывает чужой" },
  { value: "other", label: "Другое", hint: "Картинка не отображается, формула битая, что-то ещё" },
];

/**
 * Модальное окно для сообщения об ошибке в задании.
 */
export default function ReportErrorModal({ open, onClose, onSubmit, taskNumber }) {
  const [errorType, setErrorType] = useState("typo");
  const [comment, setComment] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;

  useEffect(() => {
    if (open) {
      setErrorType("typo");
      setComment("");
      setSubmitting(false);
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

  const handleSubmit = async (e) => {
    e.preventDefault();
    setSubmitting(true);
    try {
      await onSubmit?.({ errorType, comment: comment.trim() });
      onClose();
    } catch (err) {
      alert(err.message || "Не удалось отправить. Попробуйте позже.");
    } finally {
      setSubmitting(false);
    }
  };

  if (!open) return null;

  const activeType = ERROR_TYPES.find((t) => t.value === errorType);

  const modalContent = (
    <div className="results-modal-overlay report-error-overlay" onClick={onClose}>
      <div className="results-modal-window report-error-modal" onClick={(e) => e.stopPropagation()}>
        <div className="results-modal-header report-error-header">
          <div className="report-error-header__text">
            <span className="report-error-eyebrow">Обратная связь</span>
            <h3 className="results-modal-title report-error-title">
              Что не так с заданием
              {taskNumber != null ? (
                <>
                  {" "}
                  <span className="report-error-task-badge">№{taskNumber}</span>
                </>
              ) : null}
              ?
            </h3>
          </div>
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
            Поможем быстрее, если выберете тип ошибки. Комментарий — по желанию.
          </p>

          <fieldset className="report-error-types-fieldset">
            <legend className="report-error-legend">Тип ошибки</legend>
            <div className="report-error-types report-error-types--chips">
              {ERROR_TYPES.map((t) => {
                const checked = errorType === t.value;
                return (
                  <label
                    key={t.value}
                    className={`report-error-chip${checked ? " report-error-chip--active" : ""}`}
                  >
                    <input
                      type="radio"
                      name="report-error-type"
                      value={t.value}
                      checked={checked}
                      onChange={() => setErrorType(t.value)}
                    />
                    <span className="report-error-chip__label">{t.label}</span>
                  </label>
                );
              })}
            </div>
            {activeType ? (
              <p className="report-error-type-desc">{activeType.hint}</p>
            ) : null}
          </fieldset>

          <div className="report-error-field">
            <label htmlFor="report-error-comment" className="report-error-label">
              Комментарий <span className="report-error-label-meta">— необязательно</span>
            </label>
            <textarea
              id="report-error-comment"
              className="report-error-comment"
              value={comment}
              onChange={(e) => setComment(e.target.value)}
              placeholder="Например: на шаге 3 не сходится знак, или в условии написано «4», а должно быть «5»"
              rows={3}
              maxLength={1000}
            />
            <div className="report-error-counter">{comment.length}/1000</div>
          </div>

          <div className="report-error-actions">
            <button
              type="button"
              className="student-name-btn-cancel"
              onClick={onClose}
              disabled={submitting}
            >
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
