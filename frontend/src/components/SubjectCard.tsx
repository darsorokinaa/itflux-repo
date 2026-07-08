import type { CSSProperties } from "react";
import type { SubjectDefinition, SubjectMotifKind } from "../data/subjects";

export type SubjectCardProps = {
  subject: SubjectDefinition;
  locked?: boolean;
  onClick: () => void;
};

type SubjectMotifIconProps = {
  kind: SubjectMotifKind;
  className?: string;
};

function SubjectMotifIcon({ kind, className }: SubjectMotifIconProps) {
  switch (kind) {
    case "formula":
      return (
        <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
          <path d="M6 7h4M8 5v4M14 6h4M6 16h12M6 19h12" />
        </svg>
      );
    case "graph":
      return (
        <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
          <path d="M4 19h16M6 17V5M8 15l3-3 3 2 4-5" />
        </svg>
      );
    case "figure":
      return (
        <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
          <circle cx="7" cy="8" r="2.3" />
          <path d="M12 10l3-5 3 5Z" />
          <rect x="6" y="14" width="5" height="5" rx="1" />
        </svg>
      );
    case "code":
      return (
        <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
          <path d="m9 7-4 5 4 5M15 7l4 5-4 5M12 6l-1 12" />
        </svg>
      );
    case "algorithm":
      return (
        <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
          <circle cx="6" cy="6" r="1.8" />
          <circle cx="18" cy="6" r="1.8" />
          <circle cx="12" cy="18" r="1.8" />
          <path d="M7.8 6h8.4M16.5 7.3 13.4 16M7.5 7.3 10.6 16" />
        </svg>
      );
    case "data":
      return (
        <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
          <ellipse cx="12" cy="6.5" rx="6.5" ry="2.5" />
          <path d="M5.5 6.5v8c0 1.4 2.9 2.5 6.5 2.5s6.5-1.1 6.5-2.5v-8" />
          <path d="M5.5 10.5c0 1.4 2.9 2.5 6.5 2.5s6.5-1.1 6.5-2.5" />
        </svg>
      );
    case "force":
      return (
        <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
          <path d="M4 12h10M11 8l6 4-6 4M6 8v8" />
        </svg>
      );
    case "link":
      return (
        <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
          <path d="M9.5 14.5 7 17a3 3 0 1 1-4.2-4.2l2.6-2.6a3 3 0 0 1 4.2 0" />
          <path d="M14.5 9.5 17 7a3 3 0 1 1 4.2 4.2l-2.6 2.6a3 3 0 0 1-4.2 0" />
          <path d="M8 12h8" />
        </svg>
      );
    case "energy":
      return (
        <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
          <path d="M13 2 5 13h6l-1 9 8-11h-6z" />
        </svg>
      );
    case "molecule":
      return (
        <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
          <circle cx="7" cy="7" r="2.3" />
          <circle cx="17" cy="7" r="2.3" />
          <circle cx="12" cy="16.5" r="2.3" />
          <path d="M9.2 7h5.6M8.6 8.7l2.3 5.4M15.4 8.7l-2.3 5.4" />
        </svg>
      );
    case "flask":
      return (
        <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
          <path d="M10 3h4M11 3v4l-5 9a3 3 0 0 0 2.6 4.5h6.8A3 3 0 0 0 18 16l-5-9V3" />
          <path d="M9 13h6" />
        </svg>
      );
    case "atom":
      return (
        <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
          <circle cx="12" cy="12" r="1.8" />
          <ellipse cx="12" cy="12" rx="7" ry="3.2" />
          <ellipse cx="12" cy="12" rx="3.2" ry="7" />
        </svg>
      );
    case "text":
      return (
        <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
          <path d="M5 6h14M8 6v12M12 11h7M12 15h5" />
        </svg>
      );
    case "quote":
      return (
        <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
          <path d="M6 8h4v4H6zM14 8h4v4h-4z" />
          <path d="M7 12c0 2-1 3-2.5 4M15 12c0 2-1 3-2.5 4" />
        </svg>
      );
    case "speech":
      return (
        <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
          <path d="M5 6h14v9h-8l-4 3v-3H5z" />
          <path d="M9 10h6M9 13h4" />
        </svg>
      );
    case "book":
      return (
        <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
          <path d="M4 6a2 2 0 0 1 2-2h4a3 3 0 0 1 2 1.2A3 3 0 0 1 14 4h4a2 2 0 0 1 2 2v12a1 1 0 0 1-1 1h-5a2 2 0 0 0-2 1 2 2 0 0 0-2-1H5a1 1 0 0 1-1-1Z" />
          <path d="M12 5v15" />
        </svg>
      );
    case "hero":
      return (
        <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
          <path d="m12 3 2.2 4.6 5 .7-3.6 3.5.9 5-4.5-2.4-4.5 2.4.9-5L4.8 8.3l5-.7Z" />
        </svg>
      );
    case "quill":
      return (
        <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
          <path d="M20 4c-5 1-8 4-10 8l2 2c4-2 7-5 8-10Z" />
          <path d="M6 18l4-4M5 19l3-1" />
        </svg>
      );
    case "timeline":
      return (
        <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
          <path d="M4 12h16" />
          <circle cx="7" cy="12" r="1.6" />
          <circle cx="12" cy="12" r="1.6" />
          <circle cx="17" cy="12" r="1.6" />
        </svg>
      );
    case "landmark":
      return (
        <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
          <path d="M4 9h16M6 9V6l6-3 6 3v3M7 9v8M12 9v8M17 9v8M4 17h16M3 20h18" />
        </svg>
      );
    case "scroll":
      return (
        <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
          <path d="M8 4h8a3 3 0 0 1 3 3v9H9a3 3 0 0 0-3 3" />
          <path d="M8 4a3 3 0 1 0 0 6h11M12 9h4M12 12h4" />
        </svg>
      );
    default:
      return null;
  }
}

export default function SubjectCard({
  subject,
  locked: lockedOverride,
  onClick,
}: SubjectCardProps) {
  const isLocked = typeof lockedOverride === "boolean" ? lockedOverride : Boolean(subject.comingSoon);
  const bgImageUrl = subject.backgroundImageUrl?.trim();
  const bgColor = subject.backgroundColor?.trim();
  const usesCustomBackground = Boolean(bgImageUrl || bgColor);

  const cardStyle = {
    "--subject-card-top": bgColor || subject.bg,
    "--subject-card-border": subject.accent,
    "--subject-card-pattern-url": bgImageUrl
      ? `url("${bgImageUrl}")`
      : `url("${subject.patternAsset}")`,
  } as CSSProperties;

  const className = [
    "subject-dashboard-card",
    `subject-dashboard-card--${subject.id}`,
    usesCustomBackground && bgImageUrl && "subject-dashboard-card--has-bg-image",
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
      <span className="subject-dashboard-card__top" aria-hidden>
        <span className="subject-dashboard-card__pattern" />
        <span className="subject-dashboard-card__motifs">
          {subject.motifs.map((motif, idx) => (
            <span key={`${subject.id}-${motif}-${idx}`} className={`subject-dashboard-card__motif subject-dashboard-card__motif--${idx + 1}`}>
              <SubjectMotifIcon kind={motif} className="subject-dashboard-card__motif-icon" />
            </span>
          ))}
        </span>
      </span>

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
