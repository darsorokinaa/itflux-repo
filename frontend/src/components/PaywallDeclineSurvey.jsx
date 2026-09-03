import { trackValueGoal } from "../utils/valuePath";

const REASONS = [
  { id: "no_topic", label: "Не нашёл нужную тему" },
  { id: "want_more_preview", label: "Хочу сначала лучше попробовать" },
  { id: "unclear_contents", label: "Не понимаю, что входит" },
  { id: "too_expensive", label: "Пока дорого" },
  { id: "not_needed_now", label: "Сейчас не нужен" },
  { id: "other", label: "Другое" },
];

export default function PaywallDeclineSurvey({ open, scope = "lesson", onClose }) {
  if (!open) return null;
  return (
    <div className="paywall-decline" role="group" aria-label="Что сейчас мешает продолжить?">
      <p className="paywall-decline__q">Что сейчас мешает продолжить?</p>
      <div className="paywall-decline__options">
        {REASONS.map((reason) => (
          <button
            key={reason.id}
            type="button"
            className="paywall-decline__btn"
            onClick={() => {
              trackValueGoal("paywall_decline_reason", { scope, reason: reason.id });
              onClose?.();
            }}
          >
            {reason.label}
          </button>
        ))}
      </div>
      <button type="button" className="paywall-decline__skip" onClick={onClose}>
        Пропустить
      </button>
    </div>
  );
}
