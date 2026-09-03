/**
 * UpgradeLimitModal — модальное окно при достижении лимита.
 *
 * Props:
 *   type: "students" | "groups" | "lessons" | "interactives" | "ai" | "feature"
 *   current, limit — числа
 *   currentPlan — { name, slug }
 *   recommendedPlan — slug
 *   onUpgrade — callback при нажатии "Увеличить лимит"
 *   onClose
 */

import AccessGateModal from "../../components/AccessGateModal";

const TYPE_TO_RESOURCE = {
  students: "students",
  groups: "groups",
  lessons: "lessons",
  interactives: "interactive",
  ai: "ai",
  feature: "feature",
  schedule: "schedule",
  student_booking: "student_booking",
};

export default function UpgradeLimitModal({
  type = "students",
  reason = "limit_reached",
  currentPlan,
  recommendedPlan,
  onClose,
}) {
  const mappedReason =
    reason === "anonymous" ||
    reason === "insufficient_plan" ||
    reason === "feature_not_in_plan" ||
    reason === "limit_reached"
      ? reason
      : "limit_reached";
  return (
    <AccessGateModal
      open
      reason={mappedReason}
      resourceType={TYPE_TO_RESOURCE[type] || type || "feature"}
      requiredPlan={recommendedPlan}
      currentPlan={currentPlan?.slug || currentPlan?.name}
      authenticated={mappedReason !== "anonymous"}
      onClose={onClose}
    />
  );
}
