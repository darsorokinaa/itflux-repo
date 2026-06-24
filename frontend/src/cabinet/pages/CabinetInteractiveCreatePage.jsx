import { useNavigate } from "react-router-dom";
import { InteractiveTypeCard } from "../components/InteractivesUi";
import { CabinetPageShell, CabinetPageHeader } from "../CabinetSectionUi";
import "../styles/interactives-catalog.css";

export default function CabinetInteractiveCreatePage() {
  const navigate = useNavigate();

  return (
    <CabinetPageShell className="cb-section--interactives-create ix-page">
      <CabinetPageHeader
        title="Тип интерактива"
        actions={[
          { label: "Назад", icon: "arrow", href: "/cabinet/interactives" },
        ]}
      />

      <div className="ix-type-grid ix-type-grid--select">
        {["flashcards", "matching", "sequence"].map((type) => (
          <InteractiveTypeCard key={type} type={type} onCreate={(t) => navigate(`/cabinet/interactives/new/${t}`)} />
        ))}
      </div>

      <button type="button" className="cb-btn cb-btn--outline cb-btn--sm" onClick={() => navigate(-1)}>
        Отмена
      </button>
    </CabinetPageShell>
  );
}
