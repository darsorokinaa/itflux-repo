import { useCallback, useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import CabinetIcon from "../CabinetIcons";
import CabinetModal from "./CabinetModal";
import ConfirmActionModal from "./ConfirmActionModal";
import { mapApiPlan, planCanBeAttached, planSubjectLine, targetDirectionSlug } from "../lessonPlansData";
import {
  enrollLessonPlan,
  fetchLessonPlans,
  updatePlanEnrollment,
} from "../../utils/cabinetAuth";

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
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [selectingId, setSelectingId] = useState(null);
  const [detaching, setDetaching] = useState(false);
  const [detachConfirmOpen, setDetachConfirmOpen] = useState(false);

  const targetName = targetType === "group" ? target?.name : target?.name;
  const directionSlug = targetDirectionSlug(target);

  const loadPlans = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const data = await fetchLessonPlans({ mine: "true" });
      setPlans((data || []).map(mapApiPlan));
    } catch (err) {
      setError(err.message || "Не удалось загрузить планы");
      setPlans([]);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadPlans();
  }, [loadPlans]);

  const currentPlanId = enrollment?.planId ? String(enrollment.planId) : null;

  const sortedPlans = useMemo(() => {
    let list = plans;
    if (directionSlug) {
      const matched = plans.filter((p) => p.direction === directionSlug);
      const rest = plans.filter((p) => p.direction !== directionSlug);
      list = [...matched, ...rest];
    }
    if (currentPlanId) {
      list = list.filter((plan) => String(plan.id) !== currentPlanId);
    }
    return list;
  }, [plans, directionSlug, currentPlanId]);

  const { attachablePlans, unavailablePlans } = useMemo(() => {
    const attachable = [];
    const unavailable = [];
    sortedPlans.forEach((plan) => {
      if (planCanBeAttached(plan)) attachable.push(plan);
      else unavailable.push(plan);
    });
    return { attachablePlans: attachable, unavailablePlans: unavailable };
  }, [sortedPlans]);

  const handleSelect = async (planId) => {
    const plan = plans.find((entry) => String(entry.id) === String(planId));
    if (!planCanBeAttached(plan)) {
      setError("Черновик плана нельзя назначить. Сначала опубликуйте его.");
      return;
    }
    setSelectingId(planId);
    setError("");
    try {
      const attachPayload = targetType === "student"
        ? { student: Number(target.id) }
        : { group: Number(target.id) };

      if (enrollment?.id) {
        await updatePlanEnrollment(enrollment.id, {
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
    if (!enrollment?.id) return;
    setDetachConfirmOpen(true);
  };

  const confirmDetach = async () => {
    if (!enrollment?.id) return;
    setDetaching(true);
    setError("");
    try {
      await updatePlanEnrollment(enrollment.id, { status: "cancelled" });
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

  return (
    <>
      <CabinetModal title={title} onClose={onClose}>
        <div className="cb-modal-form">
          {error ? <p className="cb-modal-form__error" role="alert">{error}</p> : null}

          {enrollment?.planTitle ? (
            <div className="cb-entity-plan-current">
              <div className="cb-entity-plan-current__body">
                <span className="cb-entity-plan-current__label">Текущий план</span>
                <Link to={`/cabinet/plans/${enrollment.planId}`} className="cb-entity-plan-current__title">
                  {enrollment.planTitle}
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

          <div className="cb-attach-section">
            <h3 className="cb-attach-section__title">
              {enrollment ? "Сменить план" : "Выберите план"}
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
                      ? "Нет других опубликованных планов для назначения."
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
                          hint={plan.status === "draft" ? "Черновик — опубликуйте план" : "План недоступен"}
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
