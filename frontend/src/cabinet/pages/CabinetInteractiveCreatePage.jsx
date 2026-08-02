import { useNavigate } from "react-router-dom";
import { InteractiveTypeCard } from "../components/InteractivesUi";
import { INTERACTIVE_TYPE_LIST, isInteractiveTypeAvailable } from "../interactivesData";
import { CabinetPageShell, CabinetPageHeader, useSoonToast } from "../CabinetSectionUi";
import LimitBadge from "../components/LimitBadge";
import UpgradeLimitModal from "../components/UpgradeLimitModal";
import CompactUpgradeModal from "../components/CompactUpgradeModal";
import { useSubscription } from "../hooks/useSubscription";
import { useLimitModal } from "../hooks/useLimitModal";
import "../styles/interactives-catalog.css";

export default function CabinetInteractiveCreatePage() {
  const navigate = useNavigate();
  const { toast, notifySoon } = useSoonToast();
  const subscription = useSubscription();
  const { limitModalProps, upgradeModalProps, handleApiLimitError } = useLimitModal(subscription.currentPlan);

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
    navigate(`/cabinet/interactives/new/${type}`);
  };

  return (
    <CabinetPageShell className="cb-section--interactives-create ix-page">
      {toast}
      {limitModalProps && <UpgradeLimitModal {...limitModalProps} />}
      {upgradeModalProps && <CompactUpgradeModal {...upgradeModalProps} />}

      <CabinetPageHeader
        title="Тип интерактива"
        subtitle="Выберите формат — откроется редактор нового задания."
        actions={[
          { label: "Назад", icon: "arrow", href: "/cabinet/interactives" },
        ]}
      />

      <div className="cb-limit-row cb-limit-row--standalone ix-page__limit">
        <LimitBadge
          label="Интерактивы"
          used={subscription.usage.interactives}
          limit={subscription.limits.interactives}
          loading={subscription.loading}
        />
      </div>

      <div className="ix-type-grid ix-type-grid--select">
        {INTERACTIVE_TYPE_LIST.map((type) => (
          <InteractiveTypeCard key={type} type={type} onCreate={handleTypeSelect} />
        ))}
      </div>

      <button type="button" className="cb-btn cb-btn--outline cb-btn--sm" onClick={() => navigate(-1)}>
        Отмена
      </button>
    </CabinetPageShell>
  );
}
