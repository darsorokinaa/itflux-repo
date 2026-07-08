import type { CSSProperties } from "react";
import type { SubjectDefinition } from "../data/subjects";

export type SubjectCardProps = {
  subject: SubjectDefinition;
  locked?: boolean;
  onClick: () => void;
};

export default function SubjectCard({
  subject,
  locked: lockedOverride,
  onClick,
}: SubjectCardProps) {
  const isLocked = typeof lockedOverride === "boolean" ? lockedOverride : Boolean(subject.comingSoon);

  const cardStyle = {
    "--subject-card-top": subject.bg,
    "--subject-card-border": subject.accent,
  } as CSSProperties;

  const className = [
    "subject-dashboard-card",
    `subject-dashboard-card--${subject.id}`,
    isLocked && "is-locked",
  ]
    .filter(Boolean)
    .join(" ");

  return (
    <button
      type="button"
      className={className}
      style={cardStyle}
      disabled={isLocked}
      aria-label={subject.title}
      onClick={() => {
        if (isLocked) return;
        onClick();
      }}
    >
      <span className="subject-dashboard-card__top" aria-hidden />

      <span className="subject-dashboard-card__body">
        <span className="subject-dashboard-card__title">{subject.title}</span>
        <span className="subject-dashboard-card__desc">{subject.description}</span>
      </span>

      <span className="subject-dashboard-card__arrow" aria-hidden>
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor">
          <path d="M5 12h14M13 6l6 6-6 6" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      </span>

      {isLocked ? (
        <span className="subject-dashboard-card__lock-badge">
          Скоро
        </span>
      ) : null}
    </button>
  );
}
