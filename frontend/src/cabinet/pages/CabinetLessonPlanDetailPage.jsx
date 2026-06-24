import { useCallback, useEffect, useState } from "react";
import { Link, Navigate, useNavigate, useParams } from "react-router-dom";
import CabinetIcon from "../CabinetIcons";
import PlanItemDetailModal from "../components/PlanItemDetailModal";
import { CabinetPageShell } from "../CabinetSectionUi";
import {
  PLAN_STATUS_LABELS,
  mapApiPlan,
  planExamLabel,
  planStatusTone,
  planSubjectLabel,
} from "../lessonPlansData";
import { fetchLessonPlan, copyLessonPlan, updateLessonPlan } from "../../utils/cabinetAuth";

function LessonPlanItemCard({ item, plan, onOpen }) {
  const subject = planSubjectLabel(plan.direction);
  const exam = planExamLabel(plan);
  const meta = [exam, subject].filter(Boolean).join(" · ");
  const materialsCount = item.materials?.length || 0;
  const hasHomework = Boolean(item.homeworkDescription?.trim());
  const coverTone = plan.direction || "other";

  const handleKeyDown = (e) => {
    if (e.key === "Enter" || e.key === " ") {
      e.preventDefault();
      onOpen(item);
    }
  };

  return (
    <article
      className="cb-lesson-list-card"
      onClick={() => onOpen(item)}
      onKeyDown={handleKeyDown}
      role="button"
      tabIndex={0}
      aria-label={`Открыть занятие ${item.order}: ${item.title}`}
    >
      <div className={`cb-lesson-list-card__cover cb-lesson-list-card__cover--${coverTone}`}>
        <span className="cb-lesson-list-card__order">{item.order}</span>
      </div>
      <div className="cb-lesson-list-card__body">
        <div className="cb-lesson-list-card__head">
          <h4 className="cb-lesson-list-card__title">{item.title}</h4>
        </div>
        {item.topic ? (
          <p className="cb-lesson-list-card__topic">Тема: {item.topic}</p>
        ) : null}
        {meta ? <p className="cb-lesson-list-card__meta">{meta}</p> : null}
        <div className="cb-lesson-list-card__stats">
          {materialsCount > 0 ? <span>Материалы: {materialsCount}</span> : null}
          <span>ДЗ: {hasHomework ? "есть" : "нет"}</span>
        </div>
      </div>
      <span className="cb-lesson-list-card__action">Открыть</span>
    </article>
  );
}

