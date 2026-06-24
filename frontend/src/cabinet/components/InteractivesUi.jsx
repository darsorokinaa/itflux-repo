import { useEffect, useMemo, useRef, useState } from "react";
import CabinetIcon from "../CabinetIcons";
import {
  appearancePageClass,
  appearancePageStyle,
  resolveInteractiveAppearance,
} from "../interactiveAppearance";
import {
  INTERACTIVE_TYPES,
  getInteractiveCoverTheme,
  getInteractiveFirstSlide,
  getItemCount,
  getStatusMeta,
  getTypeMeta,
  canAssignInteractive,
} from "../interactivesData";

export function TypeCoverArt({ type }) {
  if (type === "flashcards") {
    return (
      <div className="ix-cover ix-cover--flash" aria-hidden="true">
        <div className="ix-cover__card ix-cover__card--back">ответ</div>
        <div className="ix-cover__card ix-cover__card--front">термин</div>
        <div className="ix-cover__card ix-cover__card--mini">AND</div>
      </div>
    );
  }
  if (type === "matching") {
    return (
      <div className="ix-cover ix-cover--match" aria-hidden="true">
        <div className="ix-cover__col">
          <div className="ix-cover__chip">AND</div>
          <div className="ix-cover__chip">1010₂</div>
        </div>
        <div className="ix-cover__lines">
          <span /><span />
        </div>
        <div className="ix-cover__col">
          <div className="ix-cover__chip">лог. И</div>
          <div className="ix-cover__chip">10₁₀</div>
        </div>
      </div>
    );
  }
  return (
    <div className="ix-cover ix-cover--seq" aria-hidden="true">
      <div className="ix-cover__step"><i>1</i><span>for i in range(3):</span></div>
      <div className="ix-cover__step"><i>2</i><span>print(i)</span></div>
      <div className="ix-cover__step ix-cover__step--ghost"><i>3</i><span>...</span></div>
    </div>
  );
}

export function HeroIllustration() {
  return (
    <div className="ix-hero__art" aria-hidden="true">
      <div className="ix-hero__float ix-hero__float--card">print()</div>
      <div className="ix-hero__float ix-hero__float--answer">→ вывод</div>
      <div className="ix-hero__float ix-hero__float--match">AND ↔ И</div>
      <div className="ix-hero__float ix-hero__float--steps">
        <span>1</span><span>2</span><span>3</span>
      </div>
    </div>
  );
}

export function InteractivesHero({ onCreate, onTemplates }) {
  return (
    <section className="ix-hero">
      <div className="ix-hero__content">
        <h1 className="ix-hero__title">Интерактивы</h1>
        <p className="ix-hero__text">
          Создавайте задания для повторения и практики.
        </p>
        <div className="ix-hero__actions">
          <button type="button" className="ix-hero__btn ix-hero__btn--primary" onClick={onCreate}>
            Создать
          </button>
          {onTemplates ? (
            <button type="button" className="ix-hero__btn ix-hero__btn--ghost" onClick={onTemplates}>
              Шаблоны
            </button>
          ) : null}
        </div>
      </div>
      <HeroIllustration />
    </section>
  );
}

export function InteractiveTypeCard({ type, onCreate, compact = false }) {
  const meta = INTERACTIVE_TYPES[type];
  return (
    <article className={`ix-type-card ix-type-card--${meta.accent}${compact ? " ix-type-card--compact" : ""}`}>
      <div className={`ix-type-card__cover ix-cover-theme ix-cover-theme--${meta.coverTheme}`}>
        <div className="ix-cover-theme__icon">
          <CabinetIcon name={meta.icon} />
        </div>
      </div>
      <div className="ix-type-card__body">
        <div className={`ix-type-card__icon ix-type-card__icon--${meta.accent}`}>
          <CabinetIcon name={meta.icon} />
        </div>
        <h3 className="ix-type-card__title">{meta.label}</h3>
        <p className="ix-type-card__desc">{meta.description}</p>
        <button
          type="button"
          className={`ix-type-card__btn ix-type-card__btn--${meta.accent}`}
          onClick={() => onCreate(type)}
        >
          {meta.createLabel}
        </button>
      </div>
    </article>
  );
}

