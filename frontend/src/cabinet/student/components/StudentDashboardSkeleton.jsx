export function StudentSkeletonBlock({ lines = 3, className = "" }) {
  return (
    <div className={`st-skeleton ${className}`.trim()} aria-hidden="true">
      {Array.from({ length: lines }).map((_, i) => (
        <div key={i} className={`st-skeleton__line${i === 0 ? " st-skeleton__line--lg" : ""}`} />
      ))}
    </div>
  );
}

export default function StudentDashboardSkeleton() {
  return (
    <div className="st-dashboard st-dashboard--loading" aria-busy="true" aria-label="Загрузка кабинета">
      <div className="st-dash-welcome">
        <StudentSkeletonBlock lines={2} />
      </div>
      <div className="st-dash-grid">
        <section className="st-home-block st-dash-grid__next">
          <StudentSkeletonBlock lines={5} className="st-skeleton--card" />
        </section>
        <section className="st-home-block st-dash-grid__todo">
          <StudentSkeletonBlock lines={4} className="st-skeleton--card" />
        </section>
        <section className="st-home-block st-dash-grid__progress">
          <StudentSkeletonBlock lines={3} className="st-skeleton--card" />
        </section>
        <section className="st-home-block st-dash-grid__materials">
          <StudentSkeletonBlock lines={3} className="st-skeleton--card" />
        </section>
      </div>
    </div>
  );
}
