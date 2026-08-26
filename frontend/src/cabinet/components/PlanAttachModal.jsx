import { useCallback, useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import CabinetIcon from "../CabinetIcons";
import CabinetModal from "./CabinetModal";
import ConfirmActionModal from "./ConfirmActionModal";
import {
  mapApiPlan,
  planCanBeAttached,
  planSubjectLine,
  planSubjectsMatch,
  targetDirectionSlug,
} from "../lessonPlansData";
import { PLAN_DATE_INTERVALS } from "../planDates";
import {
  enrollLessonPlan,
  fetchLessonPlans,
  fetchStudentSubjects,
  updatePlanEnrollment,
} from "../../utils/cabinetAuth";

function asEnrollmentList(enrollment) {
  if (!enrollment) return [];
  return Array.isArray(enrollment) ? enrollment : [enrollment];
}

function PlanPickItem({ plan, onSelect, selecting, disabled, hint }) {
  return (
    <button
      type="button"
      className={`cb-attach-item${disabled ? " cb-attach-item--disabled" : ""}`}
      onClick={() => !disabled && onSelect(plan.id)}
      disabled={selecting || disabled}
      title={disabled ? hint : undefined}
    >
      <CabinetIcon name="plan" />
      <span className="cb-attach-item__body">
        <span className="cb-attach-item__title">{plan.title}</span>
        <span className="cb-attach-item__meta">
          {disabled ? hint : planSubjectLine(plan)}
        </span>
      </span>
    </button>
  );
}

export default function PlanAttachModal({
  targetType,
  target,
  enrollment,
  onClose,
  onAttached,
}) {
  const [plans, setPlans] = useState([]);
  const [subjects, setSubjects] = useState([]);
  const [subjectId, setSubjectId] = useState("");
  const [startDate, setStartDate] = useState("");
  const [dateInterval, setDateInterval] = useState("weekly");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [selectingId, setSelectingId] = useState(null);
  const [detaching, setDetaching] = useState(false);
  const [detachConfirmOpen, setDetachConfirmOpen] = useState(false);

  const targetName = targetType === "group" ? target?.name : target?.name;
  const directionSlug = targetDirectionSlug(target);
  const enrollments = asEnrollmentList(enrollment);
  const isStudent = targetType === "student";

  const selectedSubject = useMemo(
    () => subjects.find((item) => String(item.id) === String(subjectId)) || null,
    [subjects, subjectId],
  );

  const currentEnrollment = useMemo(() => {
    if (!isStudent) return enrollments[0] || null;
    if (subjectId) {
      return enrollments.find((item) => String(item.studentSubjectId) === String(subjectId)) || null;
    }
    return enrollments[0] || null;
  }, [enrollments, isStudent, subjectId]);

  const load = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const plansPromise = fetchLessonPlans({ mine: "true" });
      const subjectsPromise = isStudent && target?.id
        ? fetchStudentSubjects(target.id)
        : Promise.resolve([]);
      const [plansData, subjectsData] = await Promise.all([plansPromise, subjectsPromise]);
      setPlans((plansData || []).map(mapApiPlan));
      const list = Array.isArray(subjectsData) ? subjectsData : subjectsData?.items || [];
      const active = list.filter((item) => item.status !== "archived");
      setSubjects(active);
      setSubjectId((prev) => {
        if (prev && active.some((item) => String(item.id) === String(prev))) return prev;
        if (active.length === 1) return String(active[0].id);
        return "";
      });
    } catch (err) {
      setError(err.message || "Не удалось загрузить планы");
      setPlans([]);
      setSubjects([]);
    } finally {
      setLoading(false);
    }
  }, [isStudent, target?.id]);

  useEffect(() => {
    load();
  }, [load]);

  const currentPlanId = currentEnrollment?.planId ? String(currentEnrollment.planId) : null;

  const sortedPlans = useMemo(() => {
    let list = plans;
    const subjectCode = selectedSubject?.subject;
    if (subjectCode) {
      const matched = plans.filter((plan) => planSubjectsMatch(plan.subject, subjectCode));
      const rest = plans.filter((plan) => !planSubjectsMatch(plan.subject, subjectCode));
      list = [...matched, ...rest];
    } else if (directionSlug) {
      const matched = plans.filter((p) => p.direction === directionSlug);
      const rest = plans.filter((p) => p.direction !== directionSlug);
      list = [...matched, ...rest];
    }
    if (currentPlanId) {
      list = list.filter((plan) => String(plan.id) !== currentPlanId);
    }
    return list;
  }, [plans, directionSlug, currentPlanId, selectedSubject]);

  const { attachablePlans, unavailablePlans } = useMemo(() => {
    const attachable = [];
    const unavailable = [];
    sortedPlans.forEach((plan) => {
      const subjectMismatch = selectedSubject?.subject
        && !planSubjectsMatch(plan.subject, selectedSubject.subject);
      if (planCanBeAttached(plan) && !subjectMismatch) attachable.push(plan);
      else unavailable.push(plan);
    });
    return { attachablePlans: attachable, unavailablePlans: unavailable };
  }, [sortedPlans, selectedSubject]);

  const datePayload = () => {
    if (!startDate) return {};
    return { start_date: startDate, frequency: dateInterval };
  };

  const handleSelect = async (planId) => {
    const plan = plans.find((entry) => String(entry.id) === String(planId));
    if (!planCanBeAttached(plan)) {
      setError("Черновик плана нельзя назначить. Сначала опубликуйте его.");
      return;
    }
    if (isStudent && subjects.length === 0) {
      setError("Сначала добавьте предмет ученика в карточке ученика.");
      return;
    }
    if (isStudent && subjects.length > 1 && !subjectId) {
      setError("Выберите предмет, к которому назначается план.");
      return;
    }
    if (selectedSubject?.subject && !planSubjectsMatch(plan.subject, selectedSubject.subject)) {
      setError("Предмет плана не совпадает с выбранным предметом ученика.");
      return;
    }
    setSelectingId(planId);
    setError("");
    try {
      const attachPayload = targetType === "student"
        ? {
            student: Number(target.id),
            ...(subjectId ? { student_subject: Number(subjectId) } : {}),
            ...datePayload(),
          }
        : { group: Number(target.id), ...datePayload() };

      if (currentEnrollment?.id) {
        await updatePlanEnrollment(currentEnrollment.id, {
          ...attachPayload,
          plan: planId,
          status: "active",
        });
      } else {
        await enrollLessonPlan(planId, attachPayload);
      }
      onAttached?.();
      onClose?.();
    } catch (err) {
      setError(err.message || "Не удалось привязать план");
    } finally {
      setSelectingId(null);
    }
  };

  const handleDetach = () => {
    if (!currentEnrollment?.id) return;
    setDetachConfirmOpen(true);
  };

  const confirmDetach = async () => {
    if (!currentEnrollment?.id) return;
    setDetaching(true);
    setError("");
    try {
      await updatePlanEnrollment(currentEnrollment.id, { status: "cancelled" });
      setDetachConfirmOpen(false);
      onAttached?.();
      onClose?.();
    } catch (err) {
      setError(err.message || "Не удалось отвязать план");
    } finally {
      setDetaching(false);
    }
  };

  const title = targetType === "group"
    ? `План для группы «${targetName}»`
    : `План для ${targetName}`;

  const currentLabel = currentEnrollment?.studentSubjectLabel
    ? `${currentEnrollment.planTitle} · ${currentEnrollment.studentSubjectLabel}`
    : currentEnrollment?.planTitle;

  return (
    <>
      <CabinetModal title={title} onClose={onClose}>
        <div className="cb-modal-form">
          {error ? <p className="cb-modal-form__error" role="alert">{error}</p> : null}

          {isStudent && subjects.length > 1 ? (
            <label className="cb-field">
              <span>Предмет *</span>
              <select value={subjectId} onChange={(e) => setSubjectId(e.target.value)}>
                <option value="">Выберите предмет</option>
                {subjects.map((item) => (
                  <option key={item.id} value={item.id}>
                    {item.display_label || item.subject_label || item.subject}
                  </option>
                ))}
              </select>
            </label>
          ) : null}

          {isStudent && subjects.length === 0 && !loading ? (
            <p className="cabinet-auth-muted">
              Сначала добавьте предмет ученика — у каждого предмета свой план обучения.
            </p>
          ) : null}

          {currentEnrollment?.planTitle ? (
            <div className="cb-entity-plan-current">
              <div className="cb-entity-plan-current__body">
                <span className="cb-entity-plan-current__label">
                  {selectedSubject ? `Текущий план · ${selectedSubject.display_label || selectedSubject.subject_label}` : "Текущий план"}
                </span>
                <Link to={`/cabinet/plans/${currentEnrollment.planId}`} className="cb-entity-plan-current__title">
                  {currentLabel}
                </Link>
              </div>
              <button
                type="button"
                className="cb-btn cb-btn--outline cb-btn--sm"
                onClick={handleDetach}
                disabled={detaching || Boolean(selectingId)}
              >
                {detaching ? "…" : "Отвязать"}
              </button>
            </div>
          ) : null}

          <div className="cb-pe-dates cb-pe-dates--attach">
            <label className="cb-pe-field">
              <span>Дата первого занятия</span>
              <input
                type="date"
                value={startDate}
                onChange={(e) => setStartDate(e.target.value)}
              />
            </label>
            <label className="cb-pe-field">
              <span>Как часто</span>
              <select value={dateInterval} onChange={(e) => setDateInterval(e.target.value)}>
                {PLAN_DATE_INTERVALS.map((item) => (
                  <option key={item.id} value={item.id}>{item.label}</option>
                ))}
              </select>
            </label>
            <p className="cb-pe-dates__hint">
              Если указать дату, остальные занятия плана расставятся автоматически. Потом даты можно поправить в плане.
            </p>
          </div>

          <div className="cb-attach-section">
            <h3 className="cb-attach-section__title">
              {currentEnrollment ? "Сменить план" : "Выберите план"}
            </h3>
            {loading ? (
              <p className="cabinet-auth-muted">Загрузка планов…</p>
            ) : sortedPlans.length === 0 ? (
              <p className="cabinet-auth-muted">
                {currentPlanId ? "Других планов пока нет." : "Планов пока нет."}
              </p>
            ) : (
              <>
                {attachablePlans.length === 0 ? (
                  <p className="cabinet-auth-muted">
                    {currentPlanId
                      ? "Нет других опубликованных планов для этого предмета."
                      : "Нет опубликованных планов для назначения. Опубликуйте план в редакторе."}
                  </p>
                ) : (
                  <div className="cb-attach-list">
                    {attachablePlans.map((plan) => (
                      <PlanPickItem
                        key={plan.id}
                        plan={plan}
                        onSelect={handleSelect}
                        selecting={Boolean(selectingId)}
                      />
                    ))}
                  </div>
                )}
                {unavailablePlans.length > 0 ? (
                  <div className="cb-attach-section cb-attach-section--muted">
                    <h4 className="cb-attach-section__subtitle">Недоступны для назначения</h4>
                    <div className="cb-attach-list">
                      {unavailablePlans.map((plan) => (
                        <PlanPickItem
                          key={plan.id}
                          plan={plan}
                          onSelect={handleSelect}
                          selecting={Boolean(selectingId)}
                          disabled
                          hint={
                            plan.status === "draft"
                              ? "Черновик — опубликуйте план"
                              : selectedSubject && !planSubjectsMatch(plan.subject, selectedSubject.subject)
                                ? "Другой предмет"
                                : "План недоступен"
                          }
                        />
                      ))}
                    </div>
                  </div>
                ) : null}
              </>
            )}
          </div>

          <div className="cb-modal-form__actions">
            <div className="cb-modal-form__actions-main">
              <Link to="/cabinet/plans/new" className="cb-btn cb-btn--primary" onClick={onClose}>
                Создать свой план
              </Link>
              <Link to="/cabinet/plans" className="cb-btn cb-btn--outline" onClick={onClose}>
                Готовые планы
              </Link>
              <button type="button" className="cb-btn cb-btn--outline" onClick={onClose}>
                Закрыть
              </button>
            </div>
          </div>
        </div>
      </CabinetModal>

      <ConfirmActionModal
        open={detachConfirmOpen}
        title="Отвязать план?"
        text="Отвязать план от этой карточки?"
        confirmLabel="Отвязать"
        danger
        loading={detaching}
        onClose={() => {
          if (!detaching) setDetachConfirmOpen(false);
        }}
        onConfirm={confirmDetach}
      />
    </>
  );
}
