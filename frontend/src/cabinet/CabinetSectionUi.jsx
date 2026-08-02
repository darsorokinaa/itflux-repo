import { useCallback, useState } from "react";
import { Link } from "react-router-dom";
import CabinetIcon from "./CabinetIcons";

export function CabinetPageShell({ children, className = "" }) {
  return (
    <div className={`cb-section cb-page${className ? ` ${className}` : ""}`}>
      {children}
    </div>
  );
}

export function CabinetPageHeader({ title, subtitle, badge, actions = [], children }) {
  const btnClass = (a) =>
    `cb-btn${a.primary ? " cb-btn--primary" : " cb-btn--outline"}${a.pill ? " cb-btn--pill" : ""}`;

  return (
    <header className="cb-page-header">
      <div className="cb-page-header__text">
        <div className="cb-page-header__title-row">
          <h1 className="cb-page-title">{title}</h1>
          {badge}
        </div>
        {subtitle ? <p className="cb-page-sub">{subtitle}</p> : null}
        {children}
      </div>
      {actions.length > 0 ? (
        <div className="cb-page-actions">
          {actions.map((a) => (
            a.href ? (
              <Link key={a.label} to={a.href} className={btnClass(a)}>
                {a.icon ? <CabinetIcon name={a.icon} /> : null}
                {a.label}
              </Link>
            ) : (
              <button key={a.label} type="button" className={btnClass(a)} onClick={a.onClick}>
                {a.icon ? <CabinetIcon name={a.icon} /> : null}
                {a.label}
              </button>
            )
          ))}
        </div>
      ) : null}
    </header>
  );
}

export function CabinetFilterBar({ filters, active, onChange }) {
  return (
    <div className="cb-filter-bar" role="tablist">
      {filters.map((f) => (
        <button
          key={f.id}
          type="button"
          role="tab"
          aria-selected={active === f.id}
          className={`cb-filter-chip${active === f.id ? " cb-filter-chip--active" : ""}`}
          onClick={() => onChange(f.id)}
        >
          {f.label}
        </button>
      ))}
    </div>
  );
}

export function CabinetMetricsRow({ metrics }) {
  return (
    <div className="cb-metrics cb-metrics--page">
      {metrics.map((m) => (
        <div key={m.label} className={`cb-metric${m.accent ? ` cb-metric--${m.accent}` : ""}`}>
          <div className={`cb-metric__icon cb-metric__icon--${m.tone || "brand"}`}>
            <CabinetIcon name={m.icon} />
          </div>
          <div className="cb-metric__text">
            <span className="cb-metric__value">{m.value}</span>
            <span className="cb-metric__label">
              {m.shortLabel ? (
                <>
                  <span className="cb-metric__label-full">{m.label}</span>
                  <span className="cb-metric__label-short">{m.shortLabel}</span>
                </>
              ) : m.label}
            </span>
          </div>
        </div>
      ))}
    </div>
  );
}

export function CabinetEntityCard({
  tone = "info",
  icon,
  title,
  badge,
  meta = [],
  footer,
  href,
  onAction,
  actionLabel = "Открыть",
}) {
  const body = (
    <>
      <div className={`cb-entity-card__accent cb-entity-card__accent--${tone}`} />
      <div className="cb-entity-card__icon">
        <CabinetIcon name={icon} />
      </div>
      <div className="cb-entity-card__body">
        <div className="cb-entity-card__head">
          <h3 className="cb-entity-card__title">{title}</h3>
          {badge ? <span className={`cb-status-badge cb-status-badge--${badge.tone || "gray"}`}>{badge.text}</span> : null}
        </div>
        {meta.length > 0 ? (
          <ul className="cb-entity-card__meta">
            {meta.map((line) => (
              <li key={line}>{line}</li>
            ))}
          </ul>
        ) : null}
        {footer ? <p className="cb-entity-card__footer">{footer}</p> : null}
      </div>
      <div className="cb-entity-card__actions">
        {href ? (
          <Link to={href} className="cb-btn cb-btn--outline cb-btn--sm">{actionLabel}</Link>
        ) : (
          <button type="button" className="cb-btn cb-btn--outline cb-btn--sm" onClick={onAction}>
            {actionLabel}
          </button>
        )}
      </div>
    </>
  );

  return href ? (
    <article className="cb-entity-card">{body}</article>
  ) : (
    <article className="cb-entity-card cb-entity-card--static">{body}</article>
  );
}

export function CabinetEmptyState({ icon = "folder", title, text, actions = [] }) {
  return (
    <div className="cb-empty-state">
      <div className="cb-empty-state__icon">
        <CabinetIcon name={icon} />
      </div>
      <h2 className="cb-empty-state__title">{title}</h2>
      <p className="cb-empty-state__text">{text}</p>
      {actions.length > 0 ? (
        <div className="cb-empty-state__actions">
          {actions.map((a) => (
            a.href ? (
              <Link
                key={a.label}
                to={a.href}
                className={`cb-btn${a.primary ? " cb-btn--primary" : " cb-btn--outline"}`}
              >
                {a.label}
              </Link>
            ) : (
              <button
                key={a.label}
                type="button"
                className={`cb-btn${a.primary ? " cb-btn--primary" : " cb-btn--outline"}`}
                onClick={a.onClick}
              >
                {a.label}
              </button>
            )
          ))}
        </div>
      ) : null}
    </div>
  );
}

export function CabinetSoonBadge() {
  return <span className="cabinet-soon-badge">скоро</span>;
}

export function useSoonToast() {
  const [message, setMessage] = useState("");

  const notifySoon = useCallback(() => {
    setMessage("Функция скоро появится.");
    window.setTimeout(() => setMessage(""), 2800);
  }, []);

  const showToast = useCallback((text) => {
    setMessage(text);
    window.setTimeout(() => setMessage(""), 2800);
  }, []);

  const toast = message ? (
    <div className="cb-soon-toast" role="status">{message}</div>
  ) : null;

  return { notifySoon, showToast, toast };
}

export function CabinetSectionGrid({ children, columns }) {
  return (
    <div className={`cb-entity-grid${columns ? ` cb-entity-grid--${columns}` : ""}`}>
      {children}
    </div>
  );
}

export function CabinetToolBar({ children }) {
  return <div className="cb-tool-bar">{children}</div>;
}
