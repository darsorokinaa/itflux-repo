import { useCallback, useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import CabinetIcon from "../CabinetIcons";
import CabinetModal from "./CabinetModal";
import HomeworkAttachmentsField, {
  uploadPendingHomeworkFiles,
} from "./HomeworkAttachmentsField";
import PlanItemResourcesPicker from "./PlanItemResourcesPicker";
import { getInteractiveDisplayTitle } from "../interactivesData";
import { assignStudentHomework, checkVariantTasksOverlap, fetchStudentHomeworkOptions } from "../../utils/cabinetAuth";

function HomeworkPickItem({ item, selected, onSelect, disabled }) {
  return (
    <button
      type="button"
      className={`cb-attach-item cb-hw-assign-item${selected ? " cb-hw-assign-item--selected" : ""}${disabled ? " cb-attach-item--disabled" : ""}`}
      onClick={() => !disabled && onSelect(item.id)}
      disabled={disabled}
    >
      <CabinetIcon name="tasks" />
      <span className="cb-attach-item__body">
        <span className="cb-attach-item__title">
          {item.order ? `${item.order}. ` : ""}
          {item.title}
        </span>
        <span className="cb-attach-item__meta">
          {item.assigned ? "Уже выдано · " : ""}
          {item.homework_summary}
        </span>
      </span>
      {item.assigned ? (
        <span className="cb-hw-assign-item__badge">Выдано</span>
      ) : null}
    </button>
  );
}

function AttachedResourceRow({ icon, title, meta, onRemove, disabled }) {
  return (
    <div className="cb-hw-assign-resource">
      <CabinetIcon name={icon} />
      <span className="cb-hw-assign-resource__body">
        <span className="cb-hw-assign-resource__title">{title}</span>
        {meta ? <span className="cb-hw-assign-resource__meta">{meta}</span> : null}
      </span>
      <button
        type="button"
        className="cb-hw-assign-resource__remove"
        onClick={onRemove}
        disabled={disabled}
        aria-label="Удалить"
      >
        ×
      </button>
    </div>
  );
}

export default function HomeworkAssignModal({
  student = null,
  students = null,
  group = null,
  enrollment,
  scheduleEventId = null,
  studentSubjectId = null,
  onClose,
  onAssigned,
  onAttachPlan,
}) {
  const targets = useMemo(() => {
    if (Array.isArray(students) && students.length) return students;
    if (student) return [student];
    return [];
  }, [student, students]);
  const primaryStudent = targets[0] || null;
  const isGroupAssign = Boolean(group) || targets.length > 1;
  const modalTitle = group?.name
    ? `Задать ДЗ — ${group.name}`
    : `Задать ДЗ — ${primaryStudent?.name || "ученик"}`;

  const [options, setOptions] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [mode, setMode] = useState("plan");
  const [selectedId, setSelectedId] = useState("");
  const [deadline, setDeadline] = useState("");
  const [suggestedDueAt, setSuggestedDueAt] = useState("");
  const [deadlineTouched, setDeadlineTouched] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [customTitle, setCustomTitle] = useState("");
  const [customDescription, setCustomDescription] = useState("");
  const [customMaterials, setCustomMaterials] = useState([]);
  const [customInteractives, setCustomInteractives] = useState([]);
  const [resourcePickerOpen, setResourcePickerOpen] = useState(false);
  const [duplicateTaskIds, setDuplicateTaskIds] = useState([]);
  const [pendingAttachmentFiles, setPendingAttachmentFiles] = useState([]);

  const toDateTimeLocalValue = (iso) => {
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
  };

  const datetimeLocalToIso = (localValue) => {
    if (!localValue) return undefined;
    const d = new Date(localValue);
    if (Number.isNaN(d.getTime())) return localValue;
    return d.toISOString();
  };

  const formatSuggestedHint = (iso) => {
    if (!iso) return "";
    try {
      return new Date(iso).toLocaleString("ru-RU", {
        day: "numeric",
        month: "short",
        hour: "2-digit",
        minute: "2-digit",
      });
    } catch {
      return "";
    }
  };

  const resolveDueAtPayload = () => {
    if (!deadline) return undefined;
    const suggestedLocal = toDateTimeLocalValue(suggestedDueAt);
    if (suggestedDueAt && (!deadlineTouched || deadline === suggestedLocal)) {
      return suggestedDueAt;
    }
    return datetimeLocalToIso(deadline);
  };

  const loadOptions = useCallback(async () => {
    if (!primaryStudent?.id) {
      setLoading(false);
      setOptions(null);
      setError(isGroupAssign ? "В группе пока нет учеников" : "Не выбран ученик");
      return;
    }
    setLoading(true);
    setError("");
    try {
      const data = await fetchStudentHomeworkOptions(primaryStudent.id, {
        scheduleEventId: scheduleEventId || undefined,
        studentSubjectId: studentSubjectId || undefined,
      });
      setOptions(data || null);
      const preferredId = data?.preferred_plan_item_id;
      const preferred = preferredId
        ? (data?.items || []).find((item) => Number(item.id) === Number(preferredId))
        : null;
      const first =
        preferred
        || (data?.items || []).find((item) => !item.assigned)
        || (data?.items || [])[0];
      setSelectedId(first ? String(first.id) : "");
      const suggested = data?.suggested_due_at || "";
      setSuggestedDueAt(suggested);
      setDeadlineTouched(false);
      setDeadline(toDateTimeLocalValue(suggested));
    } catch (err) {
      setError(err.message || "Не удалось загрузить занятия");
      setOptions(null);
    } finally {
      setLoading(false);
    }
  }, [primaryStudent?.id, isGroupAssign, scheduleEventId, studentSubjectId]);

  useEffect(() => {
    loadOptions();
  }, [loadOptions]);

  const planTitle = options?.plan_title || enrollment?.planTitle || "";
  const hasPlan = Boolean(options?.plan_id || enrollment?.planId);
  const items = options?.items || [];
  const hasPlanItems = items.length > 0;

  useEffect(() => {
    if (loading) return;
    if (hasPlan && hasPlanItems) {
      setMode("plan");
    } else {
      setMode("custom");
    }
  }, [loading, hasPlan, hasPlanItems]);

  const customMaterialIds = useMemo(
    () => customMaterials.map((item) => item.id).filter(Boolean),
    [customMaterials],
  );
  const customInteractiveIds = useMemo(
    () => customInteractives.map((item) => item.id).filter(Boolean),
    [customInteractives],
  );

  const assignToTargets = async (payload) => {
    if (!targets.length) {
      throw new Error(isGroupAssign ? "В группе пока нет учеников" : "Не выбран ученик");
    }
    const errors = [];
    const homeworkIds = [];
    for (const target of targets) {
      try {
        const created = await assignStudentHomework(target.id, payload);
        if (created?.id) homeworkIds.push(created.id);
      } catch (err) {
        errors.push(`${target.name || target.id}: ${err.message || "ошибка"}`);
      }
    }
    if (errors.length === targets.length) {
      throw new Error(errors[0] || "Не удалось выдать ДЗ");
    }
    if (pendingAttachmentFiles.length && homeworkIds.length) {
      const uploadResult = await uploadPendingHomeworkFiles(homeworkIds, pendingAttachmentFiles);
      if (uploadResult.errors?.length && !uploadResult.uploaded) {
        throw new Error(
          uploadResult.errors[0]?.detail || "ДЗ создано, но файлы не удалось прикрепить",
        );
      }
      if (uploadResult.errors?.length) {
        errors.push(
          `Часть файлов не загрузилась: ${uploadResult.errors.map((e) => e.name || e.detail).join("; ")}`,
        );
      }
    }
    if (errors.length) {
      throw new Error(`Выдано частично. Не удалось: ${errors.join("; ")}`);
    }
  };

  const handlePlanSubmit = async (e) => {
    e.preventDefault();
    if (!selectedId) {
      setError("Выберите занятие");
      return;
    }
    setSubmitting(true);
    setError("");
    try {
      await assignToTargets({
        plan_item_id: Number(selectedId),
        due_at: resolveDueAtPayload(),
        ...(scheduleEventId ? { schedule_event_id: Number(scheduleEventId) } : {}),
        ...(studentSubjectId ? { student_subject_id: Number(studentSubjectId) } : {}),
      });
      onAssigned?.();
      onClose?.();
    } catch (err) {
      setError(err.message || "Не удалось выдать ДЗ");
    } finally {
      setSubmitting(false);
    }
  };

  const handleCustomSubmit = async (e) => {
    e.preventDefault();
    const title = customTitle.trim();
    const description = customDescription.trim();
    if (!title) {
      setError("Укажите название задания");
      return;
    }
    if (
      !description
      && customMaterialIds.length === 0
      && customInteractiveIds.length === 0
      && pendingAttachmentFiles.length === 0
    ) {
      setError("Добавьте описание, материалы или файлы");
      return;
    }
    setSubmitting(true);
    setError("");
    try {
      await assignToTargets({
        title,
        description,
        material_ids: customMaterialIds,
        interactive_ids: customInteractiveIds,
        due_at: resolveDueAtPayload(),
        ...(scheduleEventId ? { schedule_event_id: Number(scheduleEventId) } : {}),
        ...(studentSubjectId ? { student_subject_id: Number(studentSubjectId) } : {}),
      });
      onAssigned?.();
      onClose?.();
    } catch (err) {
      setError(err.message || "Не удалось выдать ДЗ");
    } finally {
      setSubmitting(false);
    }
  };

  const handleAttachMaterial = async (material) => {
    if (!material?.id) return;
    setCustomMaterials((prev) => (
      prev.some((item) => item.id === material.id) ? prev : [...prev, material]
    ));
    setResourcePickerOpen(false);

    if (material.material_type === "task_set" && material.external_url && primaryStudent?.id) {
      const m = String(material.external_url).match(/\/variant\/(\d+)/);
      const variantId = m ? m[1] : null;
      if (variantId) {
        try {
          const data = await checkVariantTasksOverlap(primaryStudent.id, variantId);
          const ids = data?.duplicate_task_ids ?? [];
          if (ids.length > 0) {
            setDuplicateTaskIds((prev) => [...new Set([...prev, ...ids])]);
          }
        } catch {
          // Ошибка проверки не блокирует добавление варианта
        }
      }
    }
  };

  const handleAttachInteractive = async (interactive) => {
    if (!interactive?.id) return;
    setCustomInteractives((prev) => (
      prev.some((item) => item.id === interactive.id) ? prev : [...prev, interactive]
    ));
    setResourcePickerOpen(false);
  };

  const showModeTabs = hasPlan || hasPlanItems;

  return (
    <>
      <CabinetModal title={modalTitle} onClose={onClose}>
        <form
          className="cb-modal-form cb-hw-assign-form"
          onSubmit={mode === "plan" ? handlePlanSubmit : handleCustomSubmit}
        >
          {error ? <p className="cb-modal-form__error" role="alert">{error}</p> : null}

          {isGroupAssign && targets.length > 0 ? (
            <p className="cabinet-auth-muted">
              Задание будет выдано всем ученикам группы ({targets.length}).
            </p>
          ) : null}

          {showModeTabs ? (
            <div className="cb-hw-assign-mode" role="tablist" aria-label="Способ выдачи ДЗ">
              <button
                type="button"
                role="tab"
                aria-selected={mode === "plan"}
                className={`cb-hw-assign-mode__btn${mode === "plan" ? " cb-hw-assign-mode__btn--active" : ""}`}
                onClick={() => setMode("plan")}
                disabled={submitting || !hasPlanItems}
              >
                Из плана
              </button>
              <button
                type="button"
                role="tab"
                aria-selected={mode === "custom"}
                className={`cb-hw-assign-mode__btn${mode === "custom" ? " cb-hw-assign-mode__btn--active" : ""}`}
                onClick={() => setMode("custom")}
                disabled={submitting}
              >
                Дополнительное
              </button>
            </div>
          ) : null}

          {mode === "plan" ? (
            <>
              {!hasPlan && !loading ? (
                <div className="cb-hw-assign-empty">
                  <p className="cabinet-auth-muted">
                    Привяжите план уроков или выдайте дополнительное задание на вкладке «Дополнительное».
                  </p>
                  {onAttachPlan ? (
                    <button
                      type="button"
                      className="cb-btn cb-btn--primary cb-btn--sm"
                      onClick={() => onAttachPlan(group || student || primaryStudent)}
                    >
                      Привязать план
                    </button>
                  ) : null}
                </div>
              ) : null}

              {hasPlan ? (
                <>
                  {planTitle ? (
                    <div className="cb-entity-plan-current">
                      <div className="cb-entity-plan-current__body">
                        <span className="cb-entity-plan-current__label">План</span>
                        {options?.plan_id ? (
                          <Link to={`/cabinet/plans/${options.plan_id}`} className="cb-entity-plan-current__title">
                            {planTitle}
                          </Link>
                        ) : (
                          <span className="cb-entity-plan-current__title">{planTitle}</span>
                        )}
                      </div>
                    </div>
                  ) : null}

                  <div className="cb-attach-section">
                    <HomeworkAttachmentsField
                      pendingFiles={pendingAttachmentFiles}
                      onPendingFilesChange={setPendingAttachmentFiles}
                      disabled={submitting}
                    />
                  </div>
                  <div className="cb-attach-section">
                    <h3 className="cb-attach-section__title">Занятие с ДЗ</h3>
                    {loading ? (
                      <p className="cabinet-auth-muted">Загрузка…</p>
                    ) : items.length === 0 ? (
                      <p className="cabinet-auth-muted">
                        В плане пока нет занятий с домашним заданием. Добавьте ДЗ в редакторе плана или выдайте дополнительное задание.
                      </p>
                    ) : (
                      <div className="cb-attach-list">
                        {items.map((item) => (
                          <HomeworkPickItem
                            key={item.id}
                            item={item}
                            selected={String(selectedId) === String(item.id)}
                            onSelect={setSelectedId}
                            disabled={submitting}
                          />
                        ))}
                      </div>
                    )}
                  </div>

                  {items.length > 0 ? (
                    <>
                      <label className="cb-field">
                        <span>Срок выполнения</span>
                        <input
                          type="datetime-local"
                          value={deadline}
                          onChange={(e) => {
                            setDeadlineTouched(true);
                            setDeadline(e.target.value);
                          }}
                          disabled={submitting}
                        />
                        {suggestedDueAt ? (
                          <span className="cabinet-auth-muted">
                            До следующего урока{options?.plan_subject ? " по предмету" : ""}: {formatSuggestedHint(suggestedDueAt)}
                          </span>
                        ) : (
                          <span className="cabinet-auth-muted">
                            Если следующего урока нет, срок можно указать вручную (дата и время)
                          </span>
                        )}
                      </label>
                      <div className="cb-modal-form__actions">
                        <div className="cb-modal-form__actions-main">
                          <button type="button" className="cb-btn cb-btn--outline" onClick={onClose} disabled={submitting}>
                            Отмена
                          </button>
                          <button type="submit" className="cb-btn cb-btn--primary" disabled={submitting || loading || !selectedId}>
                            {submitting ? "Выдаём…" : "Выдать ДЗ"}
                          </button>
                        </div>
                      </div>
                    </>
                  ) : (
                    <div className="cb-modal-form__actions">
                      <div className="cb-modal-form__actions-main">
                        <button type="button" className="cb-btn cb-btn--outline" onClick={onClose}>
                          Закрыть
                        </button>
                      </div>
                    </div>
                  )}
                </>
              ) : loading ? (
                <p className="cabinet-auth-muted">Загрузка…</p>
              ) : null}
            </>
          ) : (
            <>
              <label className="cb-field">
                <span>Название</span>
                <input
                  type="text"
                  value={customTitle}
                  onChange={(e) => setCustomTitle(e.target.value)}
                  placeholder="Например, Дополнительный вариант"
                  disabled={submitting}
                  required
                />
              </label>

              <label className="cb-field cb-field--wide">
                <span>Описание</span>
                <textarea
                  rows={4}
                  value={customDescription}
                  onChange={(e) => setCustomDescription(e.target.value)}
                  placeholder="Что нужно сделать ученику"
                  disabled={submitting}
                />
              </label>

              <div className="cb-attach-section">
                <div className="cb-hw-assign-section-head">
                  <h3 className="cb-attach-section__title">Материалы</h3>
                  <button
                    type="button"
                    className="cb-btn cb-btn--outline cb-btn--sm"
                    onClick={() => setResourcePickerOpen(true)}
                    disabled={submitting}
                  >
                    Добавить материал
                  </button>
                </div>
                {customMaterials.length === 0 && customInteractives.length === 0 ? (
                  <p className="cabinet-auth-muted">
                    Можно выбрать урок из библиотеки платформы, файлы учителя, интерактив или вариант.
                  </p>
                ) : (
                  <div className="cb-hw-assign-resource-list">
                    {customMaterials.map((material) => (
                      <AttachedResourceRow
                        key={`material-${material.id}`}
                        icon="file"
                        title={material.title}
                        meta={material.material_type === "task_set" ? "Вариант" : "Материал"}
                        disabled={submitting}
                        onRemove={() => {
                          setCustomMaterials((prev) => prev.filter((item) => item.id !== material.id));
                          setDuplicateTaskIds([]);
                        }}
                      />
                    ))}
                    {customInteractives.map((interactive) => (
                      <AttachedResourceRow
                        key={`interactive-${interactive.id}`}
                        icon="interactive"
                        title={getInteractiveDisplayTitle(interactive)}
                        meta={interactive.topic || "Интерактив"}
                        disabled={submitting}
                        onRemove={() => setCustomInteractives((prev) => prev.filter((item) => item.id !== interactive.id))}
                      />
                    ))}
                  </div>
                )}
              </div>

              <div className="cb-attach-section">
                <HomeworkAttachmentsField
                  pendingFiles={pendingAttachmentFiles}
                  onPendingFilesChange={setPendingAttachmentFiles}
                  disabled={submitting}
                />
              </div>

              <label className="cb-field">
                <span>Срок выполнения</span>
                <input
                  type="datetime-local"
                  value={deadline}
                  onChange={(e) => {
                    setDeadlineTouched(true);
                    setDeadline(e.target.value);
                  }}
                  disabled={submitting}
                />
                {suggestedDueAt ? (
                  <span className="cabinet-auth-muted">
                    До следующего урока{options?.plan_subject ? " по предмету" : ""}: {formatSuggestedHint(suggestedDueAt)}
                  </span>
                ) : (
                  <span className="cabinet-auth-muted">Укажите дату и время сдачи</span>
                )}
              </label>

              {duplicateTaskIds.length > 0 ? (
                <div className="cb-hw-assign-duplicate-warn" role="alert">
                  <CabinetIcon name="alert" />
                  <div className="cb-hw-assign-duplicate-warn__body">
                    <p className="cb-hw-assign-duplicate-warn__title">
                      Часть задач уже выдавалась этому ученику
                    </p>
                    <p className="cb-hw-assign-duplicate-warn__ids">
                      ID задач: {duplicateTaskIds.join(", ")}
                    </p>
                  </div>
                </div>
              ) : null}

              <div className="cb-modal-form__actions">
                <div className="cb-modal-form__actions-main">
                  <button type="button" className="cb-btn cb-btn--outline" onClick={onClose} disabled={submitting}>
                    Отмена
                  </button>
                  <button type="submit" className="cb-btn cb-btn--primary" disabled={submitting}>
                    {submitting ? "Выдаём…" : "Выдать ДЗ"}
                  </button>
                </div>
              </div>
            </>
          )}
        </form>
      </CabinetModal>

      <PlanItemResourcesPicker
        scope="homework"
        open={resourcePickerOpen}
        initialTab="library"
        attachedMaterialIds={customMaterialIds}
        attachedInteractiveIds={customInteractiveIds}
        onClose={() => setResourcePickerOpen(false)}
        onAttachMaterial={handleAttachMaterial}
        onAttachInteractive={handleAttachInteractive}
      />
    </>
  );
}
