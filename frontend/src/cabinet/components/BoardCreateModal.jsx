import { useEffect, useState } from "react";
import CabinetModal from "./CabinetModal";
import { createInteractiveBoard, fetchGroups, fetchLessons, fetchStudents, normalizeCabinetList } from "../../utils/cabinetAuth";

export default function BoardCreateModal({
  onClose,
  onCreated,
  initial = {},
}) {
  const [title, setTitle] = useState(initial.title || "Новая доска");
  const [description, setDescription] = useState(initial.description || "");
  const [groupId, setGroupId] = useState(initial.groupId || "");
  const [studentId, setStudentId] = useState(initial.studentId || "");
  const [lessonId, setLessonId] = useState(initial.lessonId || "");
  const [groups, setGroups] = useState([]);
  const [students, setStudents] = useState([]);
  const [lessons, setLessons] = useState([]);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    let cancelled = false;
    Promise.all([
      fetchGroups().catch(() => []),
      fetchStudents().catch(() => []),
      fetchLessons().catch(() => []),
    ]).then(([g, s, l]) => {
      if (cancelled) return;
      setGroups(normalizeCabinetList(g));
      setStudents(normalizeCabinetList(s));
      setLessons(normalizeCabinetList(l));
    });
    return () => { cancelled = true; };
  }, []);

  const handleSubmit = async (e) => {
    e.preventDefault();
    setSaving(true);
    setError("");
    try {
      const payload = {
        title: (title || "").trim() || "Новая доска",
        description: description.trim(),
        group_id: groupId ? Number(groupId) : null,
        student_id: studentId ? Number(studentId) : null,
        lesson_id: lessonId ? Number(lessonId) : null,
      };
      if (initial.scheduleEventId != null && initial.scheduleEventId !== "") {
        const raw = String(initial.scheduleEventId).trim();
        const pk = raw.startsWith("local-") ? Number(raw.slice(6)) : Number(raw);
        if (Number.isFinite(pk)) payload.schedule_event_id = pk;
      }
      const board = await createInteractiveBoard(payload);
      onCreated?.(board);
    } catch (err) {
      setError(err?.message || "Не удалось создать доску");
      setSaving(false);
    }
  };

  return (
    <CabinetModal
      title="Создать доску"
      onClose={onClose}
      footer={(
        <>
          <button type="button" className="cb-btn cb-btn--outline" onClick={onClose} disabled={saving}>
            Отмена
          </button>
          <button type="submit" form="cb-board-create-form" className="cb-btn cb-btn--primary" disabled={saving}>
            {saving ? "Создание…" : "Создать"}
          </button>
        </>
      )}
    >
      <form id="cb-board-create-form" className="cb-board-form" onSubmit={handleSubmit}>
        <label>
          Название доски
          <input
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            maxLength={255}
            required
            autoFocus
          />
        </label>
        <label>
          Описание
          <textarea
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            rows={3}
            placeholder="Необязательно"
          />
        </label>
        <label>
          Группа
          <select value={groupId} onChange={(e) => setGroupId(e.target.value)}>
            <option value="">Не выбрана</option>
            {groups.map((g) => (
              <option key={g.id} value={g.id}>{g.title}</option>
            ))}
          </select>
        </label>
        <label>
          Ученик
          <select value={studentId} onChange={(e) => setStudentId(e.target.value)}>
            <option value="">Не выбран</option>
            {students.map((s) => (
              <option key={s.id} value={s.id}>
                {[s.first_name, s.last_name].filter(Boolean).join(" ") || s.full_name || `Ученик #${s.id}`}
              </option>
            ))}
          </select>
          <span className="cb-board-form__hint">
            Если выбрать ученика с аккаунтом, он сможет совместно редактировать доску.
          </span>
        </label>
        <label>
          Урок
          <select value={lessonId} onChange={(e) => setLessonId(e.target.value)}>
            <option value="">Не выбран</option>
            {lessons.map((l) => (
              <option key={l.id} value={l.id}>{l.title}</option>
            ))}
          </select>
        </label>
        {error ? <p className="cb-board-form__error" role="alert">{error}</p> : null}
      </form>
    </CabinetModal>
  );
}
