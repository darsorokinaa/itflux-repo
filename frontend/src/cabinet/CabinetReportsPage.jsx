import CabinetIcon from "./CabinetIcons";
import {
  CabinetPageShell,
  CabinetPageHeader,
  CabinetSectionGrid,
  CabinetEmptyState,
  CabinetSoonBadge,
  useSoonToast,
} from "./CabinetSectionUi";

const REPORT_CARDS = [
  {
    title: "По ученику",
    description: "Прогресс и слабые темы.",
    icon: "user",
  },
  {
    title: "По группе",
    description: "Средний прогресс и активность.",
    icon: "users",
  },
  {
    title: "По урокам",
    description: "Пройденные уроки и материалы.",
    icon: "lessons",
  },
  {
    title: "По темам",
    description: "Усвоение и ошибки по темам.",
    icon: "chart",
  },
  {
    title: "Для родителя",
    description: "Краткая сводка прогресса.",
    icon: "note",
  },
];

export default function CabinetReportsPage() {
  const { notifySoon, toast } = useSoonToast();

  return (
    <CabinetPageShell className="cb-section--reports">
      {toast}
      <CabinetPageHeader title="Отчёты" />

      <div className="cb-report-tools">
        <button type="button" className="cb-btn cb-btn--outline cb-btn--sm" onClick={notifySoon}>Выбрать ученика</button>
        <button type="button" className="cb-btn cb-btn--outline cb-btn--sm" onClick={notifySoon}>Выбрать группу</button>
        <button type="button" className="cb-btn cb-btn--outline cb-btn--sm" onClick={notifySoon}>Выбрать период</button>
        <button type="button" className="cb-btn cb-btn--outline cb-btn--sm" onClick={notifySoon}>Скачать PDF</button>
        <button type="button" className="cb-btn cb-btn--outline cb-btn--sm" onClick={notifySoon}>Скачать Excel</button>
        <button type="button" className="cb-btn cb-btn--primary cb-btn--sm" onClick={notifySoon}>Копировать сводку</button>
      </div>

      <CabinetSectionGrid columns="2">
        {REPORT_CARDS.map((card) => (
          <article key={card.title} className="cb-report-card">
            <div className="cb-report-card__icon">
              <CabinetIcon name={card.icon} />
            </div>
            <div className="cb-report-card__body">
              <h3 className="cb-report-card__title">{card.title}</h3>
              <p className="cb-report-card__desc">{card.description}</p>
            </div>
            <button type="button" className="cb-report-card__btn cb-btn cb-btn--outline cb-btn--sm" onClick={notifySoon}>
              Открыть
            </button>
            <CabinetSoonBadge />
          </article>
        ))}
      </CabinetSectionGrid>

      <div className="cb-report-empty-hint">
        <CabinetEmptyState
          icon="chart"
          title="Недостаточно данных"
          text="Отчёты появятся после выполнения заданий."
        />
      </div>
    </CabinetPageShell>
  );
}
