export default function CollectionAccessBadge({ access, compact = false }) {
  if (access?.has_access) {
    return <span className="lcol-badge lcol-badge--open">Доступ открыт</span>;
  }
  if (access?.price_label && access?.can_purchase) {
    return <span className="lcol-badge">{compact ? access.price_label : "Полный набор"}</span>;
  }
  const plan = access?.plans?.[0]?.name;
  if (plan) return <span className="lcol-badge">Тариф {plan}</span>;
  return <span className="lcol-badge">Набор</span>;
}
