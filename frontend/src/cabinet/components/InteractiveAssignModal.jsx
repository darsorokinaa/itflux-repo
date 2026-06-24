import { useState } from "react";
import CabinetModal from "./CabinetModal";

// Списки учеников/групп загружаются из реального API при открытии
const ATTACH_STUDENTS = [];
const ATTACH_GROUPS = [];

export default function InteractiveAssignModal({ interactive, onClose, onAssign }) {
  const [targetType, setTargetType] = useState("student");
  const [targetId, setTargetId] = useState("");
  const [deadline, setDeadline] = useState("");
  const [attempts, setAttempts] = useState("multiple");
  const [showResult, setShowResult] = useState("yes");
  const [comment, setComment] = useState("");

  const targets = targetType === "student" ? ATTACH_STUDENTS : ATTACH_GROUPS;

  const handleSubmit = (e) => {
    e.preventDefault();
    onAssign?.({
      interactiveId: interactive?.id,
      targetType,
      targetId,
      deadline,
      attempts,
      showResult: showResult === "yes",
      comment,
    });
    onClose();
  };

  return (
    <CabinetModal title="Выдать интерактив" onClose={onClose}>
      {interactive ? (
        <p className="cb-modal__hint">
          «{interactive.title || "Без названия"}» · {interactive.topic || "без темы"}
        </p>
      ) : null}
      <form className="cb-assign-form" onSubmit={handleSubmit}>
        <label className="cb-field">
          <span>Кому выдать</span>
          <select value={targetType} onChange={(e) => { setTargetType(e.target.value); setTargetId(""); }}>
            <option value="student">Ученик</option>
            <option value="group">Группа</option>
          </select>
        </label>
        <label className="cb-field">
          <span>{targetType === "student" ? "Выберите ученика" : "Выберите группу"}</span>
          <select value={targetId} onChange={(e) => setTargetId(e.target.value)} required>
            <option value="">—</option>
            {targets.map((t) => (
              <option key={t.id} value={t.id}>{t.label}</option>
            ))}
          </select>
        </label>
        <label className="cb-field">
          <span>Срок выполнения</span>
          <input type="date" value={deadline} onChange={(e) => setDeadline(e.target.value)} />
        </label>
        <label className="cb-field">
          <span>Попытки</span>
          <select value={attempts} onChange={(e) => setAttempts(e.target.value)}>
            <option value="single">Одна</option>
            <option value="multiple">Несколько</option>
          </select>
        </label>
        <label className="cb-field">
          <span>Показывать результат</span>
          <select value={showResult} onChange={(e) => setShowResult(e.target.value)}>
            <option value="yes">Да</option>
            <option value="no">Нет</option>
          </select>
        </label>
        <label className="cb-field cb-field--wide">
          <span>Комментарий учителя</span>
          <textarea rows={3} value={comment} onChange={(e) => setComment(e.target.value)} />
        </label>
        <div className="cb-assign-form__actions">
          <button type="button" className="cb-btn cb-btn--outline" onClick={onClose}>Отмена</button>
          <button type="submit" className="cb-btn cb-btn--primary cb-btn--pill">Выдать</button>
        </div>
      </form>
    </CabinetModal>
  );
}
