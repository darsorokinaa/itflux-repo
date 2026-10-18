// r74: недельный график «Оплаты» — даты в часовом поясе учителя (как на сервере),
// а не браузера; «начислено» включает стоимость занятий из абонементов.

export function zonedDateParts(value, timeZone) {
  const dt = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(dt.getTime())) return null;
  if (!timeZone) {
    return { year: dt.getFullYear(), month: dt.getMonth(), day: dt.getDate() };
  }
  try {
    const parts = new Intl.DateTimeFormat("en-CA", {
      timeZone,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    }).formatToParts(dt);
    const get = (type) => Number(parts.find((p) => p.type === type)?.value);
    return { year: get("year"), month: get("month") - 1, day: get("day") };
  } catch {
    return { year: dt.getFullYear(), month: dt.getMonth(), day: dt.getDate() };
  }
}

export function buildWeekSeries(txs, cursor, timeZone) {
  const year = cursor.getFullYear();
  const month = cursor.getMonth();
  const last = new Date(year, month + 1, 0).getDate();
  const labels = ["1–7", "8–14", "15–21", `22–${last}`];
  const buckets = labels.map((label) => ({ label, received: 0, charged: 0 }));
  (txs || []).forEach((tx) => {
    if (!tx?.occurred_at || tx.is_reversal || tx.is_reversed) return;
    const parts = zonedDateParts(tx.occurred_at, timeZone);
    if (!parts) return;
    if (parts.year !== year || parts.month !== month) return;
    const day = parts.day;
    const idx = day <= 7 ? 0 : day <= 14 ? 1 : day <= 21 ? 2 : 3;
    const amount = Math.abs(Number(tx.amount) || 0);
    if (tx.transaction_type === "payment" || tx.transaction_type === "package_purchase") {
      buckets[idx].received += amount;
    } else if (tx.transaction_type === "charge" || tx.transaction_type === "package_consumption") {
      buckets[idx].charged += amount;
    } else if (tx.transaction_type === "package_return") {
      buckets[idx].charged -= amount;
    }
  });
  return buckets;
}
