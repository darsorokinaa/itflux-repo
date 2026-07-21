import { useCallback, useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import CabinetHomeworkCard from "../CabinetHomeworkCard";
import ConfirmActionModal from "../components/ConfirmActionModal";
import {
  CabinetPageShell,
  CabinetPageHeader,
  CabinetFilterBar,
  CabinetEmptyState,
} from "../CabinetSectionUi";
import {
  PLAN_CATALOG_FILTERS,
  PLAN_FILTERS,
  PLAN_SCOPE_FILTERS,
  filterPlans,
  mapApiPlan,
  mapPlanToHomeworkCard,
} from "../lessonPlansData";
import { copyLessonPlan, deleteLessonPlan, fetchLessonPlans } from "../../utils/cabinetAuth";

export default function CabinetLessonPlansPage() {
  const navigate = useNavigate();
  const [scope, setScope] = useState("mine");
  const [filter, setFilter] = useState("all");
  const [plans, setPlans] = useState([]);
  const [loading, setLoading] = useState(true);
  const [copyingId, setCopyingId] = useState(null);
  const [deletingId, setDeletingId] = useState(null);
  const [deleteTarget, setDeleteTarget] = useState(null);
  const [error, setError] = useState("");

  const load = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const params = scope === "mine" ? { mine: "true" } : { catalog: "true" };
      const data = await fetchLessonPlans(params);
      setPlans((data || []).map(mapApiPlan));
    } catch (err) {
      setPlans([]);
      setError(err.message || "Не удалось загрузить планы");
    } finally {
      setLoading(false);
    }
  }, [scope]);

  useEffect(() => {
    load();
  }, [load]);

  useEffect(() => {
    setFilter("all");
  }, [scope]);

  const activeFilters = scope === "mine" ? PLAN_FILTERS : PLAN_CATALOG_FILTERS;

  const visible = useMemo(
    () => filterPlans(plans, filter).map((plan) => mapPlanToHomeworkCard(plan, { scope })),
    [plans, filter, scope],
  );

  const handleOpenPlan = (item) => {
    const planId = item.plan?.id || item.id;
    if (scope === "mine") {
      navigate(`/cabinet/plans/${planId}/edit`);
      return;
    }
    navigate(`/cabinet/plans/${planId}`);
  };

  const handleCopyPlan = async (item) => {
    const planId = item.plan?.id || item.id;
    setCopyingId(planId);
    setError("");
    try {
      const copied = await copyLessonPlan(planId);
      navigate(`/cabinet/plans/${copied.id}/edit`);
    } catch (err) {
      setError(err.message || "Не удалось скопировать план");
    } finally {
      setCopyingId(null);
    }
  };

  const handleDeletePlan = (item) => {
    setDeleteTarget(item);
  };

  const confirmDeletePlan = async () => {
    if (!deleteTarget) return;
    const planId = deleteTarget.plan?.id || deleteTarget.id;
    setDeletingId(planId);
    setError("");
    try {
      await deleteLessonPlan(planId);
      setDeleteTarget(null);
      await load();
    } catch (err) {
      setError(err.message || "Не удалось удалить план");
    } finally {
      setDeletingId(null);
    }
  };

  return (
    <CabinetPageShell className="cb-section--plans">
      <CabinetPageHeader
        title="Планы уроков"
        subtitle="Создайте свой маршрут или выберите готовый шаблон."
        actions={[
          { label: "Создать план", icon: "plus", primary: true, href: "/cabinet/plans/new" },
        ]}
      />

      <div className="cb-plans-toolbar">
        <CabinetFilterBar filters={PLAN_SCOPE_FILTERS} active={scope} onChange={setScope} />
      </div>

      <CabinetFilterBar filters={activeFilters} active={filter} onChange={setFilter} />

      {error ? <p className="cb-inline-error" role="alert">{error}</p> : null}

      {loading ? (
        <p className="cb-loading">Загрузка планов…</p>
      ) : visible.length === 0 ? (
        <CabinetEmptyState
          icon="plan"
          title={scope === "mine" ? "У вас пока нет планов" : "Готовых планов пока нет"}
          text={
            scope === "mine"
              ? "Создайте свой план занятий или сохраните готовый шаблон из каталога."
              : "Опубликованные шаблоны платформы появятся здесь."
          }
          actions={
            scope === "mine"
              ? [{ label: "Создать план", primary: true, href: "/cabinet/plans/new" }]
              : []
          }
        />
      ) : (
        <div className="cb-hw-grid">
          {visible.map((item) => {
            const planId = item.plan?.id || item.id;
            const busy = copyingId === planId || deletingId === planId;
            const secondaryLabel = scope === "mine"
              ? "Дублировать"
              : item.secondaryActionLabel;
            return (
              <CabinetHomeworkCard
                key={item.id}
                coverVariant={item.coverVariant}
                deadlineLabel={item.deadlineLabel}
                deadlineTone={item.deadlineTone}
                subject={item.subject}
                title={item.title}
                description={item.description}
                progressLabel={item.progressLabel}
                progressPercent={item.progressPercent}
                progressTone={item.progressTone}
                hideProgressBar={item.hideProgressBar}
                actionLabel={busy ? "…" : item.actionLabel}
                actionPrimary={item.actionPrimary}
                secondaryActionLabel={busy ? undefined : secondaryLabel}
                dangerActionLabel={scope === "mine" && !busy ? "Удалить" : undefined}
                onAction={() => handleOpenPlan(item)}
                onSecondaryAction={
                  secondaryLabel && !busy
                    ? () => handleCopyPlan(item)
                    : undefined
                }
                onDangerAction={
                  scope === "mine" && !busy
                    ? () => handleDeletePlan(item)
                    : undefined
                }
              />
            );
          })}
        </div>
      )}

      <ConfirmActionModal
        open={Boolean(deleteTarget)}
        title="Удалить план?"
        text={`Удалить план «${deleteTarget?.title || deleteTarget?.plan?.title || "без названия"}»? Это действие нельзя отменить.`}
        confirmLabel="Удалить"
        danger
        loading={Boolean(deletingId)}
        onClose={() => {
          if (!deletingId) setDeleteTarget(null);
        }}
        onConfirm={confirmDeletePlan}
      />
    </CabinetPageShell>
  );
}
