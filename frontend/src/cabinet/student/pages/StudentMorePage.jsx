import { Link, useOutletContext } from "react-router-dom";
import { displayName } from "../../../pages/CabinetAuthPage";
import CabinetIcon from "../../CabinetIcons";
import { STUDENT_MORE_GROUPS } from "../studentNav";
import { StudentPageShell } from "../StudentSectionUi";

export default function StudentMorePage() {
  const { user, handleLogout, loggingOut } = useOutletContext() || {};
  const name = user ? displayName(user) : "";

  return (
    <StudentPageShell className="st-more-page">
      <div className="st-more-sections">
        {STUDENT_MORE_GROUPS.map((group) => (
          <section key={group.id} className="st-more-section">
            <h2 className="st-more-section__title">{group.label}</h2>
            <div className="st-more-grid">
              {group.items.map((item) => (
                <Link key={item.id} to={item.path} className="st-more-card">
                  <span className="st-more-card__icon" aria-hidden="true">
                    <CabinetIcon name={item.icon} />
                  </span>
                  <span className="st-more-card__label">{item.label}</span>
                </Link>
              ))}
            </div>
          </section>
        ))}
      </div>

      {user ? (
        <div className="st-more-profile">
          <div className="st-more-profile__avatar" aria-hidden="true">
            {name.charAt(0).toUpperCase()}
          </div>
          <div className="st-more-profile__body">
            <strong>{name}</strong>
            <span>Ученик</span>
          </div>
          {typeof handleLogout === "function" ? (
            <button
              type="button"
              className="cb-btn cb-btn--outline st-more-profile__logout"
              onClick={handleLogout}
              disabled={loggingOut}
            >
              Выйти
            </button>
          ) : null}
        </div>
      ) : null}
    </StudentPageShell>
  );
}
