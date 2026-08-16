/**
 * Блок «Использование тарифа» — данные только с backend (usage_items).
 * Компактная одна строка метрик на главной и на странице тарифов.
 */

const NEAR_LIMIT_PERCENT = 80;

function formatUsed(item) {
  const used = item.used ?? 0;
  if (item.unlimited) {
    return `${used} / ∞`;
  }
  const limit = item.limit ?? 0;
  const unit = item.unit === "MB" ? " МБ" : "";
  return `${used} / ${limit}${unit}`;
}

function exhaustedCaption(item) {
  if (item.period === "month") {
    return "Лимит на текущий период исчерпан";
  }
  return "Лимит исчерпан";
}

export default function TariffUsageBlock({ items, loading, onViewPlans }) {
  if (loading) {
    return (
      <section className="upg-usage" aria-busy="true">
        <h2 className="upg-usage__title">Использование тарифа</h2>
        <p className="upg-usage__loading">Загрузка…</p>
      </section>
    );
  }

  if (!items?.length) return null;

  const exhaustedItems = items.filter((item) => item.exhausted && !item.unlimited);

  return (
    <section className="upg-usage" aria-labelledby="upg-usage-title">
      <h2 id="upg-usage-title" className="upg-usage__title">
        Использование тарифа
      </h2>
      <ul className="upg-usage__list">
        {items.map((item) => {
          const unlimited = Boolean(item.unlimited);
          const percent = item.percent ?? 0;
          const exhausted = Boolean(item.exhausted);
          const near =
            Boolean(item.near_limit) ||
            (!unlimited && !exhausted && percent >= NEAR_LIMIT_PERCENT);
          const rowClass = [
            "upg-usage__row",
            near ? "upg-usage__row--near" : "",
            exhausted ? "upg-usage__row--full" : "",
          ]
            .filter(Boolean)
            .join(" ");

          return (
            <li key={item.key} className={rowClass}>
              <span className="upg-usage__label">{item.label}</span>
              <span className="upg-usage__frac">{formatUsed(item)}</span>
              {unlimited ? (
                <span className="upg-usage__unlimited">без лимита</span>
              ) : (
                <div className="upg-usage__track">
                  <div
                    className="upg-usage__bar"
                    role="progressbar"
                    aria-valuemin={0}
                    aria-valuemax={100}
                    aria-valuenow={percent}
                    aria-label={`${item.label}: ${percent}%`}
                  >
                    <span
                      className="upg-usage__bar-fill"
                      style={{ width: `${Math.min(100, Math.max(0, percent))}%` }}
                    />
                  </div>
                  <span className="upg-usage__pct">{percent}%</span>
                </div>
              )}
            </li>
          );
        })}
      </ul>
      {exhaustedItems.length ? (
        <div className="upg-usage__cap">
          <p>{exhaustedCaption(exhaustedItems[0])}</p>
          {onViewPlans ? (
            <button type="button" className="upg-link-btn" onClick={onViewPlans}>
              Посмотреть тарифы
            </button>
          ) : null}
        </div>
      ) : null}
    </section>
  );
}

export { formatUsed, exhaustedCaption, NEAR_LIMIT_PERCENT };
