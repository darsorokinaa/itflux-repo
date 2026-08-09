import { Link, useNavigate, useOutletContext } from "react-router-dom";
import { displayName } from "../../pages/CabinetAuthPage";
import CabinetIcon from "../CabinetIcons";
import { CABINET_MORE_GROUPS } from "../cabinetNav";
import { CabinetPageShell, CabinetPageHeader, CabinetSoonBadge } from "../CabinetSectionUi";
import ProfileAvatarEditor from "../components/ProfileAvatarEditor";
import { useSeasonalTheme } from "../../seasonal/SeasonalThemeProvider";
import { openSupport as openSupportEvent } from "../support";

function formatNavCount(count) {
  if (!count || count <= 0) return null;
  return count > 99 ? "99+" : String(count);
}

function MoreCard({ item, onSettings, onGuide, onSupport, onNotifications, onAppearance, badgeCount = 0 }) {
  const countLabel = formatNavCount(badgeCount);

  if (item.action === "settings") {
    return (
      <button type="button" className="cb-more-card" onClick={onSettings}>
        <span className="cb-more-card__icon">
          <CabinetIcon name={item.icon} />
        </span>
        <span className="cb-more-card__label">{item.label}</span>
      </button>
    );
  }

  if (item.action === "guide") {
    return (
      <button type="button" className="cb-more-card" onClick={onGuide}>
        <span className="cb-more-card__icon">
          <CabinetIcon name={item.icon} />
        </span>
        <span className="cb-more-card__label">{item.label}</span>
      </button>
    );
  }

  if (item.action === "support") {
    return (
      <button type="button" className="cb-more-card" onClick={onSupport}>
        <span className="cb-more-card__icon">
          <CabinetIcon name={item.icon} />
        </span>
        <span className="cb-more-card__label">{item.label}</span>
      </button>
    );
  }

  if (item.action === "notifications") {
    return (
      <button type="button" className="cb-more-card" onClick={onNotifications}>
        <span className="cb-more-card__icon">
          <CabinetIcon name={item.icon} />
        </span>
        <span className="cb-more-card__label">{item.label}</span>
      </button>
    );
  }

  if (item.action === "appearance") {
    return (
      <button type="button" className="cb-more-card" onClick={onAppearance}>
        <span className="cb-more-card__icon">
          <CabinetIcon name={item.icon} />
        </span>
        <span className="cb-more-card__label">{item.label}</span>
      </button>
    );
  }

  const className = [
    "cb-more-card",
    item.soon ? "cb-more-card--soon" : "",
    item.disabled ? "cb-more-card--disabled" : "",
  ].filter(Boolean).join(" ");

  const content = (
    <>
      <span className="cb-more-card__top">
        <span className="cb-more-card__icon">
          <CabinetIcon name={item.icon} />
        </span>
        {countLabel ? (
          <span
            className={`cb-more-card__badge${item.id === "review" ? " cb-more-card__badge--accent" : ""}`}
            aria-hidden="true"
          >
            {countLabel}
          </span>
        ) : null}
      </span>
      <span className="cb-more-card__label">{item.label}</span>
      {item.soon ? <CabinetSoonBadge /> : null}
    </>
  );

  if (item.disabled) {
    return (
      <span className={className} aria-disabled="true" title="Скоро">
        {content}
      </span>
    );
  }

  return (
    <Link
      to={item.path}
      className={className}
      aria-label={countLabel ? `${item.label}, ${countLabel}` : item.label}
    >
      {content}
    </Link>
  );
}

export default function CabinetMorePage() {
  const navigate = useNavigate();
  const {
    user,
    handleLogout,
    loggingOut,
    openGuide,
    openSupport,
    currentPlan,
    subscriptionLoading,
    navCounts,
    refreshUser,
  } = useOutletContext();
  const name = user ? displayName(user) : "";
  const planName = currentPlan?.name || "";

  const moreGroups = [
    ...CABINET_MORE_GROUPS,
    {
      id: "help",
      label: "Помощь",
      items: [
        { id: "guide", label: "Инструкция", path: null, icon: "bulb", action: "guide" },
        { id: "support", label: "Поддержка", path: null, icon: "help", action: "support" },
      ],
    },
  ];
  const openNotifications = () => window.dispatchEvent(new Event("cabinet:open-notifications"));
  const openSettings = () => navigate("/cabinet/settings/notifications/");
  const { openAppearancePanel, hasSeasonalAppearance } = useSeasonalTheme();

  const badgeForItem = (itemId) => {
    if (itemId === "review") return navCounts?.reviews || 0;
    if (itemId === "students") return navCounts?.students || 0;
    return 0;
  };

  return (
    <CabinetPageShell>
      <CabinetPageHeader title="Ещё" />
      <div className="cb-more-sections">
        {moreGroups.map((group) => {
          const items = group.items.filter(
            (item) => item.action !== "appearance" || hasSeasonalAppearance,
          );
          if (!items.length) return null;
          return (
          <section key={group.id} className="cb-more-section">
            <h2 className="cb-more-section__title">{group.label}</h2>
            <div className="cb-more-grid">
              {items.map((item) => (
                <MoreCard
                  key={item.id}
                  item={item}
                  badgeCount={badgeForItem(item.id)}
                  onSettings={openSettings}
                  onAppearance={openAppearancePanel}
                  onGuide={openGuide}
                  onSupport={openSupport || openSupportEvent}
                  onNotifications={openNotifications}
                />
              ))}
            </div>
          </section>
          );
        })}
      </div>
      {user ? (
        <div className="cb-more-profile">
          <ProfileAvatarEditor
            avatarUrl={user.avatar || ""}
            displayName={name}
            onChanged={refreshUser}
            size="sm"
          />
          <div className="cb-more-profile__body">
            <strong>{name}</strong>
            <span>Учитель</span>
            <Link
              to="/cabinet/upgrade"
              className="cb-more-profile__plan"
              title={planName ? `Тариф «${planName}»` : "Тарифы"}
            >
              Тариф: {subscriptionLoading ? "…" : (planName || "Не выбран")}
            </Link>
          </div>
          <button
            type="button"
            className="cb-btn cb-btn--outline cb-btn--sm"
            onClick={handleLogout}
            disabled={loggingOut}
          >
            {loggingOut ? "…" : "Выйти"}
          </button>
        </div>
      ) : null}
    </CabinetPageShell>
  );
}
