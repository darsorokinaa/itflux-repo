import { useLocation } from "react-router-dom";
import { CabinetPageHeader, CabinetPageShell, CabinetSoonBadge } from "../cabinet/CabinetSectionUi";
import { usePageTitle } from "../cabinet/hooks/usePageTitle";
import "../components/SoonModal.css";

export default function WorksheetSoonPage() {
  const inCabinet = useLocation().pathname.startsWith("/cabinet");
  usePageTitle("Конструктор материалов");

  if (inCabinet) {
    return (
      <CabinetPageShell>
        <CabinetPageHeader title="Конструктор материалов" badge={<CabinetSoonBadge />} />
        <div className="cb-placeholder-panel">
          <p>Конструктор материалов скоро будет доступен.</p>
        </div>
      </CabinetPageShell>
    );
  }

  return (
    <main className="soon-page">
      <div className="soon-modal__card">
        <p className="soon-modal__kicker">Скоро</p>
        <h1>Конструктор материалов</h1>
        <p>Скоро будет доступно.</p>
      </div>
    </main>
  );
}
