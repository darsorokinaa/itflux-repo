import { useEffect, useMemo, useState } from "react";
import CabinetIcon from "../CabinetIcons";
import CabinetModal from "./CabinetModal";
import PlanItemResourcesPicker from "./PlanItemResourcesPicker";
import { assignMaterialDirect, fetchStudentSubjects } from "../../utils/cabinetAuth";

function materialMeta(material) {
  return material.material_type_label
    || material.topic
    || (material.material_type === "task_set" ? "Вариант" : "Материал");
}

function AttachedMaterialRow({ material, onRemove, disabled }) {
  return (
    <div className="cb-hw-assign-resource">
      <CabinetIcon name="folder" />
      <span className="cb-hw-assign-resource__body">
        <span className="cb-hw-assign-resource__title">{material.title}</span>
        <span className="cb-hw-assign-resource__meta">{materialMeta(material)}</span>
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

export default function MaterialsAssignModal({
  student = null,
  group = null,
  onClose,
  onAssigned,
}) {
  const [materials, setMaterials] = useState([]);
  const [message, setMessage] = useState("");
  const [pickerOpen, setPickerOpen] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState("");
  const [subjects, setSubjects] = useState([]);
  const [studentSubjectId, setStudentSubjectId] = useState("");

  const targetLabel = group?.name || student?.name || "";
  const materialIds = useMemo(
    () => materials.map((item) => item.id).filter(Boolean),
    [materials],
  );

  useEffect(() => {
    if (!student?.id || group?.id) {
      setSubjects([]);
      setStudentSubjectId("");
      return undefined;
    }
    let cancelled = false;
    fetchStudentSubjects(student.id)
      .then((data) => {
        if (cancelled) return;
        const list = (Array.isArray(data) ? data : data?.items || [])
          .filter((s) => s.status !== "archived");
        setSubjects(list);
        if (list.length === 1) setStudentSubjectId(String(list[0].id));
      })
      .catch(() => {
        if (!cancelled) setSubjects([]);
      });
    return () => { cancelled = true; };
  }, [student?.id, group?.id]);

  const handleAttachMaterial = async (material) => {
    if (!material?.id) return;
    setMaterials((prev) => (
      prev.some((item) => item.id === material.id) ? prev : [...prev, material]
    ));
    setPickerOpen(false);
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (!materialIds.length) {
      setError("Добавьте хотя бы один материал");
      return;
    }
    if (!group?.id && !student?.id) {
      setError("Не выбран получатель");
      return;
    }
    if (!group?.id && subjects.length > 1 && !studentSubjectId) {
      setError("Выберите предмет ученика");
      return;
    }
    if (!group?.id && subjects.length === 0) {
      setError("У ученика нет предметов. Добавьте предмет в карточке ученика.");
      return;
    }

    setSubmitting(true);
    setError("");
    try {
      const base = {
        message: message.trim() || undefined,
        ...(group?.id
          ? { group_id: group.id }
          : {
              student_id: student.id,
              student_subject_id: studentSubjectId ? Number(studentSubjectId) : undefined,
            }),
      };
      for (const materialId of materialIds) {
        await assignMaterialDirect({ ...base, material_id: materialId });
      }
      onAssigned?.({ materialIds });
      onClose?.();
    } catch (err) {
      setError(err.message || "Не удалось выдать материалы");
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <>
      <CabinetModal title={`Выдать материалы — ${targetLabel}`} onClose={onClose}>
        <form className="cb-modal-form cb-hw-assign-form" onSubmit={handleSubmit}>
          {error ? <p className="cb-modal-form__error" role="alert">{error}</p> : null}

          <p className="cabinet-auth-muted">
            Материалы появятся у ученика во вкладке «Материалы» — без домашнего задания.
          </p>

          {!group?.id && subjects.length ? (
            <label className="cb-field">
              <span>Предмет{subjects.length > 1 ? " *" : ""}</span>
              <select
                value={studentSubjectId}
                onChange={(e) => setStudentSubjectId(e.target.value)}
                required={subjects.length > 1}
              >
                {subjects.length > 1 ? <option value="">Выберите предмет</option> : null}
                {subjects.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.display_label || s.subject_label || s.subject}
                  </option>
                ))}
              </select>
            </label>
          ) : null}

          <div className="cb-attach-section">
            <div className="cb-hw-assign-section-head">
              <h3 className="cb-attach-section__title">Материалы</h3>
              <button
                type="button"
                className="cb-btn cb-btn--outline cb-btn--sm"
                onClick={() => setPickerOpen(true)}
                disabled={submitting}
              >
                Добавить материал
              </button>
            </div>
            {materials.length === 0 ? (
              <p className="cabinet-auth-muted">
                Выберите урок из библиотеки платформы или файлы учителя.
              </p>
            ) : (
              <div className="cb-hw-assign-resource-list">
                {materials.map((material) => (
                  <AttachedMaterialRow
                    key={material.id}
                    material={material}
                    disabled={submitting}
                    onRemove={() => setMaterials((prev) => prev.filter((item) => item.id !== material.id))}
                  />
                ))}
              </div>
            )}
          </div>

          <label className="cb-field cb-field--wide">
            <span>Сообщение для учеников <span className="cabinet-auth-muted">(необязательно)</span></span>
            <textarea
              rows={3}
              value={message}
              onChange={(e) => setMessage(e.target.value)}
              placeholder="Например: прочитайте перед следующим занятием"
              disabled={submitting}
            />
          </label>

          <div className="cb-modal-form__actions">
            <div className="cb-modal-form__actions-main">
              <button type="button" className="cb-btn cb-btn--outline" onClick={onClose} disabled={submitting}>
                Отмена
              </button>
              <button
                type="submit"
                className="cb-btn cb-btn--primary"
                disabled={submitting || materials.length === 0}
              >
                {submitting ? "Выдаём…" : "Выдать материалы"}
              </button>
            </div>
          </div>
        </form>
      </CabinetModal>

      <PlanItemResourcesPicker
        scope="materials"
        open={pickerOpen}
        initialTab="library"
        attachedMaterialIds={materialIds}
        onClose={() => setPickerOpen(false)}
        onAttachMaterial={handleAttachMaterial}
      />
    </>
  );
}
