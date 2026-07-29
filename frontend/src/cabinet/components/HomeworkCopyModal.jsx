import { useEffect, useMemo, useState } from "react";
import {
  copyHomework,
  fetchGroups,
  fetchStudents,
  normalizeCabinetList,
} from "../../utils/cabinetAuth";
import CabinetModal from "./CabinetModal";

function toLocalInputValue(iso) {
  if (!iso) return "";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  const pad = (n) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

function fromLocalInputValue(local) {
  if (!local) return null;
  const d = new Date(local);
  if (Number.isNaN(d.getTime())) return null;
  return d.toISOString();
}

/**
 * Скопировать существующее ДЗ другим ученикам / группе.
 */
export default function HomeworkCopyModal({
  homeworkId,
  homeworkTitle = "",
  sourceStudentId = null,
  sourceDueAt = null,
  onClose,
  onCopied,
}) {
  const [students, setStudents] = useState([]);
  const [groups, setGroups] = useState([]);
  const [selectedIds, setSelectedIds] = useState(() => new Set());
  const [groupId, setGroupId] = useState("");
  const [dueAtLocal, setDueAtLocal] = useState(() => toLocalInputValue(sourceDueAt));
  const [keepDueAt, setKeepDueAt] = useState(Boolean(sourceDueAt));
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    Promise.all([
      fetchStudents({ status: "active" }).catch(() => []),
      fetchGroups().catch(() => []),
    ])
      .then(([studentsRaw, groupsRaw]) => {
        if (cancelled) return;
        const list = normalizeCabinetList(studentsRaw).map((s) => ({
          id: s.id,
          name: s.name || s.full_name || [s.first_name, s.last_name].filter(Boolean).join(" ") || `#${s.id}`,
        }));
        setStudents(list.filter((s) => String(s.id) !== String(sourceStudentId)));
        setGroups(normalizeCabinetList(groupsRaw).map((g) => ({
          id: g.id,
          title: g.title || g.name || `Группа ${g.id}`,
        })));
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [sourceStudentId]);

  const selectedCount = selectedIds.size + (groupId ? 1 : 0);

  const toggleStudent = (id) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      const key = String(id);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  };

  const selectAll = () => {
    setSelectedIds(new Set(students.map((s) => String(s.id))));
  };

  const clearAll = () => {
    setSelectedIds(new Set());
    setGroupId("");
  };

  const hint = useMemo(() => {
    if (groupId && selectedIds.size) {
      return "Будут назначены ученики из группы и отмеченные отдельно (без дублей).";
    }
    if (groupId) return "Задание получат все активные ученики выбранной группы.";
    if (selectedIds.size) return `Выбрано учеников: ${selectedIds.size}`;
    return "Выберите учеников или группу.";
  }, [groupId, selectedIds.size]);

  const submit = async () => {
    if (!homeworkId) return;
    if (!selectedIds.size && !groupId) {
      setError("Выберите хотя бы одного ученика или группу.");
      return;
    }
    setSaving(true);
    setError("");
    try {
      const payload = {
        student_ids: [...selectedIds].map((id) => Number(id)),
      };
      if (groupId) payload.group_id = Number(groupId);
      if (keepDueAt && sourceDueAt) {
        payload.keep_due_at = true;
      } else if (dueAtLocal) {
        payload.due_at = fromLocalInputValue(dueAtLocal);
      } else {
        payload.due_at = null;
      }
      const result = await copyHomework(homeworkId, payload);
      onCopied?.(result);
      onClose?.();
    } catch (err) {
      setError(err?.message || "Не удалось скопировать задание");
    } finally {
      setSaving(false);
    }
  };

  return (
    <CabinetModal
      title="Скопировать ДЗ другим"
      onClose={saving ? undefined : onClose}
      footer={(
        <>
          <button type="button" className="cb-btn cb-btn--secondary" onClick={onClose} disabled={saving}>
            Отмена
          </button>
          <button
            type="button"
            className="cb-btn cb-btn--primary"
            onClick={() => void submit()}
            disabled={saving || loading || (!selectedIds.size && !groupId)}
          >
            {saving ? "Копируем…" : "Скопировать и назначить"}
          </button>
        </>
      )}
    >
      {homeworkTitle ? (
        <p className="cabinet-auth-muted" style={{ marginTop: 0 }}>
          Исходное задание: <strong>{homeworkTitle}</strong>
        </p>
      ) : null}

      {loading ? (
        <p className="cabinet-auth-muted">Загрузка учеников…</p>
      ) : (
        <>
          <label className="cb-field">
            <span>Группа (опционально)</span>
            <select value={groupId} onChange={(e) => setGroupId(e.target.value)} disabled={saving}>
              <option value="">— не выбрана —</option>
              {groups.map((g) => (
                <option key={g.id} value={g.id}>{g.title}</option>
              ))}
            </select>
          </label>

          <div className="cb-field">
            <span>Ученики</span>
            <div style={{ display: "flex", gap: 8, margin: "6px 0 8px" }}>
              <button type="button" className="cb-btn cb-btn--ghost cb-btn--sm" onClick={selectAll} disabled={saving}>
                Выбрать всех
              </button>
              <button type="button" className="cb-btn cb-btn--ghost cb-btn--sm" onClick={clearAll} disabled={saving}>
                Сбросить
              </button>
            </div>
            <ul
              className="cb-notify-settings__toggles"
              style={{ maxHeight: 220, overflow: "auto", margin: 0, padding: 0, listStyle: "none" }}
            >
              {students.length === 0 ? (
                <li className="cabinet-auth-muted">Нет других активных учеников</li>
              ) : (
                students.map((s) => (
                  <li key={s.id}>
                    <label className="st-toggle-row">
                      <span>{s.name}</span>
                      <input
                        type="checkbox"
                        checked={selectedIds.has(String(s.id))}
                        onChange={() => toggleStudent(s.id)}
                        disabled={saving}
                      />
                    </label>
                  </li>
                ))
              )}
            </ul>
          </div>

          <label className="cb-field" style={{ marginTop: 12 }}>
            <span>Срок сдачи</span>
            <input
              type="datetime-local"
              value={dueAtLocal}
              onChange={(e) => {
                setDueAtLocal(e.target.value);
                setKeepDueAt(false);
              }}
              disabled={saving || keepDueAt}
            />
          </label>
          {sourceDueAt ? (
            <label className="st-toggle-row" style={{ marginTop: 8 }}>
              <span>Оставить тот же срок, что у исходного ДЗ</span>
              <input
                type="checkbox"
                checked={keepDueAt}
                onChange={(e) => {
                  setKeepDueAt(e.target.checked);
                  if (e.target.checked) setDueAtLocal(toLocalInputValue(sourceDueAt));
                }}
                disabled={saving}
              />
            </label>
          ) : null}

          <p className="cabinet-auth-muted" style={{ marginBottom: 0 }}>{hint}</p>
          {selectedCount ? null : null}
        </>
      )}

      {error ? <p className="cabinet-auth-error" role="alert">{error}</p> : null}
    </CabinetModal>
  );
}
