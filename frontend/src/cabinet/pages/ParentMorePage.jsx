import { Link, useOutletContext, useSearchParams } from "react-router-dom";
import { displayName } from "../../pages/CabinetAuthPage";
import CabinetIcon from "../CabinetIcons";
import ProfileAvatarEditor from "../components/ProfileAvatarEditor";
import { PARENT_MORE_GROUPS } from "../parent/parentNav";
import { StudentPageShell } from "../student/StudentSectionUi";

export default function ParentMorePage() {
  const { user, handleLogout, loggingOut, refreshUser } = useOutletContext() || {};
  const [params] = useSearchParams();
  const q = params.get("student") ? `?student=${params.get("student")}` : "";
  const name = user ? displayName(user) : "";

  return (
    <StudentPageShell className="st-more-page">
      <div className="st-more-sections">
        {PARENT_MORE_GROUPS.map((group) => (
          <section key={group.id} className="st-more-section">
            <h2 className="st-more-section__title">{group.label}</h2>
            <div className="st-more-grid">
              {group.items.map((item) => (
                <Link key={item.id} to={`${item.path}${q}`} className="st-more-card">
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
          <ProfileAvatarEditor
            avatarUrl={user.avatar || ""}
            displayName={name}
            onChanged={refreshUser}
            size="sm"
          />
          <div className="st-more-profile__body">
            <strong>{name}</strong>
            <span>Родитель</span>
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
