import { BarChart3 } from "lucide-react";

type HeroDashboardPreviewProps = {
  tasksCountLabel: string;
  subjectsCountLabel: string;
  generatedVariantsCountLabel: string;
};

export default function HeroDashboardPreview({
  tasksCountLabel,
  subjectsCountLabel,
  generatedVariantsCountLabel,
}: HeroDashboardPreviewProps) {
  const platformStats = [
    { value: tasksCountLabel, label: "всего задач в банке" },
    { value: subjectsCountLabel, label: "предметов доступно сейчас" },
    { value: generatedVariantsCountLabel, label: "вариантов уже сгенерировано" },
  ];

  return (
    <div className="home-hero-dashboard" aria-label="Превью кабинета учителя">
      <article className="home-hero-dashboard__today">
        <div className="home-hero-dashboard__today-head">
          <span className="home-hero-dashboard__today-icon" aria-hidden>
            <BarChart3 size={15} strokeWidth={2.2} />
          </span>
          <h2 className="home-hero-dashboard__today-title">Сейчас на платформе</h2>
        </div>
        <p className="home-hero-dashboard__today-lead">
          Актуальная статистика по задачам и генерации вариантов.
        </p>
      </article>

      <ul className="home-hero-dashboard__stats-grid">
        {platformStats.map((stat) => (
          <li key={stat.label} className="home-hero-platform-stat">
            <span className="home-hero-platform-stat__value">{stat.value}</span>
            <span className="home-hero-platform-stat__label">{stat.label}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}
