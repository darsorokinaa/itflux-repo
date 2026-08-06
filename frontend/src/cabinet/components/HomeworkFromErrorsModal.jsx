import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { createHomeworkFromStudentErrors } from "../../utils/cabinetAuth";
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

export function taskErrorKey(task) {
  return `${task.subject || ""}|${task.level || ""}|${task.task_id}`;
}

/**
 * Модал: название, срок и выдача ДЗ из уже выбранных ошибочных задач.
 */
export default function HomeworkFromErrorsModal({
  open,
  studentId,
  studentName = "",
  selectedTasks = [],
  suggestedDueAt = null,
  defaultTitle = "Работа над ошибками",
  defaultDescription = "",
  onClose,
  onDone,
}) {
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [title, setTitle] = useState(defaultTitle);
  const [description, setDescription] = useState(defaultDescription);
  const [comment, setComment] = useState("");
  const [dueAtLocal, setDueAtLocal] = useState("");
  const [success, setSuccess] = useState(null);

  useEffect(() => {
    if (!open) return;
    setError("");
    setSuccess(null);
    setTitle(defaultTitle || "Работа над ошибками");
    setDescription(defaultDescription || "");
    setComment("");
    setDueAtLocal(toLocalInputValue(suggestedDueAt));
  }, [open, defaultTitle, defaultDescription, suggestedDueAt]);

  const bySubject = useMemo(() => {
    const map = new Map();
    selectedTasks.forEach((task) => {
      const label = task.subject_label || task.subject || "Предмет";
      const level = task.level_label || task.level || "";
      const key = `${label}|${level}`;
      if (!map.has(key)) {
        map.set(key, { label, level, tasks: [] });
      }
      map.get(key).tasks.push(task);
    });
    return [...map.values()];
  }, [selectedTasks]);

  if (!open) return null;

  const submit = async (mode) => {
    if (!studentId || saving) return;
    if (!title.trim()) {
      setError("Укажите название задания");
      return;
    }
    if (!selectedTasks.length) {
      setError("Выберите хотя бы одно задание с ошибкой");
      return;
    }
    setSaving(true);
    setError("");
    try {
      const payloadTasks = selectedTasks.map((t) => ({
        task_id: t.task_id,
        subject: t.subject,
        level: t.level,
      }));
      const result = await createHomeworkFromStudentErrors(studentId, {
        title: title.trim(),
        description: description.trim(),
        comment: comment.trim(),
        due_at: fromLocalInputValue(dueAtLocal),
        mode,
        selected_tasks: payloadTasks,
        idempotency_key: `student-errors-${studentId}-${mode}-${payloadTasks
          .map(taskErrorKey)
          .sort()
          .join(",")}-${title.trim()}`.slice(0, 120),
      });
      setSuccess(result);
      onDone?.(result);
    } catch (err) {
      setError(err.message || "Не удалось создать задание");
    } finally {
      setSaving(false);
    }
  };

  if (success) {
    const list = success.homeworks || [];
    return (
      <CabinetModal
        title="Готово"
        onClose={onClose}
        footer={(
          <>
            <button type="button" className="cb-btn cb-btn--secondary" onClick={onClose}>
              Закрыть
            </button>
            {success.homework_url ? (
              <Link className="cb-btn cb-btn--primary" to={success.homework_url} onClick={onClose}>
                Открыть ДЗ
              </Link>
            ) : null}
          </>
        )}
      >
        <p style={{ marginTop: 0 }}>{success.message || "Домашнее задание создано"}</p>
        {list.length > 1 ? (
          <ul className="jg-errors-success-list">
            {list.map((hw) => (
              <li key={hw.id}>
                <Link to={hw.homework_url || `/cabinet/homework/${hw.id}`} onClick={onClose}>
                  {hw.title}
                </Link>
              </li>
            ))}
          </ul>
        ) : (
          <p className="cabinet-auth-muted">
            Добавлено заданий/материалов: {success.tasks_count ?? "—"}
          </p>
        )}
      </CabinetModal>
    );
  }

  return (
    <CabinetModal
      title="Работа над ошибками"
      onClose={saving ? undefined : onClose}
      wide
      footer={(
        <>
          <button type="button" className="cb-btn cb-btn--secondary" onClick={onClose} disabled={saving}>
            Отмена
          </button>
          <button
            type="button"
            className="cb-btn cb-btn--ghost"
            disabled={saving}
            onClick={() => void submit("draft")}
          >
            {saving ? "…" : "Сохранить как черновик"}
          </button>
          <button
            type="button"
            className="cb-btn cb-btn--primary"
            disabled={saving}
            onClick={() => void submit("assign")}
          >
            {saving ? "Выдаём…" : "Выдать как ДЗ"}
          </button>
        </>
      )}
    >
      {error ? <p className="cabinet-auth-error">{error}</p> : null}

      <div className="hw-from-review__meta">
        <div>
          <span className="cabinet-auth-muted">Ученик</span>
          <strong>{studentName || "—"}</strong>
        </div>
        <div>
          <span className="cabinet-auth-muted">Выбрано задач</span>
          <strong>{selectedTasks.length}</strong>
        </div>
      </div>

      {bySubject.length > 1 ? (
        <p className="cabinet-auth-muted">
          Задачи из разных предметов — будет создано отдельное ДЗ на каждый предмет.
        </p>
      ) : null}

      <label className="cb-field">
        <span>Название</span>
        <input
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          disabled={saving}
          maxLength={255}
        />
      </label>

      <label className="cb-field">
        <span>Описание / инструкция</span>
        <textarea
          rows={3}
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          disabled={saving}
        />
      </label>

      <label className="cb-field">
        <span>Срок выполнения</span>
        <input
          type="datetime-local"
          value={dueAtLocal}
          onChange={(e) => setDueAtLocal(e.target.value)}
          disabled={saving}
        />
      </label>

      <label className="cb-field">
        <span>Комментарий ученику</span>
        <textarea
          rows={2}
          value={comment}
          onChange={(e) => setComment(e.target.value)}
          disabled={saving}
          placeholder="Например: повтори тему и реши задания ещё раз"
        />
      </label>

      <section className="hw-from-review__tasks">
        <h3>Выбранные задания</h3>
        {bySubject.map((group) => (
          <div key={`${group.label}|${group.level}`} className="jg-errors-modal-group">
            <div className="jg-errors-modal-group__title">
              {group.label}
              {group.level ? ` · ${group.level}` : ""}
            </div>
            <ul className="hw-from-review__list">
              {group.tasks.map((task) => (
                <li key={taskErrorKey(task)} className="hw-from-review__card is-selected">
                  <span className="hw-from-review__card-body">
                    <strong>
                      {task.number != null ? `№${task.number}` : "Задание"}
                      {" · "}
                      {task.title || task.task_id}
                    </strong>
                    <span>
                      {task.status === "partial" ? "Частично" : "Неверно"}
                      {task.source_homework_title
                        ? ` · из «${task.source_homework_title}»`
                        : ""}
                    </span>
                  </span>
                </li>
              ))}
            </ul>
          </div>
        ))}
      </section>
    </CabinetModal>
  );
}
