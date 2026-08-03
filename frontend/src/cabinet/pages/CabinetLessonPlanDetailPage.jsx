import { useCallback, useEffect, useState } from "react";
import { Link, Navigate, useNavigate, useParams } from "react-router-dom";
import CabinetIcon from "../CabinetIcons";
import ConfirmActionModal from "../components/ConfirmActionModal";
import PlanItemDetailModal from "../components/PlanItemDetailModal";
import { CabinetPageShell } from "../CabinetSectionUi";
import {
  PLAN_STATUS_LABELS,
  mapApiPlan,
  planExamLabel,
  planStatusTone,
  planSubjectLabel,
} from "../lessonPlansData";
import { canPublishCatalogPlans } from "../planCatalogPublish";
import { homeworkResourceRows, lessonResourceRows } from "../planItemAttachments";
import {
  copyLessonPlan,
  deleteLessonPlan,
  fetchCabinetSession,
  fetchLessonPlan,
  updateLessonPlan,
} from "../../utils/cabinetAuth";
import { usePageTitle } from "../hooks/usePageTitle";

function LessonPlanItemCard({ item, plan, onOpen }) {
  const subject = planSubjectLabel(plan);
  const exam = planExamLabel(plan);
  const meta = [exam, subject].filter(Boolean).join(" · ");
  const materialsCount = lessonResourceRows(item).length
    + (item.materialsNotes?.trim() ? 1 : 0);
  const homeworkCount = homeworkResourceRows(item).length;
  const hasHomework = Boolean(item.homeworkDescription?.trim()) || homeworkCount > 0;
  const topicLine = [
    item.topic ? `Тема: ${item.topic}` : "",
    item.subtopic ? `Подтема: ${item.subtopic}` : "",
    item.taskNumber ? `№ задания: ${item.taskNumber}` : "",
  ].filter(Boolean).join(" · ");
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
          <h4 className="cb-lesson-list-card__title">{item.title || `Занятие ${item.order}`}</h4>
        </div>
        {topicLine ? (
          <p className="cb-lesson-list-card__topic">{topicLine}</p>
        ) : null}
        {meta ? <p className="cb-lesson-list-card__meta">{meta}</p> : null}
        <div className="cb-lesson-list-card__stats">
          {materialsCount > 0 ? <span>Материалы: {materialsCount}</span> : null}
          <span>
            ДЗ:
            {" "}
            {hasHomework
              ? (homeworkCount > 0
                ? `есть · ${homeworkCount}`
                : "есть")
              : "нет"}
          </span>
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
  const [deleting, setDeleting] = useState(false);
  const [deleteConfirmOpen, setDeleteConfirmOpen] = useState(false);
  const [actionError, setActionError] = useState("");
  const [publishing, setPublishing] = useState(false);
  const [canPublishCatalog, setCanPublishCatalog] = useState(false);
  usePageTitle(plan?.title || "План занятий");

  useEffect(() => {
    fetchCabinetSession()
      .then((data) => {
        if (data?.user) setCanPublishCatalog(canPublishCatalogPlans(data.user));
      })
      .catch(() => {});
  }, []);

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
    setActionError("");
    try {
      const copied = await copyLessonPlan(planId);
      navigate(`/cabinet/plans/${copied.id}/edit`);
    } catch (err) {
      setActionError(err.message || "Не удалось скопировать план");
    } finally {
      setCopying(false);
    }
  };

  const handleDeletePlan = () => {
    setDeleteConfirmOpen(true);
  };

  const confirmDeletePlan = async () => {
    setDeleting(true);
    setActionError("");
    try {
      await deleteLessonPlan(planId);
      setDeleteConfirmOpen(false);
      navigate("/cabinet/plans");
    } catch (err) {
      setActionError(err.message || "Не удалось удалить план");
    } finally {
      setDeleting(false);
    }
  };

  const handlePublish = async () => {
    setPublishing(true);
    setActionError("");
    try {
      await updateLessonPlan(planId, { status: "published" });
      await load();
    } catch (err) {
      setActionError(err.message || "Не удалось опубликовать план");
    } finally {
      setPublishing(false);
    }
  };

  if (loading) return <CabinetPageShell><p className="cb-loading">Загрузка…</p></CabinetPageShell>;
  if (notFound) return <Navigate to="/cabinet/plans" replace />;

  const tone = planStatusTone(plan.status);
  const totalItems = plan.items.length;
  const materialsTotal = plan.items.reduce(
    (sum, item) => sum + lessonResourceRows(item).length + (item.materialsNotes?.trim() ? 1 : 0),
    0,
  );
  const homeworkTotal = plan.items.filter((item) => (
    Boolean(item.homeworkDescription?.trim())
    || homeworkResourceRows(item).length > 0
  )).length;

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
            {plan.isPublic && !canPublishCatalog ? (
              <p className="cb-plan-detail-hint">
                Публичный шаблон нельзя менять напрямую — нажмите «Сохранить себе и редактировать»,
                чтобы создать личную копию. Изменения будут только у вас.
              </p>
            ) : null}
            {actionError ? <p className="cb-inline-error" role="alert">{actionError}</p> : null}
          </div>
          <div className="cb-page-actions">
            {plan.isPublic && !canPublishCatalog ? (
              <button
                type="button"
                className="cb-btn cb-btn--primary"
                onClick={handleCopyPlan}
                disabled={copying}
              >
                {copying ? "…" : "Сохранить себе и редактировать"}
              </button>
            ) : plan.isPublic && canPublishCatalog ? (
              <>
                <Link to={`/cabinet/plans/${planId}/edit`} className="cb-btn cb-btn--outline">
                  <CabinetIcon name="pencil" /> Изменить
                </Link>
                <button
                  type="button"
                  className="cb-btn cb-btn--outline"
                  onClick={handleCopyPlan}
                  disabled={copying || deleting}
                >
                  {copying ? "…" : "Дублировать"}
                </button>
                <button
                  type="button"
                  className="cb-btn cb-btn--danger"
                  onClick={handleDeletePlan}
                  disabled={deleting || copying}
                >
                  {deleting ? "…" : "Удалить"}
                </button>
              </>
            ) : (
              <>
                <Link to={`/cabinet/plans/${planId}/edit`} className="cb-btn cb-btn--outline">
                  <CabinetIcon name="pencil" /> Изменить
                </Link>
                <button
                  type="button"
                  className="cb-btn cb-btn--outline"
                  onClick={handleCopyPlan}
                  disabled={copying || deleting}
                >
                  {copying ? "…" : "Дублировать"}
                </button>
                {plan.status === "draft" ? (
                  <button
                    type="button"
                    className="cb-btn cb-btn--primary"
                    onClick={handlePublish}
                    disabled={publishing || deleting}
                  >
                    {publishing ? "…" : "Опубликовать"}
                  </button>
                ) : null}
                <button
                  type="button"
                  className="cb-btn cb-btn--danger"
                  onClick={handleDeletePlan}
                  disabled={deleting || copying || publishing}
                >
                  {deleting ? "…" : "Удалить"}
                </button>
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
              {plan.subjectLabel && <div><dt>Предмет</dt><dd>{plan.subjectLabel}</dd></div>}
              {plan.directionLabel && <div><dt>Направление</dt><dd>{plan.directionLabel}</dd></div>}
              {plan.grade && <div><dt>Класс</dt><dd>{plan.grade}</dd></div>}
              <div><dt>Занятий</dt><dd>{plan.lessonsCount || totalItems}</dd></div>
              <div><dt>Материалов</dt><dd>{materialsTotal}</dd></div>
              <div><dt>С ДЗ</dt><dd>{homeworkTotal}</dd></div>
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

      <ConfirmActionModal
        open={deleteConfirmOpen}
        title="Удалить план?"
        text={`Удалить план «${plan?.title || "без названия"}»? Это действие нельзя отменить.`}
        confirmLabel="Удалить"
        danger
        loading={deleting}
        onClose={() => {
          if (!deleting) setDeleteConfirmOpen(false);
        }}
        onConfirm={confirmDeletePlan}
      />
    </CabinetPageShell>
  );
}
