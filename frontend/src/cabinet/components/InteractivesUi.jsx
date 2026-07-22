import { useEffect, useMemo, useRef, useState } from "react";
import CabinetIcon from "../CabinetIcons";
import {
  appearancePageClass,
  appearancePageStyle,
  resolveInteractiveAppearance,
  useInteractiveAppearanceCatalog,
} from "../interactiveAppearance";
import {
  INTERACTIVE_TYPES,
  getInteractiveDisplayTitle,
  getInteractiveFirstSlide,
  getItemCount,
  getStatusMeta,
  getTypeMeta,
  isInteractiveTypeAvailable,
  canAssignInteractive,
  formatUpdatedAt,
  INTERACTIVE_TYPE_LIST,
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
  if (type === "quiz") {
    return (
      <div className="ix-cover ix-cover--quiz" aria-hidden="true">
        <div className="ix-cover__quiz-q">AND?</div>
        <div className="ix-cover__quiz-a ix-cover__quiz-a--ok">✓</div>
        <div className="ix-cover__quiz-a">OR</div>
      </div>
    );
  }
  if (type === "wheel") {
    return (
      <div className="ix-cover ix-cover--wheel" aria-hidden="true">
        <div className="ix-cover__wheel" />
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
  const available = isInteractiveTypeAvailable(type);

  return (
    <article
      className={[
        "ix-type-card",
        `ix-type-card--${meta.accent}`,
        compact ? "ix-type-card--compact" : "",
        available ? "ix-type-card--active" : "ix-type-card--soon",
      ].filter(Boolean).join(" ")}
      aria-disabled={!available}
    >
      <div className="ix-type-card__body">
        <header className="ix-type-card__head">
          <div className={`ix-type-card__icon ix-type-card__icon--${meta.accent}`} aria-hidden="true">
            <CabinetIcon name={meta.icon} />
          </div>
          {!available ? (
            <span className="ix-type-card__soon-badge">Скоро</span>
          ) : null}
        </header>

        <h3 className="ix-type-card__title">{meta.label}</h3>
        <p className="ix-type-card__desc">{meta.description}</p>
        {meta.useCase ? (
          <p className="ix-type-card__usecase">{meta.useCase}</p>
        ) : null}

        {available ? (
          <button
            type="button"
            className={`ix-type-card__btn ix-type-card__btn--${meta.accent}`}
            onClick={() => onCreate(type)}
          >
            {meta.createLabel}
          </button>
        ) : (
          <span className="ix-type-card__disabled" aria-hidden="true">
            В разработке
          </span>
        )}
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

  if (slide.type === "quiz") {
    return (
      <div className={`ix-cover-slide ix-cover-slide--quiz ${cardClass || ""}`} aria-hidden="true">
        <p className="ix-cover-slide__quiz-text">{slide.text || "—"}</p>
        <div className="ix-cover-slide__quiz-options">
          {(slide.answers || []).slice(0, 2).map((a, i) => (
            <span key={i} className="ix-cover-slide__chip">{a || "—"}</span>
          ))}
        </div>
      </div>
    );
  }

  if (slide.type === "wheel") {
    return (
      <div className={`ix-cover-slide ix-cover-slide--wheel ${cardClass || ""}`} aria-hidden="true">
        <span
          className="ix-cover-slide__chip ix-cover-slide__chip--wheel"
          style={slide.color ? { borderColor: slide.color, color: slide.color } : undefined}
        >
          {slide.title || "—"}
        </span>
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
  const firstSlide = useMemo(() => getInteractiveFirstSlide(interactive), [interactive]);
  const { catalog } = useInteractiveAppearanceCatalog();
  const appearance = useMemo(
    () => resolveInteractiveAppearance(interactive, catalog),
    [interactive, catalog],
  );
  const hasSlidePreview = Boolean(firstSlide);
  const statusMeta = getStatusMeta(interactive.status);
  const count = getItemCount(interactive);
  const itemLabel = interactive.type === "flashcards"
    ? "карточек"
    : interactive.type === "matching"
      ? "пар"
      : interactive.type === "quiz"
        ? "вопросов"
        : interactive.type === "wheel"
          ? "секторов"
          : "элементов";

  const metaParts = [
    typeMeta.shortLabel,
    count > 0 ? `${count} ${itemLabel}` : null,
    interactive.exam !== "без экзамена" ? interactive.exam : null,
  ].filter(Boolean);

  const [menuOpen, setMenuOpen] = useState(false);
  const menuRef = useRef(null);
  const canAssign = canAssignInteractive(interactive);

  useEffect(() => {
    if (!menuOpen) return undefined;
    const close = (e) => {
      if (menuRef.current && !menuRef.current.contains(e.target)) setMenuOpen(false);
    };
    const onKey = (e) => {
      if (e.key === "Escape") setMenuOpen(false);
    };
    document.addEventListener("click", close);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("click", close);
      document.removeEventListener("keydown", onKey);
    };
  }, [menuOpen]);

  return (
    <article
      className={`ix-activity-card ix-activity-card--clickable${menuOpen ? " is-menu-open" : ""}`}
      onClick={() => onOpen?.()}
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          onOpen?.();
        }
      }}
      role="button"
      tabIndex={0}
    >
      <div
        className={[
          "ix-activity-card__cover",
          hasSlidePreview ? "ix-activity-card__cover--slide" : "ix-activity-card__cover--icon",
          appearancePageClass(appearance),
        ].join(" ")}
        style={appearancePageStyle(appearance)}
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
          <h3 className="ix-activity-card__title">{getInteractiveDisplayTitle(interactive)}</h3>
          <div
            className={`ix-activity-card__menu-wrap${menuOpen ? " is-open" : ""}`}
            ref={menuRef}
          >
            <button
              type="button"
              className="ix-activity-card__menu-btn"
              aria-label="Действия"
              aria-expanded={menuOpen}
              onClick={(e) => { e.stopPropagation(); setMenuOpen((v) => !v); }}
            >
              ⋯
            </button>
            {menuOpen ? (
              <div className="ix-activity-card__dropdown" role="menu">
                <button type="button" role="menuitem" onClick={(e) => { e.stopPropagation(); setMenuOpen(false); onOpen?.(); }}>Открыть</button>
                <button type="button" role="menuitem" onClick={(e) => { e.stopPropagation(); setMenuOpen(false); onEdit?.(); }}>Редактировать</button>
                <button type="button" role="menuitem" onClick={(e) => { e.stopPropagation(); setMenuOpen(false); onDuplicate?.(); }}>Дублировать</button>
                <button
                  type="button"
                  role="menuitem"
                  disabled={!canAssign}
                  title={canAssign ? "" : "Сначала опубликуйте"}
                  onClick={(e) => { e.stopPropagation(); if (!canAssign) return; setMenuOpen(false); onAssign?.(); }}
                >
                  Выдать
                </button>
                <button type="button" role="menuitem" className="danger" onClick={(e) => { e.stopPropagation(); setMenuOpen(false); onDelete?.(); }}>Удалить</button>
              </div>
            ) : null}
          </div>
        </div>
        <p className="ix-activity-card__meta">{metaParts.join(" · ")}</p>
        <div className="ix-activity-card__footer">
          <span className={`ix-status-badge ix-status-badge--${statusBadgeClass(interactive.status)}`}>
            {statusMeta.label}
          </span>
          <time className="ix-activity-card__date" dateTime={interactive.updatedAt || undefined}>
            {formatUpdatedAt(interactive.updatedAt)}
          </time>
        </div>
      </div>
    </article>
  );
}

export function InteractivesEmptyState({ onCreate, onQuickCreate }) {
  const quickTypes = INTERACTIVE_TYPE_LIST.filter(isInteractiveTypeAvailable);

  return (
    <div className="ix-empty">
      <div className="ix-empty__panel">
        <div className="ix-empty__icon" aria-hidden="true">
          <CabinetIcon name="interactives" />
        </div>
        <h3 className="ix-empty__title">Создайте первый интерактив</h3>
        <p className="ix-empty__text">
          Выберите формат, добавьте содержание и используйте задание на уроке
          или отправьте его ученикам.
        </p>

        <button type="button" className="ix-empty__cta" onClick={onCreate}>
          Создать интерактив
        </button>

        {quickTypes.length > 0 ? (
          <div className="ix-empty__quick">
            <span className="ix-empty__quick-label">Быстрый выбор</span>
            <div className="ix-empty__quick-list" role="list">
              {quickTypes.map((type, index) => {
                const meta = INTERACTIVE_TYPES[type];
                return (
                  <span key={type} className="ix-empty__quick-item" role="listitem">
                    {index > 0 ? <span className="ix-empty__quick-sep" aria-hidden="true">·</span> : null}
                    <button
                      type="button"
                      className="ix-empty__quick-link"
                      onClick={() => (onQuickCreate ? onQuickCreate(type) : onCreate())}
                    >
                      {meta.shortLabel || meta.label}
                    </button>
                  </span>
                );
              })}
            </div>
          </div>
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
          <h2 id="ix-type-modal-title" className="ix-modal__title">Выберите формат</h2>
          <button type="button" className="ix-modal__close" onClick={onClose} aria-label="Закрыть">×</button>
        </div>
        <div className="ix-modal__body ix-modal__body--types">
          {INTERACTIVE_TYPE_LIST.map((type) => (
            <InteractiveTypeCard
              key={type}
              type={type}
              compact
              onCreate={(t) => {
                if (!isInteractiveTypeAvailable(t)) return;
                onSelect(t);
                onClose();
              }}
            />
          ))}
        </div>
      </div>
    </div>
  );
}
