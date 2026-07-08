import type { ReactNode } from "react";

type HeroFeatureCardProps = {
  title: string;
  description: string;
  icon: ReactNode;
  badge?: string;
};

export default function HeroFeatureCard({
  title,
  description,
  icon,
  badge,
}: HeroFeatureCardProps) {
  return (
    <article className="home-hero-feature-card">
      <div className="home-hero-feature-card__head">
        <span className="home-hero-feature-card__icon" aria-hidden>
          {icon}
        </span>
        {badge ? (
          <span className="home-hero-feature-card__badge">{badge}</span>
        ) : null}
      </div>
      <h3 className="home-hero-feature-card__title">{title}</h3>
      <p className="home-hero-feature-card__description">{description}</p>
    </article>
  );
}
