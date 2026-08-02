import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import {
  createHomeworkFromReview,
  fetchReviewHomeworkPreview,
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

function statusLabel(status) {
  if (status === "partial") return "Частично";
  if (status === "incorrect") return "Неверно";
  return status || "Ошибка";
}

/**
 * Создание ДЗ из проверки работы — без ухода со страницы проверки.
 */
export default function HomeworkFromReviewModal({
  open,
  reviewId,
  preselectIncorrect = true,
  preselectPartial = false,
  onClose,
  onDone,
}) {
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [preview, setPreview] = useState(null);
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [comment, setComment] = useState("");
  const [dueAtLocal, setDueAtLocal] = useState("");
  const [selectedIds, setSelectedIds] = useState(() => new Set());
  const [success, setSuccess] = useState(null);

  useEffect(() => {
    if (!open || !reviewId) return undefined;
    let cancelled = false;
    setLoading(true);
    setError("");
    setSuccess(null);
    fetchReviewHomeworkPreview(reviewId)
      .then((data) => {
        if (cancelled) return;
        setPreview(data);
        setTitle(data.default_title || "");
        setDescription(data.default_description || "");
        setDueAtLocal(toLocalInputValue(data.suggested_due_at));
        const initial = new Set();
        const rows = data.failed_tasks || [];
        rows.forEach((row) => {
          if (preselectIncorrect && row.status === "incorrect") {
            initial.add(String(row.task_id));
          }
          if (preselectPartial && row.status === "partial") {
            initial.add(String(row.task_id));
          }
        });
        setSelectedIds(initial);
      })
      .catch((err) => {
        if (!cancelled) setError(err.message || "Не удалось загрузить данные");
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [open, reviewId, preselectIncorrect, preselectPartial]);

  const failedTasks = preview?.failed_tasks || [];

  const selectedTasks = useMemo(
    () => failedTasks.filter((t) => selectedIds.has(String(t.task_id))),
    [failedTasks, selectedIds],
  );

  if (!open) return null;

  const toggle = (id) => {
    const key = String(id);
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  };

  const selectIncorrect = () => {
    setSelectedIds(new Set(
      failedTasks.filter((t) => t.status === "incorrect").map((t) => String(t.task_id)),
    ));
  };

  const selectIncorrectAndPartial = () => {
    setSelectedIds(new Set(
      failedTasks
        .filter((t) => t.status === "incorrect" || t.status === "partial")
        .map((t) => String(t.task_id)),
    ));
  };

  const clearTasks = () => setSelectedIds(new Set());

  const submit = async (mode) => {
    if (!reviewId || saving) return;
    if (!title.trim()) {
      setError("Укажите название задания");
      return;
    }
    if (!selectedIds.size && !description.trim()) {
      setError("Добавьте задания с ошибками или описание");
      return;
    }
    setSaving(true);
    setError("");
    try {
      const result = await createHomeworkFromReview(reviewId, {
        title: title.trim(),
        description: description.trim(),
        comment: comment.trim(),
        due_at: fromLocalInputValue(dueAtLocal),
        mode,
        generator_task_ids: [...selectedIds],
        idempotency_key: `review-hw-${reviewId}-${mode}-${[...selectedIds].sort().join(",")}-${title.trim()}`,
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
    return (
      <CabinetModal
        title="Готово"
        onClose={onClose}
        footer={(
          <>
            <button type="button" className="cb-btn cb-btn--secondary" onClick={onClose}>
              Продолжить проверку
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
        <p className="cabinet-auth-muted">
          Добавлено заданий/материалов: {success.tasks_count ?? "—"}
        </p>
      </CabinetModal>
    );
  }

  return (
    <CabinetModal
      title="Новое домашнее задание"
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
            disabled={saving || loading}
            onClick={() => void submit("draft")}
          >
            {saving ? "…" : "Сохранить как черновик"}
          </button>
          <button
            type="button"
            className="cb-btn cb-btn--primary"
            disabled={saving || loading}
            onClick={() => void submit("assign")}
          >
            {saving ? "Выдаём…" : "Выдать ученику"}
          </button>
        </>
      )}
    >
      {loading ? <p className="cabinet-auth-muted">Загрузка…</p> : null}
      {error ? <p className="cabinet-auth-error">{error}</p> : null}

      {!loading && preview ? (
        <>
          <div className="hw-from-review__meta">
            <div>
              <span className="cabinet-auth-muted">Ученик</span>
              <strong>{preview.student_name || "—"}</strong>
            </div>
            {(preview.subject || preview.level) ? (
              <div>
                <span className="cabinet-auth-muted">Предмет</span>
                <strong>
                  {[preview.level, preview.subject].filter(Boolean).join(" · ").toUpperCase()}
                </strong>
              </div>
            ) : null}
          </div>

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
            {preview.suggested_due_label ? (
              <small className="cabinet-auth-muted">{preview.suggested_due_label}</small>
            ) : null}
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
            <div className="hw-from-review__tasks-head">
              <h3>Задания с ошибками</h3>
              <div className="hw-from-review__quick">
                <button type="button" className="cb-btn cb-btn--ghost cb-btn--sm" onClick={selectIncorrect} disabled={saving}>
                  Все с ошибками
                </button>
                <button type="button" className="cb-btn cb-btn--ghost cb-btn--sm" onClick={selectIncorrectAndPartial} disabled={saving}>
                  + частично верные
                </button>
                <button type="button" className="cb-btn cb-btn--ghost cb-btn--sm" onClick={clearTasks} disabled={saving}>
                  Сбросить
                </button>
              </div>
            </div>

            {failedTasks.length === 0 ? (
              <p className="cabinet-auth-muted">
                Нет сохранённых ошибочных заданий. Можно выдать ДЗ с описанием или сохранить проверку с отметками.
              </p>
            ) : (
              <ul className="hw-from-review__list">
                {failedTasks.map((task) => {
                  const id = String(task.task_id);
                  const checked = selectedIds.has(id);
                  return (
                    <li key={id} className={`hw-from-review__card${checked ? " is-selected" : ""}`}>
                      <label>
                        <input
                          type="checkbox"
                          checked={checked}
                          onChange={() => toggle(id)}
                          disabled={saving}
                        />
                        <span className="hw-from-review__card-body">
                          <strong>
                            {task.number != null ? `№${task.number}` : "Задание"}
                            {" · "}
                            {task.title || id}
                          </strong>
                          <span>
                            {statusLabel(task.status)}
                            {task.score != null && task.max_score != null
                              ? ` · ${task.score}/${task.max_score}`
                              : ""}
                          </span>
                        </span>
                      </label>
                      {checked ? (
                        <button
                          type="button"
                          className="cb-btn cb-btn--ghost cb-btn--sm"
                          onClick={() => toggle(id)}
                          disabled={saving}
                        >
                          Убрать
                        </button>
                      ) : null}
                    </li>
                  );
                })}
              </ul>
            )}

            {selectedTasks.length ? (
              <p className="cabinet-auth-muted" style={{ marginBottom: 0 }}>
                Выбрано для ДЗ: {selectedTasks.length}
              </p>
            ) : null}
          </section>
        </>
      ) : null}
    </CabinetModal>
  );
}
