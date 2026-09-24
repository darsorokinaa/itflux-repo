export default function CollectionSection({ title, children }) {
  return (
    <section className="lcol-section">
      {title ? (
        <h2 className="lcol-section__title">
          <span>{title}</span>
        </h2>
      ) : null}
      <div className="lcol-lessons">{children}</div>
    </section>
  );
}