export function InteractivesFilterPills({ filters, active, onChange }) {
  return (
    <div className="ix-filters" role="tablist" aria-label="Фильтр интерактивов">
      {filters.map((f) => (
        <button
          key={f.id}
          type="button"
          role="tab"
          aria-selected={active === f.id}
          className={`ix-filter-pill${active === f.id ? " ix-filter-pill--active" : ""}`}
          onClick={() => onChange(f.id)}
        >
          {f.label}
        </button>
      ))}
    </div>
  );
}

function statusBadgeClass(status) {
  const map = {
    draft: "gray",
    published: "success",
    assigned: "info",
    review: "warn",
  };
  return map[status] || "gray";
}

function InteractiveCoverSlide({ slide, cardClass }) {
  if (!slide) return null;

  if (slide.type === "flashcards") {
    return (
      <div className={`ix-cover-slide ix-cover-slide--flash ${cardClass || ""}`}>
        <div className="ix-cover-slide__flash-card" aria-hidden="true">
          <p>{slide.front || "—"}</p>
        </div>
      </div>
    );
  }

  if (slide.type === "matching") {
    return (
      <div className={`ix-cover-slide ix-cover-slide--match ${cardClass || ""}`} aria-hidden="true">
        <span className="ix-cover-slide__chip">{slide.left || "—"}</span>
        <span className="ix-cover-slide__dash">↔</span>
        <span className="ix-cover-slide__chip">{slide.right || "—"}</span>
      </div>
    );
  }

  return (
    <div className={`ix-cover-slide ix-cover-slide--sequence ${cardClass || ""}`} aria-hidden="true">
      <span className="ix-cover-slide__num">{slide.position}</span>
      <span className="ix-cover-slide__text">{slide.text}</span>
    </div>
  );
}

export function InteractiveActivityCard({
  interactive,
  onOpen,
  onEdit,
  onAssign,
  onDuplicate,
  onDelete,
}) {
  const typeMeta = getTypeMeta(interactive.type);
  const coverTheme = getInteractiveCoverTheme(interactive);
  const firstSlide = useMemo(() => getInteractiveFirstSlide(interactive), [interactive]);
  const appearance = useMemo(
    () => resolveInteractiveAppearance(interactive),
    [interactive],
  );
  const hasSlidePreview = Boolean(firstSlide);
  const statusMeta = getStatusMeta(interactive.status);
  const count = getItemCount(interactive);
  const itemLabel = interactive.type === "flashcards"
    ? "карточек"
    : interactive.type === "matching"
      ? "пар"
      : "элементов";

  const metaLine = [
    typeMeta.shortLabel,
    `${count} ${itemLabel}`,
    interactive.exam !== "без экзамена" ? interactive.exam : null,
  ].filter(Boolean).join(" · ");

  const [menuOpen, setMenuOpen] = useState(false);
  const menuRef = useRef(null);
  const canAssign = canAssignInteractive(interactive);

  useEffect(() => {
    if (!menuOpen) return undefined;
    const close = (e) => {
      if (menuRef.current && !menuRef.current.contains(e.target)) setMenuOpen(false);
    };
    document.addEventListener("click", close);
    return () => document.removeEventListener("click", close);
  }, [menuOpen]);

  return (
    <article className="ix-activity-card">
      <div
        className={[
          "ix-activity-card__cover",
          hasSlidePreview
            ? `ix-activity-card__cover--slide ${appearancePageClass(appearance)}`
            : `ix-cover-theme ix-cover-theme--${coverTheme}`,
        ].join(" ")}
        style={hasSlidePreview ? appearancePageStyle(appearance) : undefined}
      >
        {hasSlidePreview ? (
          <InteractiveCoverSlide
            slide={firstSlide}
            cardClass={appearance.cardStyle?.css_class}
          />
        ) : (
          <div className="ix-cover-theme__icon">
            <CabinetIcon name={typeMeta.icon} />
          </div>
        )}
        <span className="ix-activity-card__type">
          {typeMeta.shortLabel}
        </span>
      </div>
      <div className="ix-activity-card__body">
        <div className="ix-activity-card__head">
          <h3 className="ix-activity-card__title">{interactive.title || "Без названия"}</h3>
          <div
            className={`ix-activity-card__menu-wrap${menuOpen ? " is-open" : ""}`}
            ref={menuRef}
          >
            <button
              type="button"
              className="ix-activity-card__menu-btn"
              aria-label="Меню"
              onClick={(e) => { e.stopPropagation(); setMenuOpen((v) => !v); }}
            >
              ⋯
            </button>
            {menuOpen ? (
              <div className="ix-activity-card__dropdown">
                <button type="button" onClick={() => { setMenuOpen(false); onOpen?.(); }}>Открыть</button>
                <button type="button" onClick={() => { setMenuOpen(false); onEdit?.(); }}>Редактировать</button>
                <button type="button" onClick={() => { setMenuOpen(false); onDuplicate?.(); }}>Дублировать</button>
                <button
                  type="button"
                  disabled={!canAssign}
                  title={canAssign ? "" : "Сначала опубликуйте"}
                  onClick={() => { if (!canAssign) return; setMenuOpen(false); onAssign?.(); }}
                >
                  Выдать
                </button>
                <button type="button" className="danger" onClick={() => { setMenuOpen(false); onDelete?.(); }}>Удалить</button>
              </div>
            ) : null}
          </div>
        </div>
        <p className="ix-activity-card__meta">{metaLine}</p>
        <span className={`ix-status-badge ix-status-badge--${statusBadgeClass(interactive.status)}`}>
          {statusMeta.label}
        </span>
      </div>
    </article>
  );
}

