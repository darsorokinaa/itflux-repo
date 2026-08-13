import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Link, Navigate, useNavigate, useParams, useSearchParams } from "react-router-dom";
import CabinetIcon from "../CabinetIcons";
import { CabinetPageShell, CabinetPageHeader } from "../CabinetSectionUi";
import ConfirmActionModal from "../components/ConfirmActionModal";
import HomeworkAttachmentsField from "../components/HomeworkAttachmentsField";
import PlanItemResourcesPicker from "../components/PlanItemResourcesPicker";
import { getInteractiveDisplayTitle } from "../interactivesData";
import { fetchHomeworkForEdit, updateHomework } from "../../utils/cabinetAuth";
import {
  isHomeworkInstructionTask,
  taskDuplicatesAttachment,
} from "../homeworkTaskDisplay";

function toDateTimeLocalValue(iso) {
  if (!iso) return "";
  try {
    const d = new Date(iso);
    if (Number.isNaN(d.getTime())) return "";
    const y = d.getFullYear();
    const m = String(d.getMonth() + 1).padStart(2, "0");
    const day = String(d.getDate()).padStart(2, "0");
    const h = String(d.getHours()).padStart(2, "0");
    const min = String(d.getMinutes()).padStart(2, "0");
    return `${y}-${m}-${day}T${h}:${min}`;
  } catch {
    return "";
  }
}

function datetimeLocalToIso(localValue) {
  if (!localValue) return null;
  const d = new Date(localValue);
  if (Number.isNaN(d.getTime())) return localValue;
  return d.toISOString();
}

function taskMeta(task) {
  if (task.is_variant) return "Вариант";
  if (task.interactive_id) return "Интерактив";
  if (task.task_type === "file") return "Файл";
  if (task.task_type === "external_link") return "Ссылка";
  if (task.task_type === "text") return "Текст";
  return task.task_type || "Задание";
}

function TaskRow({
  task,
  index,
  total,
  disabled,
  onRemove,
  onMove,
}) {
  return (
    <div className="cb-hw-assign-resource cb-hw-edit-task">
      <CabinetIcon name={task.interactive_id ? "interactive" : "tasks"} />
      <span className="cb-hw-assign-resource__body">
        <span className="cb-hw-assign-resource__title">{task.title || "Задание"}</span>
        <span className="cb-hw-assign-resource__meta">{taskMeta(task)}</span>
      </span>
      <div className="cb-hw-edit-task__controls">
        <button
          type="button"
          className="cb-hw-edit-task__move"
          disabled={disabled || index === 0}
          onClick={() => onMove(index, -1)}
          aria-label="Выше"
        >
          ↑
        </button>
        <button
          type="button"
          className="cb-hw-edit-task__move"
          disabled={disabled || index >= total - 1}
          onClick={() => onMove(index, 1)}
          aria-label="Ниже"
        >
          ↓
        </button>
        <button
          type="button"
          className="cb-hw-assign-resource__remove"
          onClick={() => onRemove(index)}
          disabled={disabled}
          aria-label="Удалить задание"
        >
          ×
        </button>
      </div>
    </div>
  );
}

