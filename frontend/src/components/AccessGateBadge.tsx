import { Lock } from "lucide-react";
import { planDisplayName } from "../accessGate/accessGate";

export default function AccessGateBadge({ minPlan, accessLevel, allowed, className = "" }) {
  if (allowed === true) return null;
  const slug = minPlan || "";
  if (!slug || slug === "start" || accessLevel === "free") return null;
  const name = planDisplayName(slug);
  return (
    <span className={`access-gate-badge ${className}`.trim()}>
      <Lock size={12} strokeWidth={2.2} aria-hidden="true" />
      {name ? `Доступно с тарифа «${name}»` : "По тарифу"}
    </span>
  );
}
