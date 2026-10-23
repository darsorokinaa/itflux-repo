import { Link } from "react-router-dom";
import { ArrowRight } from "lucide-react";
import HeroDashboardPreview from "./HeroDashboardPreview";
import SeasonalHeroSticker from "../seasonal/SeasonalHeroSticker";

type HeroSectionProps = {
  tasksCountLabel: string;
  subjectsCountLabel: string;
  generatedVariantsCountLabel: string;
  /** r103: на главной над блоком стоит новый hero с h1, поэтому здесь h2. */
  headingLevel?: 1 | 2;
};

export default function HeroSection({
  tasksCountLabel,
  subjectsCountLabel,
  generatedVariantsCountLabel,
  headingLevel = 1,
}: HeroSectionProps) {
  const Heading = headingLevel === 2 ? "h2" : "h1";
  return (
    <section className="home-hero" aria-labelledby="home-hero-heading">
      <div className="home-hero__inner">
        <div className="home-hero__content">
          <span className="home-hero__badge">ПРОСТРАНСТВО ДЛЯ УЧИТЕЛЕЙ</span>

          <Heading id="home-hero-heading" className="home-hero__title">
            Цифровой поток — всё для уроков, заданий и проверки в одном месте
          </Heading>

          <p className="home-hero__description">
            Собирайте варианты, используйте готовые уроки, выдавайте домашние
            задания и отслеживайте результаты учеников без лишних вкладок и
            ручной проверки.
          </p>

          <div className="home-hero__actions">
            <Link to="/lessons" className="home-hero__button home-hero__button--primary">
              Найти готовый урок
            </Link>
            <Link to="/generator" className="home-hero__button home-hero__button--secondary">
              Собрать вариант
              <ArrowRight size={14} strokeWidth={2.5} aria-hidden="true" />
            </Link>
            <Link to="/repetitor" className="home-hero__button home-hero__button--ghost">
              Настроить работу с учениками
            </Link>
          </div>

          <p className="home-hero__note">
            Для репетиторов, преподавателей и онлайн-школ, которым важно держать
            материалы, учеников и задания в одной системе.
          </p>
        </div>

        <div className="home-hero__preview-shell">
          <HeroDashboardPreview
            tasksCountLabel={tasksCountLabel}
            subjectsCountLabel={subjectsCountLabel}
            generatedVariantsCountLabel={generatedVariantsCountLabel}
          />
        </div>
      </div>

      <SeasonalHeroSticker />
    </section>
  );
}
