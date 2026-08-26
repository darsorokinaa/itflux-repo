import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import ConfirmActionModal from "./ConfirmActionModal";
import {
  createStudentSubject,
  deleteStudentSubject,
  fetchLessonPlanSubjects,
  fetchLessonPlans,
  fetchStudentSubjects,
  updateStudentSubject,
} from "../../utils/cabinetAuth";
import { STUDENT_DIRECTION_OPTIONS } from "../cabinetMappers";
import { trackActivationIntent } from "../activationAnalytics";
import { mapApiPlan, planCanBeAttached, planSubjectsMatch } from "../lessonPlansData";
import { PLAN_DATE_INTERVALS, formatPlanDateLabel } from "../planDates";

const EMPTY_FORM = {
  subject: "inf",
  title: "",
  direction: "other",
  level: "",
  plan_id: "",
  start_date: "",
  date_interval: "weekly",
};

export default function StudentSubjectsBlock({ studentId, onChanged }) {
  const [items, setItems] = useState([]);
  const [subjectOptions, setSubjectOptions] = useState([]);
  const [plans, setPlans] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [editor, setEditor] = useState(null); // null | { mode, item }
  const [form, setForm] = useState(EMPTY_FORM);
  const [saving, setSaving] = useState(false);
  const [archiveTarget, setArchiveTarget] = useState(null);

  const load = async () => {
    if (!studentId) return;
    setLoading(true);
    setError("");
    try {
      const [subjectsResp, opts, plansResp] = await Promise.all([
        fetchStudentSubjects(studentId, { include_archived: 1 }),
        fetchLessonPlanSubjects().catch(() => ({ items: [] })),
        fetchLessonPlans({ mine: "true" }).catch(() => []),
      ]);
      const list = Array.isArray(subjectsResp) ? subjectsResp : subjectsResp?.items || [];
      setItems(list);
      const options = Array.isArray(opts)
        ? opts
        : opts?.subjects || opts?.items || [];
      setSubjectOptions(
        options.length
          ? options.map((o) => ({ value: o.id || o.value, label: o.label || o.name || o.id }))
          : [
              { value: "inf", label: "Информатика" },
              { value: "math", label: "Математика" },
              { value: "prog", label: "Программирование" },
              { value: "other", label: "Другое" },
            ],
      );
      const planList = (Array.isArray(plansResp) ? plansResp : plansResp?.results || plansResp?.items || [])
        .map(mapApiPlan)
        .filter((plan) => planCanBeAttached(plan));
      setPlans(planList);
    } catch (err) {
      setError(err.message || "Не удалось загрузить предметы");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    load();
  }, [studentId]);

  const openCreate = () => {
    trackActivationIntent("subject_creation_started", { source: "student_subjects", objectId: studentId });
    setForm({
      ...EMPTY_FORM,
      subject: subjectOptions[0]?.value || "inf",
    });
    setEditor({ mode: "create" });
  };

  const openEdit = (item) => {
    setForm({
      subject: item.subject || "inf",
      title: item.title || "",
      direction: item.direction || "other",
      level: item.level || "",
      plan_id: item.plan_enrollment?.plan_id ? String(item.plan_enrollment.plan_id) : "",
      start_date: item.plan_enrollment?.start_date || "",
      date_interval: PLAN_DATE_INTERVALS.some((interval) => interval.id === item.plan_enrollment?.frequency)
        ? item.plan_enrollment.frequency
        : "weekly",
    });
    setEditor({ mode: "edit", item });
  };

  const setField = (field, value) => {
    setForm((prev) => {
      const next = { ...prev, [field]: value };
      if (field === "subject" && prev.plan_id) {
        const plan = plans.find((p) => String(p.id) === String(prev.plan_id));
        if (plan && !planSubjectsMatch(plan.subject, value)) {
          next.plan_id = "";
        }
      }
      return next;
    });
  };

  const handleSave = async (e) => {
    e?.preventDefault?.();
    e?.stopPropagation?.();
    if (!form.subject) {
      setError("Выберите предмет");
      return;
    }
    setSaving(true);
    setError("");
    try {
      const payload = {
        subject: form.subject,
        title: form.title.trim(),
        direction: form.direction || "other",
        level: form.level.trim(),
        plan_id: form.plan_id ? Number(form.plan_id) : null,
      };
      const prevEnrollment = editor?.item?.plan_enrollment;
      const startChanged = form.start_date !== (prevEnrollment?.start_date || "");
      const intervalChanged = Boolean(form.start_date)
        && form.date_interval !== (prevEnrollment?.frequency || "weekly");
      const planChanged = String(form.plan_id || "") !== String(prevEnrollment?.plan_id || "");
      if (form.plan_id && form.start_date && (editor?.mode === "create" || startChanged || intervalChanged || planChanged)) {
        payload.start_date = form.start_date;
        payload.date_interval = form.date_interval || "weekly";
      }
      if (editor?.mode === "edit" && editor.item) {
        await updateStudentSubject(studentId, editor.item.id, payload);
      } else {
        await createStudentSubject(studentId, payload);
      }
      setEditor(null);
      await load();
      onChanged?.();
    } catch (err) {
      setError(err.message || "Не удалось сохранить предмет");
    } finally {
      setSaving(false);
    }
  };

  const confirmArchive = async () => {
    if (!archiveTarget) return;
    setSaving(true);
    setError("");
    try {
      await deleteStudentSubject(studentId, archiveTarget.id);
      setArchiveTarget(null);
      await load();
      onChanged?.();
    } catch (err) {
      setError(err.message || "Не удалось архивировать предмет");
    } finally {
      setSaving(false);
    }
  };

  const activeItems = items.filter((i) => i.status !== "archived");
  const archivedItems = items.filter((i) => i.status === "archived");

  return (
    <div className="cb-entity-plan-block cb-student-subjects">
      <div className="cb-entity-plan-block__head">
        <span className="cb-entity-plan-block__label">Предметы ученика</span>
        <button type="button" className="cb-btn cb-btn--outline cb-btn--sm" onClick={openCreate}>
          Добавить предмет
        </button>
      </div>

      {error ? <p className="cb-modal-form__error" role="alert">{error}</p> : null}

      {loading ? (
        <p className="cb-entity-plan-block__empty">Загрузка…</p>
      ) : !activeItems.length ? (
        <p className="cb-entity-plan-block__empty">
          Для ученика пока не добавлены предметы. Добавьте предмет, чтобы создавать занятия,
          назначать планы и выдавать материалы.
        </p>
      ) : (
        <ul className="cb-student-subjects__list">
          {activeItems.map((item) => (
            <li key={item.id} className="cb-student-subjects__item">
              <div className="cb-student-subjects__main">
                <strong>{item.display_label || item.subject_label}</strong>
                <span className="cb-student-subjects__meta">
                  {item.status_label}
                  {item.plan_enrollment?.plan_title ? (
                    <>
                      {" · План: "}
                      <Link to={`/cabinet/plans/${item.plan_enrollment.plan_id}`}>
                        {item.plan_enrollment.plan_title}
                      </Link>
                      {item.plan_enrollment.start_date
                        ? ` · с ${formatPlanDateLabel(item.plan_enrollment.start_date)}`
                        : ""}
                    </>
                  ) : " · План не назначен"}
                </span>
                {item.plan_enrollment?.total ? (
                  <span
                    className={`cb-student-subjects__plan-progress${
                      ["warn", "last", "exhausted", "overbooked"].includes(item.plan_enrollment.warning_level)
                        ? ` cb-student-subjects__plan-progress--${item.plan_enrollment.warning_level}`
                        : ""
                    }`}
                  >
                    {item.plan_enrollment.completed} / {item.plan_enrollment.total}
                    {item.plan_enrollment.remaining > 0
                      ? ` · осталось ${item.plan_enrollment.remaining}`
                      : " · план завершён"}
                  </span>
                ) : null}
              </div>
              <div className="cb-student-subjects__actions">
                <button
                  type="button"
                  className="cb-btn cb-btn--outline cb-btn--sm"
                  onClick={() => openEdit(item)}
                >
                  Редактировать
                </button>
                <button
                  type="button"
                  className="cb-btn cb-btn--outline cb-btn--sm cb-btn--danger"
                  onClick={() => setArchiveTarget(item)}
                >
                  {item.has_history ? "Архивировать" : "Удалить"}
                </button>
              </div>
            </li>
          ))}
        </ul>
      )}

      {archivedItems.length ? (
        <details className="cb-student-subjects__archived">
          <summary>Архивные предметы ({archivedItems.length})</summary>
          <ul className="cb-student-subjects__list">
            {archivedItems.map((item) => (
              <li key={item.id} className="cb-student-subjects__item cb-student-subjects__item--archived">
                <div className="cb-student-subjects__main">
                  <strong>{item.display_label || item.subject_label}</strong>
                  <span className="cb-student-subjects__meta">{item.status_label}</span>
                </div>
              </li>
            ))}
          </ul>
        </details>
      ) : null}

      {editor ? (
        <div className="cb-student-subjects__editor">
          <h4>{editor.mode === "edit" ? "Редактировать предмет" : "Добавить предмет"}</h4>
          {/* Нельзя вкладывать <form> в форму карточки ученика — иначе submit уходит туда. */}
          <div className="cb-plan-editor__grid">
            <label className="cb-field">
              <span>Предмет *</span>
              <select
                value={form.subject}
                onChange={(e) => setField("subject", e.target.value)}
              >
                {subjectOptions.map((opt) => (
                  <option key={opt.value} value={opt.value}>{opt.label}</option>
                ))}
              </select>
            </label>
            <label className="cb-field">
              <span>Направление / уровень</span>
              <select
                value={form.direction}
                onChange={(e) => setField("direction", e.target.value)}
              >
                {STUDENT_DIRECTION_OPTIONS.map((opt) => (
                  <option key={opt.value} value={opt.value}>{opt.label}</option>
                ))}
              </select>
            </label>
            <label className="cb-field cb-field--wide">
              <span>Название направления</span>
              <input
                value={form.title}
                onChange={(e) => setField("title", e.target.value)}
                placeholder="Например: ОГЭ, программирование"
              />
            </label>
            <label className="cb-field">
              <span>Уровень</span>
              <input
                value={form.level}
                onChange={(e) => setField("level", e.target.value)}
                placeholder="Необязательно"
              />
            </label>
            <label className="cb-field">
              <span>План обучения</span>
              <select
                value={form.plan_id}
                onChange={(e) => setField("plan_id", e.target.value)}
              >
                <option value="">Не назначать сейчас</option>
                {plans
                  .filter((p) => {
                    if (String(p.id) === String(form.plan_id)) return true;
                    return planSubjectsMatch(p.subject, form.subject);
                  })
                  .map((p) => (
                    <option key={p.id} value={p.id}>{p.title}</option>
                  ))}
              </select>
            </label>
            {form.plan_id ? (
              <>
                <label className="cb-field">
                  <span>Дата первого занятия</span>
                  <input
                    type="date"
                    value={form.start_date}
                    onChange={(e) => setField("start_date", e.target.value)}
                  />
                </label>
                <label className="cb-field">
                  <span>Как часто</span>
                  <select
                    value={form.date_interval}
                    onChange={(e) => setField("date_interval", e.target.value)}
                  >
                    {PLAN_DATE_INTERVALS.map((item) => (
                      <option key={item.id} value={item.id}>{item.label}</option>
                    ))}
                  </select>
                </label>
              </>
            ) : null}
            <div className="cb-field cb-field--wide cb-modal-form__actions-main">
              <button
                type="button"
                className="cb-btn cb-btn--outline"
                onClick={() => setEditor(null)}
                disabled={saving}
              >
                Отмена
              </button>
              <button
                type="button"
                className="cb-btn cb-btn--primary"
                disabled={saving}
                onClick={handleSave}
              >
                {saving ? "Сохранение…" : "Сохранить"}
              </button>
            </div>
          </div>
        </div>
      ) : null}

      <ConfirmActionModal
        open={Boolean(archiveTarget)}
        title={archiveTarget?.has_history ? "Архивировать предмет?" : "Удалить предмет?"}
        text={
          archiveTarget?.has_history
            ? `По предмету «${archiveTarget?.display_label || ""}» есть связанные уроки или материалы. Предмет будет архивирован, история сохранится.`
            : `Удалить предмет «${archiveTarget?.display_label || ""}»?`
        }
        confirmLabel={archiveTarget?.has_history ? "Архивировать" : "Удалить"}
        danger
        onClose={() => setArchiveTarget(null)}
        onConfirm={confirmArchive}
      />
    </div>
  );
}
