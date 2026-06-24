import { useCallback, useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import CabinetHomeworkCard from "../CabinetHomeworkCard";
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
import { copyLessonPlan, fetchLessonPlans } from "../../utils/cabinetAuth";

export default function CabinetLessonPlansPage() {
  const navigate = useNavigate();
  const [scope, setScope] = useState("mine");
  const [filter, setFilter] = useState("all");
  const [plans, setPlans] = useState([]);
  const [loading, setLoading] = useState(true);
  const [copyingId, setCopyingId] = useState(null);
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
    if (scope === "mine" && item.plan?.status === "draft") {
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
      setError(err.message || "Не удалось сохранить план");
    } finally {
      setCopyingId(null);
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
          {visible.map((item) => (
            <CabinetHomeworkCard
              key={item.id}
              deadlineLabel={item.deadlineLabel}
              deadlineTone={item.deadlineTone}
              subject={item.subject}
              title={item.title}
              description={item.description}
              progressLabel={item.progressLabel}
              progressPercent={item.progressPercent}
              progressTone={item.progressTone}
              hideProgressBar={item.hideProgressBar}
              actionLabel={copyingId === item.id ? "…" : item.actionLabel}
              actionPrimary={item.actionPrimary}
              secondaryActionLabel={copyingId === item.id ? undefined : item.secondaryActionLabel}
              onAction={() => handleOpenPlan(item)}
              onSecondaryAction={
                item.secondaryActionLabel && copyingId !== item.id
                  ? () => handleCopyPlan(item)
                  : undefined
              }
            />
          ))}
        </div>
      )}
    </CabinetPageShell>
  );
}
