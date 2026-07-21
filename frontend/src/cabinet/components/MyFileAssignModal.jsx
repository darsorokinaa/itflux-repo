import { useEffect, useMemo, useState } from "react";
import { assignMyFile, fetchGroups, fetchStudents, normalizeCabinetList } from "../../utils/cabinetAuth";
import CabinetModal from "./CabinetModal";

function studentLabel(s) {
  return s.full_name || `${s.last_name || ""} ${s.first_name || ""}`.trim() || `Ученик #${s.id}`;
}

export default function MyFileAssignModal({ file, open, onClose, onAssigned }) {
  const [mode, setMode] = useState("material");
  const [targetType, setTargetType] = useState("student");
  const [studentId, setStudentId] = useState("");
  const [groupId, setGroupId] = useState("");
  const [message, setMessage] = useState("");
  const [title, setTitle] = useState("");
  const [dueAt, setDueAt] = useState("");
  const [students, setStudents] = useState([]);
  const [groups, setGroups] = useState([]);
  const [loading, setLoading] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    if (!open) return undefined;
    setMode("material");
    setTargetType("student");
    setStudentId("");
    setGroupId("");
    setMessage("");
    setTitle(file?.display_name || file?.name ? `ДЗ: ${file.display_name || file.name}` : "");
    setDueAt("");
    setError("");
    setLoading(true);
    Promise.all([fetchStudents().catch(() => []), fetchGroups().catch(() => [])])
      .then(([s, g]) => {
        setStudents(normalizeCabinetList(s));
        setGroups(normalizeCabinetList(g));
      })
      .finally(() => setLoading(false));
  }, [open, file?.id, file?.display_name, file?.name]);

  const canSubmit = useMemo(() => {
    if (!file?.id) return false;
    if (targetType === "student") return Boolean(studentId);
    return Boolean(groupId);
  }, [file?.id, targetType, studentId, groupId]);

  if (!open || !file) return null;

  const handleSubmit = async (event) => {
    event.preventDefault();
    if (!canSubmit) {
      setError("Выберите ученика или группу");
      return;
    }
    setSubmitting(true);
    setError("");
    try {
      const payload = {
        mode,
        message: message.trim() || undefined,
        title: mode === "homework" ? (title.trim() || undefined) : undefined,
        due_at: mode === "homework" && dueAt ? dueAt : undefined,
        ...(targetType === "student" ? { student_id: Number(studentId) } : { group_id: Number(groupId) }),
      };
      const result = await assignMyFile(file.id, payload);
      onAssigned?.(result);
      onClose?.();
    } catch (err) {
      setError(err?.message || "Не удалось выдать файл");
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <CabinetModal
      title="Выдать файл"
      onClose={submitting ? undefined : onClose}
      footer={(
        <>
          <button type="button" className="cb-btn cb-btn--secondary" onClick={onClose} disabled={submitting}>
            Отмена
          </button>
          <button
            type="button"
            className="cb-btn cb-btn--primary"
            onClick={handleSubmit}
            disabled={submitting || loading || !canSubmit}
          >
            {submitting ? "Выдаём…" : "Выдать"}
          </button>
        </>
      )}
    >
      <form className="cb-files-assign" onSubmit={handleSubmit}>
        <p className="cb-files-assign__file">
          Файл: <strong>{file.display_name || file.name}</strong>
        </p>

        <fieldset className="cb-files-assign__fieldset">
          <legend>Как выдать</legend>
          <label className="cb-files-assign__radio">
            <input
              type="radio"
              name="assign-mode"
              checked={mode === "material"}
              onChange={() => setMode("material")}
            />
            Как материал
          </label>
          <label className="cb-files-assign__radio">
            <input
              type="radio"
              name="assign-mode"
              checked={mode === "homework"}
              onChange={() => setMode("homework")}
            />
            Как домашнее задание
          </label>
        </fieldset>

        <fieldset className="cb-files-assign__fieldset">
          <legend>Кому</legend>
          <label className="cb-files-assign__radio">
            <input
              type="radio"
              name="assign-target"
              checked={targetType === "student"}
              onChange={() => setTargetType("student")}
            />
            Ученику
          </label>
          <label className="cb-files-assign__radio">
            <input
              type="radio"
              name="assign-target"
              checked={targetType === "group"}
              onChange={() => setTargetType("group")}
            />
            Группе
          </label>
        </fieldset>

        {targetType === "student" ? (
          <label className="cb-field">
            <span>Ученик</span>
            <select
              className="cb-files__select"
              value={studentId}
              onChange={(e) => setStudentId(e.target.value)}
              disabled={loading}
            >
              <option value="">Выберите ученика</option>
              {students.map((s) => (
                <option key={s.id} value={s.id}>{studentLabel(s)}</option>
              ))}
            </select>
          </label>
        ) : (
          <label className="cb-field">
            <span>Группа</span>
            <select
              className="cb-files__select"
              value={groupId}
              onChange={(e) => setGroupId(e.target.value)}
              disabled={loading}
            >
              <option value="">Выберите группу</option>
              {groups.map((g) => (
                <option key={g.id} value={g.id}>{g.title}</option>
              ))}
            </select>
          </label>
        )}

        {mode === "homework" ? (
          <>
            <label className="cb-field">
              <span>Название задания</span>
              <input
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                placeholder="ДЗ: материал"
              />
            </label>
            <label className="cb-field">
              <span>Срок сдачи</span>
              <input
                type="date"
                value={dueAt}
                onChange={(e) => setDueAt(e.target.value)}
              />
            </label>
          </>
        ) : null}

        <label className="cb-field">
          <span>{mode === "homework" ? "Описание / комментарий" : "Сообщение ученику"}</span>
          <textarea
            value={message}
            onChange={(e) => setMessage(e.target.value)}
            rows={3}
            placeholder={mode === "homework" ? "Необязательно" : "Необязательное сообщение"}
          />
        </label>

        {error ? <p className="cb-modal-form__error" role="alert">{error}</p> : null}
      </form>
    </CabinetModal>
  );
}
