import { Link, useOutletContext } from "react-router-dom";
import { displayName } from "../../pages/CabinetAuthPage";
import CabinetIcon from "../CabinetIcons";
import { CABINET_MORE_ITEMS } from "../cabinetNav";
import { CabinetPageShell, CabinetPageHeader, CabinetSoonBadge, useSoonToast } from "../CabinetSectionUi";

function MoreCard({ item, onSettings, onGuide, onNotifications }) {
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

  const className = [
    "cb-more-card",
    item.soon ? "cb-more-card--soon" : "",
    item.disabled ? "cb-more-card--disabled" : "",
  ].filter(Boolean).join(" ");

  const content = (
    <>
      <span className="cb-more-card__icon">
        <CabinetIcon name={item.icon} />
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
    <Link to={item.path} className={className}>
      {content}
    </Link>
  );
}

export default function CabinetMorePage() {
  const { user, handleLogout, loggingOut, openGuide } = useOutletContext();
  const { notifySoon, toast } = useSoonToast();
  const name = user ? displayName(user) : "";

  const moreItems = [
    ...CABINET_MORE_ITEMS,
    { id: "guide", label: "Инструкция", path: null, icon: "bulb", action: "guide" },
  ];
  const openNotifications = () => window.dispatchEvent(new Event("cabinet:open-notifications"));

  return (
    <CabinetPageShell>
      {toast}
      <CabinetPageHeader title="Ещё" />
      <div className="cb-more-grid">
        {moreItems.map((item) => (
          <MoreCard
            key={item.id}
            item={item}
            onSettings={notifySoon}
            onGuide={openGuide}
            onNotifications={openNotifications}
          />
        ))}
      </div>
      {user ? (
        <div className="cb-more-profile">
          <div className="cb-more-profile__avatar" aria-hidden="true">
            {name.charAt(0).toUpperCase()}
          </div>
          <div className="cb-more-profile__body">
            <strong>{name}</strong>
            <span>Учитель</span>
          </div>
          <button
            type="button"
            className="cb-btn cb-btn--outline cb-btn--sm"
            onClick={handleLogout}
            disabled={loggingOut}
          >
            Выйти
          </button>
        </div>
      ) : null}
    </CabinetPageShell>
  );
}