export default function CabinetLessonPlanDetailPage() {
  const { planId } = useParams();
  const navigate = useNavigate();
  const [plan, setPlan] = useState(null);
  const [loading, setLoading] = useState(true);
  const [notFound, setNotFound] = useState(false);
  const [selectedItem, setSelectedItem] = useState(null);
  const [copying, setCopying] = useState(false);
  const [copyError, setCopyError] = useState("");
  const [publishing, setPublishing] = useState(false);

  const handleOpen = useCallback((item) => {
    setSelectedItem(item);
  }, []);

  const handleItemUpdated = useCallback((updatedItem) => {
    setPlan((prev) => {
      if (!prev) return prev;
      return {
        ...prev,
        items: prev.items.map((entry) => (
          entry.id === updatedItem.id ? updatedItem : entry
        )),
      };
    });
    setSelectedItem(updatedItem);
  }, []);

  const load = useCallback(async () => {
    try {
      const data = await fetchLessonPlan(planId);
      setPlan(mapApiPlan(data));
    } catch {
      setNotFound(true);
    } finally {
      setLoading(false);
    }
  }, [planId]);

  useEffect(() => { load(); }, [load]);

  const handleCopyPlan = async () => {
    setCopying(true);
    setCopyError("");
    try {
      const copied = await copyLessonPlan(planId);
      navigate(`/cabinet/plans/${copied.id}/edit`);
    } catch (err) {
      setCopyError(err.message || "Не удалось сохранить план");
    } finally {
      setCopying(false);
    }
  };

  const handlePublish = async () => {
    setPublishing(true);
    setCopyError("");
    try {
      await updateLessonPlan(planId, { status: "published" });
      await load();
    } catch (err) {
      setCopyError(err.message || "Не удалось опубликовать план");
    } finally {
      setPublishing(false);
    }
  };

  if (loading) return <CabinetPageShell><p className="cb-loading">Загрузка…</p></CabinetPageShell>;
  if (notFound) return <Navigate to="/cabinet/plans" replace />;

  const tone = planStatusTone(plan.status);
  const totalItems = plan.items.length;

  return (
    <CabinetPageShell className="cb-section--plan-detail">
      <header className="cb-plan-detail-header">
        <Link to="/cabinet/plans" className="cb-plan-detail-back">
          <CabinetIcon name="arrowLeft" /> К планам
        </Link>
        <div className="cb-plan-detail-header__main">
          <div>
            <div className="cb-plan-detail-header__row">
              <h1 className="cb-page-title">{plan.title}</h1>
              <div className="cb-plan-meta-badges">
                <span className={`cb-plan-meta-badge cb-plan-meta-badge--${tone}`}>
                  {PLAN_STATUS_LABELS[plan.status] || plan.status}
                </span>
                {plan.isPublic && (
                  <span className="cb-plan-meta-badge cb-plan-meta-badge--public">Публичный</span>
                )}
              </div>
            </div>
            {plan.description && <p className="cb-page-sub">{plan.description}</p>}
            {copyError ? <p className="cb-inline-error" role="alert">{copyError}</p> : null}
          </div>
          <div className="cb-page-actions">
            {plan.isPublic ? (
              <button
                type="button"
                className="cb-btn cb-btn--primary"
                onClick={handleCopyPlan}
                disabled={copying}
              >
                {copying ? "…" : "Сохранить себе"}
              </button>
            ) : (
              <>
                <Link to={`/cabinet/plans/${planId}/edit`} className="cb-btn cb-btn--outline">
                  <CabinetIcon name="pencil" /> Изменить
                </Link>
                {plan.status === "draft" ? (
                  <button
                    type="button"
                    className="cb-btn cb-btn--primary"
                    onClick={handlePublish}
                    disabled={publishing}
                  >
                    {publishing ? "…" : "Опубликовать"}
                  </button>
                ) : null}
              </>
            )}
          </div>
        </div>
      </header>

      <div className="cb-plan-detail-layout">
        <section className="cb-plan-detail-main">
          <h2 className="cb-plan-detail-section-title">
            Занятия плана
          </h2>
          {plan.items.length === 0 ? (
            <p className="cb-plan-detail-empty">
              Занятия пока не добавлены.
              {!plan.isPublic && (
                <Link to={`/cabinet/plans/${planId}/edit`} className="cb-link"> Открыть редактор</Link>
              )}
            </p>
          ) : (
            <div className="cb-lesson-list">
              {plan.items.map((item) => (
                <LessonPlanItemCard
                  key={item.id}
                  item={item}
                  plan={plan}
                  onOpen={handleOpen}
                />
              ))}
            </div>
          )}
        </section>

        <aside className="cb-plan-detail-aside">
          <div className="cb-plan-summary">
            <h3 className="cb-plan-summary__title">Сводка</h3>
            <dl className="cb-plan-summary__list">
              {plan.directionLabel && <div><dt>Направление</dt><dd>{plan.directionLabel}</dd></div>}
              {plan.grade && <div><dt>Класс</dt><dd>{plan.grade}</dd></div>}
              <div><dt>Занятий</dt><dd>{plan.lessonsCount || totalItems}</dd></div>
              {plan.goal && <div><dt>Цель</dt><dd>{plan.goal}</dd></div>}
            </dl>
            {totalItems > 0 && (
              <div className="cb-plan-summary__progress">
                <div className="cb-plan-summary__progress-head">
                  <span>Прогресс</span>
                  <strong>{plan.progressPercent}%</strong>
                </div>
                <div className="cb-plan-summary__bar">
                  <div className="cb-plan-summary__fill" style={{ width: `${plan.progressPercent}%` }} />
                </div>
              </div>
            )}
          </div>
        </aside>
      </div>

      {selectedItem ? (
        <PlanItemDetailModal
          itemId={selectedItem.id}
          initialItem={selectedItem}
          planId={planId}
          plan={plan}
          canEdit={!plan.isPublic}
          onClose={() => setSelectedItem(null)}
          onItemUpdated={handleItemUpdated}
        />
      ) : null}
    </CabinetPageShell>
  );
}