export default function CabinetHomeworkEditPage() {
  const { homeworkId } = useParams();
  const [searchParams] = useSearchParams();
  const reviewId = searchParams.get("review") || "";
  const navigate = useNavigate();

  const [loading, setLoading] = useState(true);
  const [notFound, setNotFound] = useState(false);
  const [forbidden, setForbidden] = useState(false);
  const [error, setError] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [resourcePickerOpen, setResourcePickerOpen] = useState(false);
  const [confirmAction, setConfirmAction] = useState(null);

  const [updatedAt, setUpdatedAt] = useState("");
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [deadline, setDeadline] = useState("");
  const [tasks, setTasks] = useState([]);
  const [attachments, setAttachments] = useState([]);
  const [warnings, setWarnings] = useState({
    student_started: false,
    is_checked_or_completed: false,
  });
  const [canEdit, setCanEdit] = useState(true);
  const [studentStartedMessage, setStudentStartedMessage] = useState("");
  const [checkedMessage, setCheckedMessage] = useState("");
  const [studentName, setStudentName] = useState("");
  const [returnPath, setReturnPath] = useState("/cabinet/review");

  const initialSnapshot = useRef("");
  const dirty = useMemo(() => {
    const snap = JSON.stringify({ title, description, deadline, tasks });
    return Boolean(initialSnapshot.current) && snap !== initialSnapshot.current;
  }, [title, description, deadline, tasks]);

  useEffect(() => {
    if (!dirty) return undefined;
    const onBeforeUnload = (event) => {
      event.preventDefault();
      event.returnValue = "";
    };
    window.addEventListener("beforeunload", onBeforeUnload);
    return () => window.removeEventListener("beforeunload", onBeforeUnload);
  }, [dirty]);

  const load = useCallback(async () => {
    if (!homeworkId) {
      setNotFound(true);
      setLoading(false);
      return;
    }
    setLoading(true);
    setError("");
    setNotFound(false);
    setForbidden(false);
    try {
      const data = await fetchHomeworkForEdit(homeworkId);
      setUpdatedAt(data.updated_at || "");
      setTitle(data.title || "");
      setDescription(data.description || "");
      setDeadline(toDateTimeLocalValue(data.due_at));
      const nextTasks = Array.isArray(data.tasks) ? data.tasks.map((t, i) => ({
        ...t,
        clientKey: t.id ? `id-${t.id}` : `new-${i}-${t.material_id || t.interactive_id || "x"}`,
      })) : [];
      setTasks(nextTasks);
      setAttachments(Array.isArray(data.attachments) ? data.attachments : []);
      setWarnings(data.warnings || {});
      setCanEdit(data.can_edit !== false && !data.warnings?.is_checked_or_completed);
      setStudentStartedMessage(data.student_started_message || "");
      setCheckedMessage(data.checked_message || "");
      setStudentName(data.student_name || "");
      const back = reviewId
        ? `/cabinet/review/${encodeURIComponent(reviewId)}`
        : "/cabinet/review";
      setReturnPath(back);
      initialSnapshot.current = JSON.stringify({
        title: data.title || "",
        description: data.description || "",
        deadline: toDateTimeLocalValue(data.due_at),
        tasks: nextTasks,
      });
    } catch (err) {
      const status = err?.status || err?.response?.status;
      if (status === 403) setForbidden(true);
      else if (status === 404) setNotFound(true);
      else setError(err?.message || "Не удалось загрузить домашнее задание");
    } finally {
      setLoading(false);
    }
  }, [homeworkId, reviewId]);

  useEffect(() => {
    load();
  }, [load]);

  const attachedMaterialIds = useMemo(
    () => tasks.map((t) => Number(t.material_id)).filter((id) => Number.isFinite(id) && id > 0),
    [tasks],
  );
  const attachedInteractiveIds = useMemo(
    () => tasks.map((t) => Number(t.interactive_id)).filter((id) => Number.isFinite(id) && id > 0),
    [tasks],
  );
  const visibleTasks = useMemo(
    () => tasks
      .map((task, index) => ({ task, index }))
      .filter(({ task }) => (
        !isHomeworkInstructionTask(task, description)
        && !taskDuplicatesAttachment(task, attachments)
      )),
    [tasks, description, attachments],
  );

  const askRemoveTask = (index) => {
    setConfirmAction({
      type: "remove-task",
      title: "Удалить задание?",
      text: "Удалить это задание из домашней работы?",
      confirmLabel: "Удалить",
      danger: true,
      onConfirm: () => {
        setTasks((prev) => prev.filter((_, i) => i !== index));
        setConfirmAction(null);
      },
    });
  };

  const moveTask = (index, delta) => {
    setTasks((prev) => {
      const next = [...prev];
      const target = index + delta;
      if (target < 0 || target >= next.length) return prev;
      const tmp = next[index];
      next[index] = next[target];
      next[target] = tmp;
      return next;
    });
  };

  const handleAttachMaterial = (material) => {
    if (!material?.id) return;
    setTasks((prev) => {
      if (prev.some((t) => Number(t.material_id) === Number(material.id))) return prev;
      return [
        ...prev,
        {
          clientKey: `mat-${material.id}-${Date.now()}`,
          material_id: material.id,
          title: material.title,
          task_type: material.material_type === "task_set" ? "generated_task" : "file",
          is_variant: material.material_type === "task_set",
        },
      ];
    });
    setResourcePickerOpen(false);
  };

  const handleAttachInteractive = (interactive) => {
    if (!interactive?.id) return;
    setTasks((prev) => {
      if (prev.some((t) => Number(t.interactive_id) === Number(interactive.id))) return prev;
      return [
        ...prev,
        {
          clientKey: `int-${interactive.id}-${Date.now()}`,
          interactive_id: interactive.id,
          title: getInteractiveDisplayTitle(interactive),
          task_type: "interactive",
        },
      ];
    });
    setResourcePickerOpen(false);
  };

  const buildPayload = (confirms = {}) => {
    const tasksPayload = tasks.map((task, order) => {
      if (task.id) {
        return { id: task.id, order };
      }
      if (task.material_id) {
        return { material_id: task.material_id, order };
      }
      if (task.interactive_id) {
        return { interactive_id: task.interactive_id, order };
      }
      return {
        task_type: "text",
        title: task.title || "Задание",
        description: task.description || "",
        order,
      };
    });
    return {
      title: title.trim(),
      description: description.trim(),
      due_at: deadline ? datetimeLocalToIso(deadline) : null,
      updated_at: updatedAt,
      tasks: tasksPayload,
      ...confirms,
    };
  };

  const tasksCompositionChanged = () => {
    try {
      const initial = JSON.parse(initialSnapshot.current || "{}");
      const initialIds = (initial.tasks || []).map((t) => t.id || `new:${t.material_id || t.interactive_id || t.title}`);
      const currentIds = tasks.map((t) => t.id || `new:${t.material_id || t.interactive_id || t.title}`);
      return JSON.stringify(initialIds) !== JSON.stringify(currentIds);
    } catch {
      return true;
    }
  };

  const doSave = async (confirms = {}) => {
    setSubmitting(true);
    setError("");
    try {
      const result = await updateHomework(homeworkId, buildPayload(confirms));
      initialSnapshot.current = "";
      const notice = encodeURIComponent(result?.message || "Домашнее задание обновлено");
      if (reviewId) {
        navigate(`/cabinet/review/${encodeURIComponent(reviewId)}?notice=${notice}`);
      } else {
        navigate(`/cabinet/review?notice=${notice}`);
      }
    } catch (err) {
      const code = err?.code || err?.data?.code;
      const detail = err?.message || err?.data?.detail || "Не удалось сохранить изменения";
      if (code === "needs_confirm_student_started") {
        setConfirmAction({
          type: "confirm-started",
          title: "Ученик уже начал работу",
          text: detail,
          confirmLabel: "Сохранить изменения",
          danger: false,
          onConfirm: () => {
            setConfirmAction(null);
            doSave({ ...confirms, confirm_student_started: true });
          },
        });
      } else if (code === "conflict" || err?.status === 409) {
        setError(detail);
      } else {
        setError(detail);
      }
    } finally {
      setSubmitting(false);
    }
  };

  const handleSubmit = (event) => {
    event.preventDefault();
    if (!canEdit) return;
    if (!title.trim()) {
      setError("Укажите название задания");
      return;
    }
    if (!description.trim() && tasks.length === 0) {
      setError("Добавьте описание или хотя бы одно задание");
      return;
    }

    const confirms = {};
    const compositionChanged = tasksCompositionChanged();

    const runWithConfirms = (base) => {
      if (warnings.student_started && compositionChanged && !base.confirm_student_started) {
        setConfirmAction({
          type: "confirm-started",
          title: "Ученик уже начал работу",
          text: studentStartedMessage
            || "Ученик уже начал выполнять это домашнее задание. Изменение состава заданий может повлиять на его ответы и результаты.",
          confirmLabel: "Сохранить изменения",
          danger: false,
          onConfirm: () => {
            setConfirmAction(null);
            runWithConfirms({ ...base, confirm_student_started: true });
          },
        });
        return;
      }
      doSave(base);
    };

    runWithConfirms(confirms);
  };

  const handleCancel = () => {
    if (dirty) {
      setConfirmAction({
        type: "leave",
        title: "Покинуть страницу?",
        text: "У вас есть несохранённые изменения. Покинуть страницу без сохранения?",
        confirmLabel: "Уйти",
        danger: true,
        onConfirm: () => {
          setConfirmAction(null);
          initialSnapshot.current = "";
          navigate(returnPath);
        },
      });
      return;
    }
    navigate(returnPath);
  };

  if (loading) {
    return (
      <CabinetPageShell className="cb-section--review">
        <p className="cb-loading">Загрузка…</p>
      </CabinetPageShell>
    );
  }

  if (forbidden) {
    return (
      <CabinetPageShell className="cb-section--review">
        <CabinetPageHeader title="Редактирование ДЗ" />
        <p className="cb-inline-error">Нет доступа к этому домашнему заданию.</p>
        <Link to="/cabinet/review" className="cb-review-detail__back">← К списку</Link>
      </CabinetPageShell>
    );
  }

  if (notFound) {
    return <Navigate to="/cabinet/review" replace />;
  }

  return (
    <CabinetPageShell className="cb-section--review cb-section--hw-edit">
      <div className="cb-review-detail__topbar">
        <button type="button" className="cb-review-detail__back" onClick={handleCancel}>
          ← Назад
        </button>
      </div>

      <CabinetPageHeader
        title="Редактировать ДЗ"
        subtitle={studentName ? `Ученик: ${studentName}` : undefined}
      />

      {error ? <p className="cb-inline-error" role="alert">{error}</p> : null}

      {!canEdit ? (
        <p className="cb-inline-warn" role="status">
          {checkedMessage
            || "Нельзя изменить проверенное и принятое домашнее задание."}
        </p>
      ) : null}

      <form className="cb-modal-form cb-hw-assign-form cb-hw-edit-form" onSubmit={handleSubmit}>
        <label className="cb-field">
          <span>Название</span>
          <input
            type="text"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            disabled={submitting || !canEdit}
            required
          />
        </label>

        <label className="cb-field cb-field--wide">
          <span>Описание и инструкция</span>
          <textarea
            rows={4}
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            disabled={submitting || !canEdit}
          />
        </label>

        <label className="cb-field">
          <span>Срок выполнения</span>
          <input
            type="datetime-local"
            value={deadline}
            onChange={(e) => setDeadline(e.target.value)}
            disabled={submitting || !canEdit}
          />
        </label>

        <div className="cb-attach-section">
          <div className="cb-hw-assign-section-head">
            <h3 className="cb-attach-section__title">Задания и материалы</h3>
            {canEdit ? (
              <button
                type="button"
                className="cb-btn cb-btn--outline cb-btn--sm"
                onClick={() => setResourcePickerOpen(true)}
                disabled={submitting}
              >
                Добавить задание
              </button>
            ) : null}
          </div>
          {visibleTasks.length === 0 ? (
            <p className="cabinet-auth-muted">
              Можно добавить материалы, варианты или интерактивы.
            </p>
          ) : (
            <div className="cb-hw-assign-resource-list">
              {visibleTasks.map(({ task, index }) => (
                <TaskRow
                  key={task.clientKey || task.id || `task-${index}`}
                  task={task}
                  index={index}
                  total={tasks.length}
                  disabled={submitting || !canEdit}
                  onRemove={askRemoveTask}
                  onMove={moveTask}
                />
              ))}
            </div>
          )}
        </div>

        <div className="cb-attach-section">
          <HomeworkAttachmentsField
            homeworkId={homeworkId}
            disabled={submitting || !canEdit}
          />
        </div>

        <div className="cb-modal-form__actions">
          <div className="cb-modal-form__actions-main">
            <button
              type="button"
              className="cb-btn cb-btn--outline"
              onClick={handleCancel}
              disabled={submitting}
            >
              {canEdit ? "Отмена" : "Назад"}
            </button>
            {canEdit ? (
              <button type="submit" className="cb-btn cb-btn--primary" disabled={submitting}>
                {submitting ? "Сохранение…" : "Сохранить изменения"}
              </button>
            ) : null}
          </div>
        </div>
      </form>

      <ConfirmActionModal
        open={Boolean(confirmAction)}
        title={confirmAction?.title || "Подтвердите действие"}
        text={confirmAction?.text || ""}
        confirmLabel={confirmAction?.confirmLabel || "Подтвердить"}
        cancelLabel="Отмена"
        danger={Boolean(confirmAction?.danger)}
        loading={submitting}
        onClose={() => { if (!submitting) setConfirmAction(null); }}
        onConfirm={() => confirmAction?.onConfirm?.()}
      />

      <PlanItemResourcesPicker
        scope="homework"
        open={resourcePickerOpen}
        initialTab="library"
        attachedMaterialIds={attachedMaterialIds}
        attachedInteractiveIds={attachedInteractiveIds}
        onClose={() => setResourcePickerOpen(false)}
        onAttachMaterial={handleAttachMaterial}
        onAttachInteractive={handleAttachInteractive}
      />
    </CabinetPageShell>
  );
}
