import { useCallback, useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import ConfirmActionModal from "../components/ConfirmActionModal";
import InteractiveAssignModal from "../components/InteractiveAssignModal";
import {
  InteractivesEmptyState,
  InteractiveActivityCard,
} from "../components/InteractivesUi";
import { CabinetPageShell, useSoonToast } from "../CabinetSectionUi";
import { usePageTitle } from "../hooks/usePageTitle";
import UpgradeLimitModal from "../components/UpgradeLimitModal";
import CompactUpgradeModal from "../components/CompactUpgradeModal";
import { useSubscription } from "../hooks/useSubscription";
import { useLimitModal } from "../hooks/useLimitModal";
import {
  SORT_OPTIONS,
  INTERACTIVE_TYPE_LIST,
  INTERACTIVE_TYPES,
  canAssignInteractive,
  filterInteractives,
  getInteractiveDisplayTitle,
  isInteractiveTypeAvailable,
  sortInteractives,
} from "../interactivesData";
import {
  buildInteractiveWritePayload,
  mapApiInteractiveDetail,
  mapApiInteractiveListItem,
  normalizeInteractivesList,
} from "../interactivesApi";
import {
  assignInteractive,
  createInteractive,
  deleteInteractiveApi,
  fetchInteractive,
  fetchInteractives,
} from "../../utils/cabinetAuth";
import "../styles/interactives-catalog.css";
import "../styles/interactive-launch.css";

const TYPE_FILTER_OPTIONS = [
  { id: "all", label: "Все типы" },
  ...INTERACTIVE_TYPE_LIST.map((id) => ({
    id,
    label: INTERACTIVE_TYPES[id]?.shortLabel || INTERACTIVE_TYPES[id]?.label || id,
  })),
];

const STATUS_FILTER_OPTIONS = [
  { id: "all", label: "Все статусы" },
  { id: "draft", label: "Черновики" },
  { id: "published", label: "Опубликованные" },
  { id: "assigned", label: "Выданные" },
];

const MINE_PREVIEW_LIMIT = 8;

function InteractivesSkeleton({ count = 6 }) {
  return (
    <div className="ix-activity-grid" aria-busy="true" aria-label="Загрузка интерактивов">
      {Array.from({ length: count }, (_, i) => (
        <div key={i} className="ix-skeleton-card" />
      ))}
    </div>
  );
}

function SafeActivityCard(props) {
  if (!props.interactive?.id) return null;
  return <InteractiveActivityCard {...props} />;
}

export default function CabinetInteractivesPage() {
  usePageTitle("Интерактивы");
  const navigate = useNavigate();
  const [sort, setSort] = useState("updated");
  const [typeFilter, setTypeFilter] = useState("all");
  const [statusFilter, setStatusFilter] = useState("all");
  const [search, setSearch] = useState("");
  const [filtersOpen, setFiltersOpen] = useState(false);
  const [items, setItems] = useState([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState("");
  const [assignTarget, setAssignTarget] = useState(null);
  const [deleteTarget, setDeleteTarget] = useState(null);
  const [deleteLoading, setDeleteLoading] = useState(false);
  const [notice, setNotice] = useState("");
  const { toast, notifySoon } = useSoonToast();
  const subscription = useSubscription();
  const { limitModalProps, upgradeModalProps, handleApiLimitError } = useLimitModal(subscription.currentPlan);

  const usageLabel = useMemo(() => {
    if (subscription.loading || subscription.limits.interactives == null) return null;
    const used = subscription.usage.interactives ?? 0;
    const limit = subscription.limits.interactives;
    return `${used} из ${limit} создано`;
  }, [subscription]);

  const [mineExpanded, setMineExpanded] = useState(false);

  const mineItems = useMemo(() => {
    const sorted = sortInteractives(items, "updated");
    if (mineExpanded) return sorted;
    return sorted.slice(0, MINE_PREVIEW_LIMIT);
  }, [items, mineExpanded]);

  const mineHasMore = items.length > MINE_PREVIEW_LIMIT;

  const catalogItems = useMemo(() => {
    let list = items;
    if (typeFilter !== "all") {
      list = filterInteractives(list, typeFilter);
    }
    if (statusFilter !== "all") {
      list = filterInteractives(list, statusFilter);
    }
    const q = search.trim().toLowerCase();
    if (q) {
      list = list.filter((item) => {
        const title = getInteractiveDisplayTitle(item).toLowerCase();
        const topic = String(item.topic || "").toLowerCase();
        const subject = String(item.subject || "").toLowerCase();
        const typeLabel = String(INTERACTIVE_TYPES[item.type]?.label || "").toLowerCase();
        return title.includes(q) || topic.includes(q) || subject.includes(q) || typeLabel.includes(q);
      });
    }
    return sortInteractives(list, sort);
  }, [items, typeFilter, statusFilter, search, sort]);

  const hasActiveFilters = typeFilter !== "all" || statusFilter !== "all" || search.trim() !== "";

  const refresh = useCallback(async () => {
    setLoading(true);
    setLoadError("");
    try {
      const data = await fetchInteractives();
      const mapped = normalizeInteractivesList(data)
        .map(mapApiInteractiveListItem)
        .filter(Boolean);
      setItems(mapped);
    } catch (err) {
      if (import.meta.env.DEV) console.error("Interactives list failed:", err);
      setLoadError(err?.message || "Не удалось загрузить интерактивы");
      setItems([]);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    refresh();
  }, [refresh]);

  const openCreateFlow = () => {
    if (!subscription.loading && !subscription.canCreateInteractive) {
      handleApiLimitError({
        code: "INTERACTIVE_LIMIT_REACHED",
        current: subscription.usage.interactives,
        limit: subscription.limits.interactives,
        recommended_plan: "teacher",
      });
      return;
    }
    // Тип выбирается в сайдбаре билдера — без отдельного шага/модалки.
    navigate("/cabinet/interactives/new/wheel");
  };

  const handleTypeSelect = (type) => {
    if (!isInteractiveTypeAvailable(type)) {
      notifySoon();
      return;
    }
    if (!subscription.loading && !subscription.canCreateInteractive) {
      handleApiLimitError({
        code: "INTERACTIVE_LIMIT_REACHED",
        current: subscription.usage.interactives,
        limit: subscription.limits.interactives,
        recommended_plan: "teacher",
      });
      return;
    }
    navigate(type ? `/cabinet/interactives/new/${type}` : "/cabinet/interactives/new/wheel");
  };

  const openInteractive = (item) => {
    if (!item?.id) return;
    navigate(`/cabinet/interactives/${item.id}`);
  };

  const editInteractive = (item) => {
    if (!item?.id) return;
    navigate(`/cabinet/interactives/${item.id}/edit`);
  };

  const handleAssign = async (payload) => {
    const item = items.find((i) => i.id === payload.interactiveId);
    if (!item) return;
    try {
      await assignInteractive(item.id, {
        student: payload.targetType === "student" ? Number(payload.targetId) : null,
        group: payload.targetType === "group" ? Number(payload.targetId) : null,
        due_at: payload.deadline ? `${payload.deadline}T23:59:59` : null,
        attempts_allowed: payload.attempts === "single" ? 1 : 3,
        show_result_immediately: payload.showResult !== false,
        comment: payload.comment || "",
      });
      setNotice("Интерактив выдан");
      window.setTimeout(() => setNotice(""), 2800);
      await refresh();
    } catch (err) {
      if (import.meta.env.DEV) console.error("Assign interactive failed:", err);
      setNotice(err?.message || "Не удалось выдать интерактив");
      window.setTimeout(() => setNotice(""), 3200);
    }
  };

  const resetFilters = () => {
    setSearch("");
    setTypeFilter("all");
    setStatusFilter("all");
    setSort("updated");
  };

  const cardHandlers = (item, variant = "owned") => ({
    interactive: item,
    variant,
    onOpen: () => openInteractive(item),
    onEdit: () => editInteractive(item),
    onLaunch: () => openInteractive(item),
    onAssign: () => {
      if (!canAssignInteractive(item)) {
        setNotice("Сначала опубликуйте интерактив");
        window.setTimeout(() => setNotice(""), 2800);
        return;
      }
      setAssignTarget(item);
    },
    onDuplicate: async () => {
      try {
        const detail = await fetchInteractive(item.id);
        const copy = mapApiInteractiveDetail(detail);
        copy.title = copy.title ? `${copy.title} (копия)` : "Копия";
        copy.status = "draft";
        await createInteractive(buildInteractiveWritePayload(copy, "draft"));
        await refresh();
      } catch (err) {
        if (import.meta.env.DEV) console.error("Duplicate interactive failed:", err);
        setNotice(err?.message || "Не удалось создать копию");
        window.setTimeout(() => setNotice(""), 3200);
      }
    },
    onDelete: () => setDeleteTarget(item),
  });

  const renderMineBody = () => {
    if (loading) return <InteractivesSkeleton count={4} />;
    if (loadError) {
      return (
        <div className="ix-error" role="alert">
          <p className="ix-error__text">{loadError}</p>
          <button type="button" className="ix-error__retry" onClick={refresh}>
            Повторить
          </button>
        </div>
      );
    }
    if (items.length === 0) {
      return (
        <InteractivesEmptyState
          onCreate={openCreateFlow}
          onQuickCreate={handleTypeSelect}
        />
      );
    }
    return (
      <>
        <div className={`ix-activity-grid${mineExpanded ? "" : " ix-activity-grid--mine"}`}>
          {mineItems.map((item) => (
            <SafeActivityCard key={`mine-${item.id}`} {...cardHandlers(item, "mine")} />
          ))}
        </div>
        {mineHasMore ? (
          <div className="ix-section__more">
            <button
              type="button"
              className="ix-section__more-btn"
              onClick={() => {
                if (mineExpanded) {
                  setMineExpanded(false);
                  return;
                }
                setMineExpanded(true);
                document.getElementById("ix-catalog-title")?.scrollIntoView({ behavior: "smooth", block: "start" });
              }}
            >
              {mineExpanded ? "Свернуть" : `Показать все (${items.length})`}
            </button>
          </div>
        ) : null}
      </>
    );
  };

  const renderCatalogBody = () => {
    if (loading) return <InteractivesSkeleton />;
    if (loadError) {
      return (
        <div className="ix-error" role="alert">
          <p className="ix-error__text">{loadError}</p>
          <button type="button" className="ix-error__retry" onClick={refresh}>
            Повторить
          </button>
        </div>
      );
    }
    if (items.length === 0) {
      return (
        <div className="ix-empty ix-empty--filtered">
          <div className="ix-empty__panel">
            <h3 className="ix-empty__title">Каталог пока пуст</h3>
            <p className="ix-empty__text">
              Создайте первый интерактив — он появится здесь и в блоке «Мои интерактивы».
            </p>
            <button type="button" className="ix-empty__cta" onClick={openCreateFlow}>
              Создать интерактив
            </button>
          </div>
        </div>
      );
    }
    if (catalogItems.length === 0) {
      return (
        <div className="ix-empty ix-empty--filtered">
          <div className="ix-empty__panel">
            <h3 className="ix-empty__title">Ничего не найдено</h3>
            <p className="ix-empty__text">
              Измените поиск или фильтры, чтобы увидеть созданные интерактивы.
            </p>
            <button type="button" className="ix-empty__cta ix-empty__cta--ghost" onClick={resetFilters}>
              Сбросить фильтры
            </button>
          </div>
        </div>
      );
    }
    return (
      <div className="ix-activity-grid">
        {catalogItems.map((item) => (
          <SafeActivityCard key={`catalog-${item.id}`} {...cardHandlers(item, "owned")} />
        ))}
      </div>
    );
  };

  return (
    <CabinetPageShell className="cb-section--interactives ix-page">
      {toast}
      {limitModalProps && <UpgradeLimitModal {...limitModalProps} />}
      {upgradeModalProps && <CompactUpgradeModal {...upgradeModalProps} />}
      {notice ? <div className="cb-soon-toast" role="status">{notice}</div> : null}

      <header className="ix-page-head">
        <div className="ix-page-head__text">
          <h1 className="ix-page-head__title">Интерактивы</h1>
          <p className="ix-page-head__sub">
            Ваши задания для урока: создайте, отредактируйте и запустите. Ниже — полный список с поиском и фильтрами.
          </p>
          {usageLabel ? (
            <p className="ix-page-head__usage ix-page-head__usage--mobile">{usageLabel}</p>
          ) : null}
        </div>
        <div className="ix-page-head__actions">
          {usageLabel ? (
            <p className="ix-page-head__usage ix-page-head__usage--desktop">{usageLabel}</p>
          ) : null}
          <button type="button" className="ix-page-head__cta" onClick={openCreateFlow}>
            Создать интерактив
          </button>
        </div>
      </header>

      <section className="ix-section ix-section--mine" aria-labelledby="ix-mine-title">
        <div className="ix-section__head">
          <div className="ix-section__intro">
            <h2 id="ix-mine-title" className="ix-section__title">Мои интерактивы</h2>
            <p className="ix-section__sub">
              Недавно изменённые, черновики и опубликованные. Кнопка «Редактировать» всегда на карточке.
            </p>
          </div>
        </div>
        {renderMineBody()}
      </section>

      <section className="ix-section ix-section--catalog" aria-labelledby="ix-catalog-title">
        <div className="ix-section__head">
          <div className="ix-section__intro">
            <h2 id="ix-catalog-title" className="ix-section__title">Все интерактивы</h2>
            <p className="ix-section__sub">
              Полный каталог ваших материалов: поиск, фильтры и сортировка.
            </p>
          </div>
        </div>

        {!loading && !loadError && items.length > 0 ? (
          <div className="ix-catalog-toolbar">
            <div className="ix-catalog-toolbar__search-row">
              <input
                className="ix-catalog-search"
                type="search"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Поиск по названию, теме или предмету"
                aria-label="Поиск по названию"
              />
              <button
                type="button"
                className={`ix-catalog-filters-toggle${filtersOpen || hasActiveFilters ? " is-active" : ""}`}
                aria-expanded={filtersOpen}
                onClick={() => setFiltersOpen((v) => !v)}
              >
                Фильтры
              </button>
            </div>
            <div className={`ix-catalog-toolbar__filters${filtersOpen ? " is-open" : ""}`}>
              <select
                className="ix-catalog-select"
                value={typeFilter}
                onChange={(e) => setTypeFilter(e.target.value)}
                aria-label="Фильтр по типу"
              >
                {TYPE_FILTER_OPTIONS.map((opt) => (
                  <option key={opt.id} value={opt.id}>{opt.label}</option>
                ))}
              </select>
              <select
                className="ix-catalog-select"
                value={statusFilter}
                onChange={(e) => setStatusFilter(e.target.value)}
                aria-label="Фильтр по статусу"
              >
                {STATUS_FILTER_OPTIONS.map((opt) => (
                  <option key={opt.id} value={opt.id}>{opt.label}</option>
                ))}
              </select>
              <select
                className="ix-catalog-select"
                value={sort}
                onChange={(e) => setSort(e.target.value)}
                aria-label="Сортировка"
              >
                {SORT_OPTIONS.map((opt) => (
                  <option key={opt.id} value={opt.id}>{opt.label}</option>
                ))}
              </select>
              {hasActiveFilters ? (
                <button type="button" className="ix-catalog-reset" onClick={resetFilters}>
                  Сбросить
                </button>
              ) : null}
            </div>
          </div>
        ) : null}

        {renderCatalogBody()}
      </section>

      {assignTarget ? (
        <InteractiveAssignModal
          interactive={assignTarget}
          onClose={() => setAssignTarget(null)}
          onAssign={handleAssign}
        />
      ) : null}

      <ConfirmActionModal
        open={Boolean(deleteTarget)}
        title="Удалить интерактив?"
        text={`Удалить «${deleteTarget ? getInteractiveDisplayTitle(deleteTarget) : "интерактив"}»?`}
        confirmLabel="Удалить"
        danger
        loading={deleteLoading}
        onClose={() => {
          if (!deleteLoading) setDeleteTarget(null);
        }}
        onConfirm={async () => {
          if (!deleteTarget) return;
          setDeleteLoading(true);
          try {
            await deleteInteractiveApi(deleteTarget.id);
            setDeleteTarget(null);
            await refresh();
          } catch (err) {
            if (import.meta.env.DEV) console.error("Delete interactive failed:", err);
            setNotice(err?.message || "Не удалось удалить");
            window.setTimeout(() => setNotice(""), 3200);
          } finally {
            setDeleteLoading(false);
          }
        }}
      />
    </CabinetPageShell>
  );
}
