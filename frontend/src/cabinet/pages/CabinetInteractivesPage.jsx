import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import ConfirmActionModal from "../components/ConfirmActionModal";
import InteractiveAssignModal from "../components/InteractiveAssignModal";
import {
  InteractivesEmptyState,
  InteractiveActivityCard,
  InteractiveTypeCard,
  TypeSelectModal,
} from "../components/InteractivesUi";
import { CabinetPageShell, useSoonToast } from "../CabinetSectionUi";
import LimitBadge from "../components/LimitBadge";
import UpgradeLimitModal from "../components/UpgradeLimitModal";
import CompactUpgradeModal from "../components/CompactUpgradeModal";
import { useSubscription } from "../hooks/useSubscription";
import { useLimitModal } from "../hooks/useLimitModal";
import {
  SORT_OPTIONS,
  INTERACTIVE_TYPE_LIST,
  canAssignInteractive,
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

export default function CabinetInteractivesPage() {
  const navigate = useNavigate();
  const listRef = useRef(null);
  const [sort, setSort] = useState("updated");
  const [items, setItems] = useState([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState("");
  const [showTypeModal, setShowTypeModal] = useState(false);
  const [assignTarget, setAssignTarget] = useState(null);
  const [deleteTarget, setDeleteTarget] = useState(null);
  const [deleteLoading, setDeleteLoading] = useState(false);
  const [notice, setNotice] = useState("");
  const { toast, notifySoon } = useSoonToast();
  const subscription = useSubscription();
  const { limitModalProps, upgradeModalProps, handleApiLimitError } = useLimitModal(subscription.currentPlan);

  const sorted = useMemo(
    () => sortInteractives(items, sort),
    [items, sort],
  );

  const refresh = useCallback(async () => {
    setLoading(true);
    setLoadError("");
    try {
      const data = await fetchInteractives();
      setItems(normalizeInteractivesList(data).map(mapApiInteractiveListItem));
    } catch (err) {
      setLoadError(err?.message || "Не удалось загрузить интерактивы");
      setItems([]);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    refresh();
  }, [refresh]);

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
        recommended_plan: "repetitor",
      });
      return;
    }
    navigate(`/cabinet/interactives/new/${type}`);
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
      setNotice(err?.message || "Не удалось выдать интерактив");
      window.setTimeout(() => setNotice(""), 3200);
    }
  };

  const scrollToList = () => {
    listRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
  };

  return (
    <CabinetPageShell className="cb-section--interactives ix-page">
      {toast}
      {limitModalProps && <UpgradeLimitModal {...limitModalProps} />}
      {upgradeModalProps && <CompactUpgradeModal {...upgradeModalProps} />}
      {notice ? <div className="cb-soon-toast" role="status">{notice}</div> : null}

      <div className="cb-limit-row cb-limit-row--standalone ix-page__limit">
        <LimitBadge label="Интерактивы" used={subscription.usage.interactives} limit={subscription.limits.interactives} loading={subscription.loading} />
      </div>

      <section className="ix-section ix-section--types" aria-labelledby="ix-types-title">
        <div className="ix-section__intro">
          <h2 id="ix-types-title" className="ix-section__title">Типы</h2>
          <p className="ix-section__sub">
            Выберите формат задания — каждый тип подходит для своей задачи на уроке.
          </p>
        </div>
        <div className="ix-type-grid">
          {INTERACTIVE_TYPE_LIST.map((type) => (
            <InteractiveTypeCard key={type} type={type} onCreate={handleTypeSelect} />
          ))}
        </div>
      </section>

      <section ref={listRef} className="ix-section ix-section--mine" aria-labelledby="ix-mine-title">
        <div className="ix-section__head">
          <div className="ix-section__intro">
            <h2 id="ix-mine-title" className="ix-section__title">Мои интерактивы</h2>
            {items.length === 0 && !loading ? (
              <p className="ix-section__sub">Здесь появятся созданные задания — начните с любого типа выше.</p>
            ) : null}
          </div>
          {items.length > 0 ? (
            <button type="button" className="ix-section__link" onClick={scrollToList}>
              Смотреть все
            </button>
          ) : null}
        </div>
        {items.length > 0 ? (
          <div className="ix-catalog-toolbar ix-catalog-toolbar--sort-only">
            <select className="ix-sort-select" value={sort} onChange={(e) => setSort(e.target.value)} aria-label="Сортировка">
              {SORT_OPTIONS.map((opt) => (
                <option key={opt.id} value={opt.id}>{opt.label}</option>
              ))}
            </select>
          </div>
        ) : null}

        {loading ? (
          <p className="cb-loading">Загрузка…</p>
        ) : loadError ? (
          <p className="cb-inline-error" role="alert">{loadError}</p>
        ) : items.length === 0 ? (
          <InteractivesEmptyState
            onCreate={() => setShowTypeModal(true)}
            onQuickCreate={handleTypeSelect}
          />
        ) : (
          <div className="ix-activity-grid">
            {sorted.map((item) => (
              <InteractiveActivityCard
                key={item.id}
                interactive={item}
                onOpen={() => navigate(`/cabinet/interactives/${item.id}`)}
                onEdit={() => navigate(`/cabinet/interactives/${item.id}/edit`)}
                onAssign={() => {
                  if (!canAssignInteractive(item)) {
                    setNotice("Сначала опубликуйте интерактив");
                    window.setTimeout(() => setNotice(""), 2800);
                    return;
                  }
                  setAssignTarget(item);
                }}
                onDuplicate={async () => {
                  try {
                    const detail = await fetchInteractive(item.id);
                    const copy = mapApiInteractiveDetail(detail);
                    copy.title = copy.title ? `${copy.title} (копия)` : "Копия";
                    copy.status = "draft";
                    await createInteractive(buildInteractiveWritePayload(copy, "draft"));
                    await refresh();
                  } catch (err) {
                    setNotice(err?.message || "Не удалось создать копию");
                    window.setTimeout(() => setNotice(""), 3200);
                  }
                }}
                onDelete={() => setDeleteTarget(item)}
              />
            ))}
          </div>
        )}
      </section>

      {showTypeModal ? (
        <TypeSelectModal
          onClose={() => setShowTypeModal(false)}
          onSelect={handleTypeSelect}
        />
      ) : null}

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
        text={`Удалить «${deleteTarget?.title || "интерактив"}»?`}
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
