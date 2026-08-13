import { useRef, useState } from "react";
import { createPortal } from "react-dom";
import CabinetIcon from "../CabinetIcons";

const SCOPE_ACTIONS = {
  default: [
    { scope: "single", label: "Только это занятие", variant: "primary" },
    { scope: "following", label: "Это и следующие", variant: "outline" },
    { scope: "series", label: "Всю серию", variant: "outline" },
  ],
  time: [
    { scope: "series", label: "Всю серию", variant: "primary" },
    { scope: "following", label: "Это и следующие", variant: "outline" },
    { scope: "single", label: "Только это занятие", variant: "outline" },
  ],
};

export default function SeriesScopeModal({
  onClose,
  onConfirm,
  saving = false,
  timeChanged = false,
}) {
  const title = timeChanged ? "Изменить время" : "Применить изменения";
  const text = timeChanged
    ? "Вы изменили время занятия. Применить новое время только к этому уроку или ко всей серии?"
    : "Занятие входит в повторяющуюся серию.";
  const actions = timeChanged ? SCOPE_ACTIONS.time : SCOPE_ACTIONS.default;
  const [pickedScope, setPickedScope] = useState(null);
  const lockedRef = useRef(false);

  const handleConfirm = (scope) => {
    if (saving || lockedRef.current) return;
    lockedRef.current = true;
    setPickedScope(scope);
    Promise.resolve(onConfirm(scope)).finally(() => {
      lockedRef.current = false;
    });
  };

  if (typeof document === "undefined") return null;

  return createPortal(
    <div
      className="cb-sch-overlay cb-sch-overlay--scope"
      onClick={saving ? undefined : onClose}
      role="presentation"
    >
      <div
        className="cb-sch-confirm cb-sch-confirm--scope"
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-labelledby="sch-scope-title"
        aria-busy={saving || undefined}
      >
        <button
          type="button"
          className="cb-sch-popover__close"
          onClick={onClose}
          aria-label="Закрыть"
          disabled={saving}
        >
          <CabinetIcon name="close" />
        </button>
        <h2 id="sch-scope-title" className="cb-sch-confirm__title">{title}</h2>
        <p className="cb-sch-confirm__text">{text}</p>
        {saving ? (
          <p className="cb-sch-confirm__hint" role="status">Сохранение… Не закрывайте окно.</p>
        ) : null}
        <div className="cb-sch-confirm__actions cb-sch-confirm__actions--stack">
          {actions.map(({ scope, label, variant }) => (
            <button
              key={scope}
              type="button"
              className={`cb-btn cb-btn--${variant} cb-btn--sm`}
              disabled={saving}
              onClick={() => handleConfirm(scope)}
            >
              {saving && pickedScope === scope ? "Сохранение…" : label}
            </button>
          ))}
          <button
            type="button"
            className="cb-btn cb-btn--ghost cb-btn--sm"
            onClick={onClose}
            disabled={saving}
          >
            Отмена
          </button>
        </div>
      </div>
    </div>,
    document.body
  );
}
