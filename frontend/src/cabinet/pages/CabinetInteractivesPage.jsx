import { useCallback, useMemo, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
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
  deleteInteractive,
  duplicateInteractive,
  canAssignInteractive,
  isInteractiveTypeAvailable,
  loadInteractives,
  sortInteractives,
  upsertInteractive,
} from "../interactivesData";
import "../styles/interactives-catalog.css";
import "../styles/interactive-launch.css";

export default function CabinetInteractivesPage() {
  const navigate = useNavigate();
  const listRef = useRef(null);
  const [sort, setSort] = useState("updated");
  const [items, setItems] = useState(() => loadInteractives());
  const [showTypeModal, setShowTypeModal] = useState(false);
  const [assignTarget, setAssignTarget] = useState(null);
  const [notice, setNotice] = useState("");
  const { toast, notifySoon } = useSoonToast();
  const subscription = useSubscription();
  const { limitModalProps, upgradeModalProps, handleApiLimitError } = useLimitModal(subscription.currentPlan);

  const sorted = useMemo(
    () => sortInteractives(items, sort),
    [items, sort],
  );

  const refresh = useCallback(() => {
    setItems(loadInteractives());
  }, []);

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

  const handleAssign = (payload) => {
    const item = items.find((i) => i.id === payload.interactiveId);
    if (!item) return;
    const target = payload.targetType === "student"
      ? `Ученик: ${payload.targetId}`
      : `Группа: ${payload.targetId}`;
    upsertInteractive({
      ...item,
      status: "assigned",
      usedIn: [...(item.usedIn || []), target],
      updatedAt: new Date().toISOString(),
    });
    refresh();
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

      <div className="cb-limit-row cb-limit-row--standalone">
        <LimitBadge label="Интерактивы" used={subscription.usage.interactives} limit={subscription.limits.interactives} loading={subscription.loading} />
      </div>

      <section className="ix-section">
        <h2 className="ix-section__title">Типы</h2>
        <div className="ix-type-grid">
          {INTERACTIVE_TYPE_LIST.map((type) => (
            <InteractiveTypeCard key={type} type={type} onCreate={handleTypeSelect} />
          ))}
        </div>
      </section>

      <section ref={listRef} className="ix-section">
        <div className="ix-section__head">
          <h2 className="ix-section__title">Мои интерактивы</h2>
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

        {items.length === 0 ? (
          <InteractivesEmptyState onCreate={() => setShowTypeModal(true)} />
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
                onDuplicate={() => {
                  const copy = duplicateInteractive(item.id);
                  if (copy) refresh();
                }}
                onDelete={() => {
                  if (window.confirm(`Удалить «${item.title || "интерактив"}»?`)) {
                    deleteInteractive(item.id);
                    refresh();
                  }
                }}
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
    </CabinetPageShell>
  );
}