export function InteractiveTemplateCard({ template, copyHref }) {
  const typeMeta = getTypeMeta(template.type);
  return (
    <article className="ix-template-card">
      <div className={`ix-template-card__cover ix-cover-theme ix-cover-theme--${typeMeta.coverTheme}`}>
        <div className="ix-cover-theme__icon">
          <CabinetIcon name={typeMeta.icon} />
        </div>
      </div>
      <div className="ix-template-card__body">
        <span className={`ix-template-card__type ix-template-card__type--${typeMeta.accent}`}>
          {typeMeta.shortLabel}
        </span>
        <h3 className="ix-template-card__title">{template.title}</h3>
        <p className="ix-template-card__meta">{template.topic} · {template.items} эл.</p>
        <Link to={copyHref} className="ix-activity-card__btn ix-activity-card__btn--primary">
          Скопировать
        </Link>
      </div>
    </article>
  );
}

export function InteractivesEmptyState({ onCreate, onTemplates }) {
  return (
    <div className="ix-empty">
      <div className="ix-empty__icon" aria-hidden="true">
        <CabinetIcon name="interactives" />
      </div>
      <h3 className="ix-empty__title">Интерактивов пока нет</h3>
      <p className="ix-empty__text">
        Создайте первое задание — карточки, сопоставление или порядок.
      </p>
      <div className="ix-empty__actions">
        <button type="button" className="cb-btn cb-btn--primary cb-btn--pill" onClick={onCreate}>
          Создать
        </button>
        {onTemplates ? (
          <button type="button" className="cb-btn cb-btn--outline" onClick={onTemplates}>
            Шаблоны
          </button>
        ) : null}
      </div>
    </div>
  );
}

export function TypeSelectModal({ onClose, onSelect }) {
  return (
    <div className="ix-modal-backdrop" role="presentation" onClick={onClose}>
      <div
        className="ix-modal"
        role="dialog"
        aria-modal="true"
        aria-labelledby="ix-type-modal-title"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="ix-modal__head">
          <h2 id="ix-type-modal-title" className="ix-modal__title">Тип интерактива</h2>
          <button type="button" className="ix-modal__close" onClick={onClose} aria-label="Закрыть">×</button>
        </div>
        <div className="ix-modal__body ix-modal__body--types">
          {Object.keys(INTERACTIVE_TYPES).map((type) => (
            <InteractiveTypeCard key={type} type={type} onCreate={(t) => { onSelect(t); onClose(); }} compact />
          ))}
        </div>
      </div>
    </div>
  );
}
