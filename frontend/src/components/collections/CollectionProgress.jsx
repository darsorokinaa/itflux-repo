export default function CollectionProgress({ viewed = 0, total = 0 }) {
  if (!total) return null;
  const percent = Math.max(0, Math.min(100, Math.round((viewed / total) * 100)));
  return (
    <div className="lcol-progress">
      <p className="lcol-progress__label">{viewed} из {total} уроков просмотрено</p>
      <div
        className="lcol-progress__bar"
        role="progressbar"
        aria-valuenow={viewed}
        aria-valuemin={0}
        aria-valuemax={total}
        aria-label="Прогресс набора"
      >
        <span style={{ width: `${percent}%` }} />
      </div>
    </div>
  );
}
