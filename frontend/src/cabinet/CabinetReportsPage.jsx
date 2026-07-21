import {
  CabinetPageShell,
  CabinetPageHeader,
  CabinetEmptyState,
} from "./CabinetSectionUi";

export default function CabinetReportsPage() {
  return (
    <CabinetPageShell className="cb-section--reports">
      <CabinetPageHeader title="Отчёты" />
      <CabinetEmptyState
        icon="chart"
        title="Раздел находится в разработке"
        text="Здесь появятся отчёты по ученикам, группам и темам. Пока данные прогресса можно смотреть в разделе «Проверка»."
        actions={[
          { label: "Перейти к проверке", primary: true, href: "/cabinet/review" },
        ]}
      />
    </CabinetPageShell>
  );
}
