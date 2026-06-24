import { Link } from "react-router-dom";
import CabinetIcon from "../../CabinetIcons";
import { STUDENT_NAV } from "../studentNav";
import { StudentPageHeader, StudentPageShell } from "../StudentSectionUi";

export default function StudentMorePage() {
  const moreItems = STUDENT_NAV.filter((item) => item.mobileMore);

  return (
    <StudentPageShell>
      <StudentPageHeader title="Ещё" />
      <div className="st-more-grid">
        {moreItems.map((item) => (
          <Link key={item.id} to={item.path} className="st-more-card">
            <CabinetIcon name={item.icon} />
            <span>{item.label}</span>
          </Link>
        ))}
      </div>
    </StudentPageShell>
  );
}
