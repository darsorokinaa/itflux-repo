import { useEffect, useState } from "react";

/**
 * Модальное окно для ввода имени ученика перед скачиванием отчёта.
 */
export default function StudentNameModal({ open, onClose, onConfirm }) {
  const [name, setName] = useState("");

  useEffect(() => {
    if (!open) return;
    setName("");
    const handleKey = (e) => {
      if (e.key === "Escape") onClose();
    };
    document.addEventListener("keydown", handleKey);
    return () => document.removeEventListener("keydown", handleKey);
  }, [open, onClose]);

  if (!open) return null;

  const handleSubmit = (e) => {
    e.preventDefault();
    onConfirm(name.trim() || "Ученик");
    onClose();
  };

  return (
    <div className="results-modal-overlay" onClick={onClose}>
      <div className="results-modal-window" onClick={(e) => e.stopPropagation()}>
        <div className="results-modal-header">
          <h3 className="results-modal-title">Имя ученика</h3>
          <button
            type="button"
            className="results-modal-close"
            onClick={onClose}
            aria-label="Закрыть"
          >
            ×
          </button>
        </div>
        <form onSubmit={handleSubmit} className="results-modal-body student-name-form">
          <label htmlFor="student-name" className="results-label" style={{ display: "block", marginBottom: 8 }}>
            Введите имя ученика для отчёта
          </label>
          <input
            id="student-name"
            type="text"
            className="student-name-input"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="Имя ученика"
            autoFocus
          />
          <div className="student-name-actions">
            <button type="button" className="student-name-btn-cancel" onClick={onClose}>
              Отмена
            </button>
            <button type="submit" className="student-name-btn-ok">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" width="18" height="18">
                <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
                <polyline points="7 10 12 15 17 10" />
                <line x1="12" x2="12" y1="15" y2="3" />
              </svg>
              <span>Скачать отчёт</span>
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
