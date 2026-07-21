import { useEffect, useState } from "react";
import CabinetModal from "./CabinetModal";
import {
  fetchInteractiveBoardAccess,
  fetchStudents,
  normalizeCabinetList,
  updateInteractiveBoardAccess,
} from "../../utils/cabinetAuth";

export default function BoardAccessModal({ boardId, allowExport: initialAllowExport = true, onClose, onSaved }) {
  const [students, setStudents] = useState([]);
  const [rows, setRows] = useState([]);
  const [allowExport, setAllowExport] = useState(initialAllowExport);
  const [studentId, setStudentId] = useState("");
  const [permission, setPermission] = useState("view");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    Promise.all([
      fetchStudents().catch(() => []),
      fetchInteractiveBoardAccess(boardId).catch(() => ({ access: [] })),
    ]).then(([s, accessData]) => {
      if (cancelled) return;
      setStudents(normalizeCabinetList(s));
      setRows(Array.isArray(accessData?.access) ? accessData.access : []);
      if (typeof accessData?.allow_export === "boolean") {
        setAllowExport(accessData.allow_export);
      }
      setLoading(false);
    });
    return () => { cancelled = true; };
  }, [boardId]);

  const addRow = () => {
    if (!studentId) return;
    const student = students.find((s) => String(s.id) === String(studentId));
    if (!student?.is_registered) {
      setError("У выбранного ученика нет аккаунта на платформе.");
      return;
    }
    if (rows.some((r) => String(r.student_id) === String(student.id) || String(r._student_id) === String(student.id))) {
      setError("Этот ученик уже добавлен.");
      return;
    }
    setError("");
    setRows((prev) => [
      ...prev,
      {
        student_id: student.id,
        _student_id: student.id,
        user_id: null,
        name: [student.first_name, student.last_name].filter(Boolean).join(" ") || student.full_name,
        permission,
      },
    ]);
    setStudentId("");
  };

  const removeRow = (index) => {
    setRows((prev) => prev.filter((_, i) => i !== index));
  };

  const handleSave = async () => {
    setSaving(true);
    setError("");
    try {
      const access = rows.map((r) => {
        if (r.student_id || r._student_id) {
          return {
            student_id: r.student_id || r._student_id,
            permission: r.permission,
          };
        }
        return {
          user_id: r.user_id,
          permission: r.permission,
        };
      });
      const data = await updateInteractiveBoardAccess(boardId, {
        access,
        replace: true,
        allow_export: allowExport,
      });
      onSaved?.(data);
      onClose?.();
    } catch (err) {
      setError(err?.message || "Не удалось сохранить доступ");
      setSaving(false);
    }
  };

  return (
    <CabinetModal
      title="Настройки доступа"
      onClose={onClose}
      footer={(
        <>
          <button type="button" className="cb-btn cb-btn--outline" onClick={onClose} disabled={saving}>
            Отмена
          </button>
          <button type="button" className="cb-btn cb-btn--primary" onClick={handleSave} disabled={saving || loading}>
            {saving ? "Сохранение…" : "Сохранить"}
          </button>
        </>
      )}
    >
      {loading ? (
        <p className="cabinet-auth-muted">Загрузка…</p>
      ) : (
        <div className="cb-board-form">
          <label>
            <span style={{ display: "flex", alignItems: "center", gap: 8 }}>
              <input
                type="checkbox"
                checked={allowExport}
                onChange={(e) => setAllowExport(e.target.checked)}
              />
              Разрешить экспорт зрителям
            </span>
          </label>

          <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "flex-end" }}>
            <label style={{ flex: "1 1 160px" }}>
              Ученик
              <select value={studentId} onChange={(e) => setStudentId(e.target.value)}>
                <option value="">Выберите</option>
                {students.map((s) => (
                  <option key={s.id} value={s.id}>
                    {[s.first_name, s.last_name].filter(Boolean).join(" ") || s.full_name || `#${s.id}`}
                  </option>
                ))}
              </select>
            </label>
            <label style={{ flex: "0 0 150px" }}>
              Право
              <select value={permission} onChange={(e) => setPermission(e.target.value)}>
                <option value="view">Просмотр</option>
                <option value="edit">Редактирование</option>
              </select>
            </label>
            <button type="button" className="cb-btn cb-btn--outline" onClick={addRow}>
              Добавить
            </button>
          </div>

          {rows.length === 0 ? (
            <p className="cabinet-auth-muted">Пока никому не выдан доступ.</p>
          ) : (
            <ul style={{ listStyle: "none", margin: 0, padding: 0, display: "grid", gap: 8 }}>
              {rows.map((row, index) => (
                <li
                  key={`${row.user_id}-${index}`}
                  style={{
                    display: "flex",
                    justifyContent: "space-between",
                    gap: 8,
                    alignItems: "center",
                    padding: "0.55rem 0.7rem",
                    border: "1px solid var(--border-card)",
                    borderRadius: 10,
                  }}
                >
                  <span>
                    {row.name || row.username || `Пользователь #${row.user_id}`}
                    {" · "}
                    {row.permission === "edit" ? "Редактирование" : "Просмотр"}
                  </span>
                  <button type="button" className="cb-btn cb-btn--outline" onClick={() => removeRow(index)}>
                    Убрать
                  </button>
                </li>
              ))}
            </ul>
          )}

          {error ? <p className="cb-board-form__error" role="alert">{error}</p> : null}
        </div>
      )}
    </CabinetModal>
  );
}
