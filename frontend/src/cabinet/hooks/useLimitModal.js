/**
 * useLimitModal — хук для показа upgrade modals.
 *
 * Возвращает:
 *   limitModalProps  — props для UpgradeLimitModal (null если закрыт)
 *   upgradeModalProps — props для CompactUpgradeModal (null если закрыт)
 *   openLimitModal({ type, current, limit, recommendedPlan })
 *   handleApiLimitError(error) — читает код ошибки из ответа API
 */

import { useCallback, useState } from "react";
import { fetchSubscriptionPlans } from "../../utils/cabinetAuth";

export function useLimitModal(currentPlan) {
  const [limitModal, setLimitModal] = useState(null);
  const [upgradeModal, setUpgradeModal] = useState(null);
  const [plans, setPlans] = useState([]);

  const openLimitModal = useCallback((params) => {
    setLimitModal(params);
    setUpgradeModal(null);
  }, []);

  const openUpgradeModal = useCallback(async (recommendedSlug) => {
    setLimitModal(null);
    try {
      if (plans.length === 0) {
        const data = await fetchSubscriptionPlans();
        setPlans(data.plans || []);
        setUpgradeModal({ recommendedSlug });
      } else {
        setUpgradeModal({ recommendedSlug });
      }
    } catch {
      setUpgradeModal({ recommendedSlug });
    }
  }, [plans]);

  const closeAll = useCallback(() => {
    setLimitModal(null);
    setUpgradeModal(null);
  }, []);

  const handleApiLimitError = useCallback((error) => {
    // err.code — прямо на объекте ошибки, err.data — полный body ответа
    const code = error?.code || error?.data?.code;
    const data = error?.data || error || {};
    const LIMIT_MAP = {
      STUDENT_LIMIT_REACHED: "students",
      GROUP_LIMIT_REACHED: "groups",
      LESSON_LIMIT_REACHED: "lessons",
      INTERACTIVE_LIMIT_REACHED: "interactives",
      AI_LIMIT_REACHED: "ai",
    };
    const type = LIMIT_MAP[code];
    if (type) {
      openLimitModal({
        type,
        current: data.current ?? 0,
        limit: data.limit ?? 0,
        recommendedPlan: data.recommended_plan || "repetitor",
      });
      return true;
    }
    return false;
  }, [openLimitModal]);

  const limitModalProps = limitModal
    ? {
        ...limitModal,
        currentPlan,
        onUpgrade: () => openUpgradeModal(limitModal.recommendedPlan || "repetitor"),
        onClose: closeAll,
      }
    : null;

  const upgradeModalProps = upgradeModal
    ? {
        currentPlan,
        plans,
        recommendedSlug: upgradeModal.recommendedSlug || "repetitor",
        onSelectPlan: (slug) => {
          closeAll();
          // Вызывающий компонент подписывается через onUpgrade
          if (upgradeModal.onSelectPlan) upgradeModal.onSelectPlan(slug);
        },
        onCompareAll: closeAll,
        onClose: closeAll,
      }
    : null;

  return {
    limitModalProps,
    upgradeModalProps,
    plans,
    openLimitModal,
    openUpgradeModal,
    closeAll,
    handleApiLimitError,
  };
}
