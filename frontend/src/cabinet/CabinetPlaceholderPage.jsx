import { Link } from "react-router-dom";
import CabinetIcon from "./CabinetIcons";

const PLACEHOLDERS = {
  students: {
    title: "Ученики",
    subtitle: "Здесь будет список учеников, группы и управление доступом к материалам.",
    icon: "students",
  },
  lessons: {
    title: "Уроки",
    subtitle: "Здесь будут уроки учителя: созданные, назначенные группам и запланированные занятия.",
    icon: "lessons",
  },
  review: {
    title: "Проверка",
    subtitle: "Здесь будут работы учеников, ожидающие проверки, оценки и комментарии.",
    icon: "check",
  },
  library: {
    title: "Библиотека",
    subtitle: "Материалы платформы: готовые уроки, банк задач и сгенерированные варианты.",
    icon: "folder",
    links: [
      { label: "Готовые уроки", href: "/lessons", icon: "lessons" },
      { label: "Банк задач", href: "/tasks", icon: "tasks" },
      { label: "Генератор вариантов", href: "/generator", icon: "gen" },
    ],
  },
  schedule: {
    title: "Расписание",
    subtitle: "Здесь будет календарь занятий, план уроков и напоминания о предстоящих занятиях.",
    icon: "calendar",
  },
};

export default function CabinetPlaceholderPage({ section }) {
  const data = PLACEHOLDERS[section];
  if (!data) return null;

  return (
    <div className="cb-section cb-section--placeholder">
      <header className="cb-section-head">
        <div className="cb-section-head__icon">
          <CabinetIcon name={data.icon} />
        </div>
        <div>
          <h2 className="cb-section-title">{data.title}</h2>
          <p className="cb-section-sub">{data.subtitle}</p>
        </div>
      </header>

      {data.links ? (
        <div className="cb-placeholder-links">
          {data.links.map((link) => (
            <Link key={link.href} to={link.href} className="cb-placeholder-link">
              <span className="cb-placeholder-link__icon">
                <CabinetIcon name={link.icon} />
              </span>
              <span className="cb-placeholder-link__label">{link.label}</span>
              <span className="cb-placeholder-link__arrow">
                <CabinetIcon name="arrow" />
              </span>
            </Link>
          ))}
        </div>
      ) : (
        <div className="cb-placeholder-panel">
          <span className="cabinet-soon-badge">скоро</span>
          <p>Раздел в разработке — скоро здесь появится полноценный функционал.</p>
        </div>
      )}
    </div>
  );
}
