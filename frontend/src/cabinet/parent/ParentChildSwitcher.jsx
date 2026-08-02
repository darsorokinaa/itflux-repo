export default function ParentChildSwitcher({ kids, activeId, onChange }) {
  if (!kids?.length) return null;
  if (kids.length === 1) {
    return (
      <div className="st-page-header">
        <div>
          <h2 className="st-page-header__title" style={{ fontSize: "1.15rem" }}>{kids[0].name}</h2>
          <p className="st-page-header__sub">Ваш ребёнок</p>
        </div>
      </div>
    );
  }
  return (
    <div className="st-filters" role="tablist" aria-label="Выбор ребёнка">
      {kids.map((child) => (
        <button
          key={child.student_id}
          type="button"
          role="tab"
          aria-selected={child.student_id === activeId}
          className={`st-filter-pill${child.student_id === activeId ? " st-filter-pill--active" : ""}`}
          onClick={() => onChange(child.student_id)}
        >
          {child.name}
        </button>
      ))}
    </div>
  );
}
