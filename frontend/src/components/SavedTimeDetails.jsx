/**
 * r70: разбивка «сэкономленного времени» и сноска — одинаково в кабинете и на /pricing.
 * Данные (parts, footnote) приходят с сервера из Cabinet.time_savings, текст сноски не дублируем на фронте.
 */
import "./saved-time.css";

export default function SavedTimeDetails({ parts, footnote, summary = "Как посчитали" }) {
  const rows = Array.isArray(parts) ? parts : [];
  if (!rows.length && !footnote) return null;
  return (
    <details className="saved-time">
      <summary className="saved-time__summary">{summary}</summary>
      {rows.length ? (
        <ul className="saved-time__parts">
          {rows.map((part) => (
            <li key={part.key || part.label}>
              <span className="saved-time__label">{part.label}</span>
              <span className="saved-time__formula">{part.formula}</span>
              <b className="saved-time__value">{part.value}</b>
            </li>
          ))}
        </ul>
      ) : null}
      {footnote ? <p className="saved-time__footnote">{footnote}</p> : null}
    </details>
  );
}
