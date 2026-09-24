import { Link, useOutletContext } from "react-router-dom";
import { displayName } from "../../../pages/CabinetAuthPage";
import CabinetIcon from "../../CabinetIcons";
import ProfileAvatarEditor from "../../components/ProfileAvatarEditor";
import { STUDENT_MORE_GROUPS } from "../studentNav";
import { StudentPageShell } from "../StudentSectionUi";
import { useSeasonalTheme } from "../../../seasonal/SeasonalThemeProvider";

function formatNavCount(count) {
  if (!count || count <= 0) return null;
  return count > 99 ? "99+" : String(count);
}

export default function StudentMorePage() {
  const { user, handleLogout, loggingOut, refreshUser, messageUnread } = useOutletContext() || {};
  const { openAppearancePanel, hasSeasonalAppearance } = useSeasonalTheme();
  const name = user ? displayName(user) : "";

  return (
    <StudentPageShell className="st-more-page">
      <div className="st-more-sections">
        {STUDENT_MORE_GROUPS.map((group) => {
          const items = group.items.filter(
            (item) => item.action !== "appearance" || hasSeasonalAppearance,
          );
          if (!items.length) return null;
          return (
          <section key={group.id} className="st-more-section">
            <h2 className="st-more-section__title">{group.label}</h2>
            <div className="st-more-grid">
              {items.map((item) => {
                const countLabel = item.id === "messages" ? formatNavCount(messageUnread) : null;
                const icon = (
                  <span className="st-more-card__icon" aria-hidden="true">
                    <CabinetIcon name={item.icon} />
                    {countLabel ? <span className="st-more-card__badge">{countLabel}</span> : null}
                  </span>
                );
                if (item.action === "appearance") {
                  return (
                    <button
                      key={item.id}
                      type="button"
                      className="st-more-card"
                      onClick={openAppearancePanel}
                    >
                      {icon}
                      <span className="st-more-card__label">{item.label}</span>
                    </button>
                  );
                }
                return (
                  <Link
                    key={item.id}
                    to={item.path}
                    className="st-more-card"
                    aria-label={countLabel ? `${item.label}, ${countLabel}` : item.label}
                  >
                    {icon}
                    <span className="st-more-card__label">{item.label}</span>
                  </Link>
                );
              })}
            </div>
          </section>
          );
        })}
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
