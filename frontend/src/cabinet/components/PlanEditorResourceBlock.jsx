import CabinetIcon from "../CabinetIcons";

function rowIcon(kind) {
  if (kind === "interactive") return "interactives";
  if (kind === "variant") return "tasks";
  if (kind === "file") return "note";
  if (kind === "library_lesson") return "lessons";
  return "note";
}

export default function PlanEditorResourceBlock({
  label,
  emptyLabel,
  actionLabel,
  rows = [],
  notes,
  notesPlaceholder,
  onNotesChange,
  onAttach,
  onRemove,
  showNotes = false,
  alwaysShowNotes = false,
}) {
  const hasAttachments = rows.length > 0;

  return (
    <div className="cb-pe-resource">
      <div className="cb-pe-resource__head">
        <span className="cb-pe-resource__label">{label}</span>
        <button type="button" className="cb-pe-resource__action" onClick={onAttach}>
          {actionLabel}
        </button>
      </div>

      {!hasAttachments ? (
        <div className="cb-pe-resource__empty">
          <span>{emptyLabel}</span>
        </div>
      ) : null}

      {hasAttachments ? (
        <ul className="cb-pe-resource__list">
          {rows.map((row) => (
            <li key={row.key} className="cb-pe-resource__item">
              <span className="cb-pe-resource__item-icon" aria-hidden="true">
                <CabinetIcon name={rowIcon(row.kind)} />
              </span>
              <div className="cb-pe-resource__item-body">
                <span className="cb-pe-resource__item-title">{row.label}</span>
                {row.typeLabel ? (
                  <span className="cb-pe-resource__item-meta">{row.typeLabel}</span>
                ) : null}
              </div>
              <div className="cb-pe-resource__item-actions">
                {row.url ? (
                  <a
                    href={row.url}
                    className="cb-pe-resource__item-link"
                    target="_blank"
                    rel="noopener noreferrer"
                    onClick={(e) => e.stopPropagation()}
                  >
                    Открыть
                  </a>
                ) : null}
                <button
                  type="button"
                  className="cb-pe-resource__item-remove"
                  onClick={() => onRemove?.(row)}
                  aria-label={`Убрать ${row.label}`}
                >
                  ×
                </button>
              </div>
            </li>
          ))}
        </ul>
      ) : null}

      {showNotes || alwaysShowNotes ? (
        <textarea
          className="cb-pe-resource__input"
          rows={2}
          value={notes || ""}
          onChange={onNotesChange}
          placeholder={notesPlaceholder}
        />
      ) : null}
    </div>
  );
}
