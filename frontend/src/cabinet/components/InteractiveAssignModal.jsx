import { useEffect, useState } from "react";
import { getInteractiveDisplayTitle } from "../interactivesData";
import { fetchGroups, fetchStudents } from "../../utils/cabinetAuth";
import CabinetModal from "./CabinetModal";

export default function InteractiveAssignModal({ interactive, onClose, onAssign }) {
  const [targetType, setTargetType] = useState("student");
  const [targetId, setTargetId] = useState("");
  const [deadline, setDeadline] = useState("");
  const [attempts, setAttempts] = useState("multiple");
  const [showResult, setShowResult] = useState("yes");
  const [comment, setComment] = useState("");
  const [students, setStudents] = useState([]);
  const [groups, setGroups] = useState([]);
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    Promise.all([
      fetchStudents({ status: "active" }),
      fetchGroups({ status: "active" }),
    ])
      .then(([studentsData, groupsData]) => {
        if (cancelled) return;
        const studentList = Array.isArray(studentsData) ? studentsData : (studentsData?.results || []);
        const groupList = Array.isArray(groupsData) ? groupsData : (groupsData?.results || []);
        setStudents(studentList.map((s) => ({
          id: s.id,
          label: [s.last_name, s.first_name].filter(Boolean).join(" ") || s.display_name || `Ученик #${s.id}`,
        })));
        setGroups(groupList.map((g) => ({
          id: g.id,
          label: g.name || g.title || `Группа #${g.id}`,
        })));
      })
      .catch((err) => {
        if (!cancelled) setError(err?.message || "Не удалось загрузить списки");
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => { cancelled = true; };
  }, []);

  const targets = targetType === "student" ? students : groups;

  const handleSubmit = async (e) => {
    e.preventDefault();
    setSubmitting(true);
    setError("");
    try {
      await onAssign?.({
        interactiveId: interactive?.id,
        targetType,
        targetId,
        deadline,
        attempts,
        showResult: showResult === "yes",
        comment,
      });
      onClose();
    } catch (err) {
      setError(err?.message || "Не удалось выдать интерактив");
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <CabinetModal title="Выдать интерактив" onClose={onClose}>
      {interactive ? (
        <p className="cb-modal__hint">
          «{getInteractiveDisplayTitle(interactive)}» · {interactive.topic || "без темы"}
        </p>
      ) : null}
      {error ? <p className="cb-modal-form__error" role="alert">{error}</p> : null}
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
          <select value={targetId} onChange={(e) => setTargetId(e.target.value)} required disabled={loading}>
            <option value="">{loading ? "Загрузка…" : "—"}</option>
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
          <button type="submit" className="cb-btn cb-btn--primary cb-btn--pill" disabled={submitting || loading}>
            {submitting ? "…" : "Выдать"}
          </button>
        </div>
      </form>
    </CabinetModal>
  );
}
