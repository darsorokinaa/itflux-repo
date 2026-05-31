import type { CSSProperties } from "react";
import type { SubjectDefinition, SubjectIconKind, SubjectId } from "../data/subjects";

function SubjectIconGlyph({ kind }: { kind: SubjectIconKind }) {
  if (kind === "sum") {
    return <span className="home-level-card__icon-glyph home-level-card__icon-glyph--sum">∑</span>;
  }
  if (kind === "code") {
    return <span className="home-level-card__icon-glyph home-level-card__icon-glyph--code">&lt;&gt;</span>;
  }
  if (kind === "aa") {
    return (
      <span
        className="home-level-card__icon-glyph home-level-card__icon-glyph--sum"
        style={{ fontSize: "18px" }}
      >
        Аа
      </span>
    );
  }
  if (kind === "atom") {
    return (
      <span className="home-level-card__icon-glyph home-level-card__icon-glyph--atom" aria-hidden>
        <svg width="28" height="28" viewBox="0 0 36 36" fill="none">
          <g transform="translate(18,18)" stroke="currentColor" fill="none">
            <ellipse rx="12" ry="5" strokeWidth="1.2" />
            <ellipse rx="12" ry="5" strokeWidth="1.2" transform="rotate(60)" />
            <ellipse rx="12" ry="5" strokeWidth="1.2" transform="rotate(120)" />
            <circle r="2.5" fill="currentColor" stroke="none" />
          </g>
        </svg>
      </span>
    );
  }
  return <span className="home-level-card__icon-glyph home-level-card__icon-glyph--sum">§</span>;
}

export type SubjectCardProps = {
  subject: SubjectDefinition;
  countLabel: string;
  selectedSubjectId: SubjectId | null;
  onClick: () => void;
};

export default function SubjectCard({
  subject,
  countLabel,
  selectedSubjectId,
  onClick,
}: SubjectCardProps) {
  const id = subject.id;
  const locked = Boolean(subject.comingSoon);
  const selected = selectedSubjectId === id;
  const dimmed = selectedSubjectId !== null && selectedSubjectId !== id;

  const cardStyle: CSSProperties = {
    background: subject.bg,
    borderColor: subject.bg,
    boxShadow:
      selected && !locked
        ? `var(--shadow-card), 0 0 0 3px color-mix(in srgb, ${subject.accent} 55%, white)`
        : "var(--shadow-card)",
    opacity: locked ? (dimmed ? 0.4 : 0.62) : dimmed ? 0.55 : 1,
    transform: dimmed && !locked ? "scale(0.985)" : undefined,
  };

  const className = [
    "home-level-card",
    "subject-pick-card",
    locked && "subject-pick-card--locked",
  ]
    .filter(Boolean)
    .join(" ");

  return (
    <button
      type="button"
      className={className}
      style={cardStyle}
      aria-disabled={locked}
      aria-label={subject.title}
      tabIndex={locked ? -1 : 0}
      onClick={() => {
        if (locked) return;
        onClick();
      }}
    >
      <span className="home-level-card__inner">
        <span className="home-level-card__icon" aria-hidden>
          <SubjectIconGlyph kind={subject.icon} />
        </span>
        <span className="home-level-card__line">
          <span className="home-level-card__title">{subject.title}</span>
          <span className="home-level-card__desc">{subject.description}</span>
        </span>
      </span>

      {!locked ? (
        <span className="home-level-card__right">
          <span className="home-level-card__arrow" aria-hidden>
            <svg
              width="14"
              height="14"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2.5"
              strokeLinecap="round"
              strokeLinejoin="round"
            >
              <path d="M5 12h14M13 6l6 6-6 6" />
            </svg>
          </span>
        </span>
      ) : null}

      <span className="home-level-card__count-corner">{countLabel}</span>
    </button>
  );
}
