/**
 * LimitBadge — компактный счётчик использования лимита.
 *
 * Props:
 *   label — «Ученики» / «Группы» / «Интерактивы» / «ИИ» / ...
 *   used  — число
 *   limit — число
 *   loading — bool
 */

export default function LimitBadge({ label, used, limit, loading }) {
  if (loading || limit == null) return null;

  const isFull = used >= limit;

  return (
    <span className={`limit-badge${isFull ? " limit-badge--full" : ""}`} title={`${label}: ${used} из ${limit}`}>
      <span className="limit-badge__label">{label}:</span>
      <span className="limit-badge__count">
        {used}
        <span className="limit-badge__sep">/</span>
        {limit}
      </span>
      {isFull && <span className="limit-badge__dot" aria-label="лимит исчерпан" />}
    </span>
  );
}
