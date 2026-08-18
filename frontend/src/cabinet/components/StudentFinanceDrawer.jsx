import { useState } from "react";
import {
  formatLessonWhen,
  formatMoney,
  formatPaymentTerms,
  formatShortDate,
  formatUnits,
  formatTransactionAmount,
  transactionAmountMod,
} from "../billing/billingFormat";

function canReverseTx(tx) {
  if (!tx?.id || tx.is_reversal || tx.is_reversed) return false;
  return [
    "payment", "package_purchase", "charge", "refund", "adjustment",
    "discount", "write_off", "package_consumption", "package_return",
  ].includes(tx.transaction_type);
}

function paymentTone(lesson) {
  const code = lesson.payment_status || lesson.financial_status;
  if (code === "paid" || lesson.financial_status === "paid" || lesson.financial_status === "paid_from_package") {
    return "ok";
  }
  if (code === "partially_paid" || lesson.financial_status === "partially_paid") return "warn";
  if (code === "awaiting_payment" || lesson.is_debt) return "debt";
  return "muted";
}

/**
 * Карточка ученика: сводка, хронология занятий, история операций.
 */
export default function StudentFinanceDrawer({
  account,
  loading,
  currency = "RUB",
  onClose,
  onPayment,
  onPackage,
  onChargeFromPackage,
  onSetupTerms,
  onAdjust,
  onRefund,
  onReverseTx,
  onUpdateCharge,
  onUpdatePayment,
  onRebuild,
  reversingId,
}) {
  const [editLessonId, setEditLessonId] = useState(null);
  const [editAmount, setEditAmount] = useState("");
  const [editPaymentId, setEditPaymentId] = useState(null);
  const [editPaymentAmount, setEditPaymentAmount] = useState("");
  const [savingId, setSavingId] = useState("");

  if (!account) return null;

  const unpaid = account.unpaid_lessons || [];
  const lessons = account.lessons?.length ? account.lessons : unpaid;
  const transactions = account.recent_transactions || [];
  const packages = (account.packages || []).filter((p) => p.status !== "cancelled");
  const pkg = account.package;
  const charged = Number(account.charged_total ?? account.lesson_stats?.charged_amount ?? 0);
  const paid = Number(account.paid_total ?? account.lesson_stats?.paid_amount ?? 0);
  const debt = Number(account.debt_amount ?? account.unpaid_lessons_amount ?? 0);
  const credit = Number(account.credit_amount ?? account.balance?.credit ?? 0);

  return (
    <div className="pay-history pay-overlay" role="dialog" aria-modal="true" aria-label="Оплаты ученика">
      <button type="button" className="pay-overlay__backdrop" aria-label="Закрыть" onClick={onClose} />
      <div className="pay-overlay__panel pay-overlay__panel--drawer">
        <header className="pay-overlay__head">
          <div>
            <h2>{account.student_name}</h2>
            <p className="pay-hint">{account.scheme_label || formatPaymentTerms(account)}</p>
          </div>
          <button type="button" className="pay-btn pay-btn--icon" onClick={onClose}>×</button>
        </header>

        {loading ? <div className="pay-empty">Загрузка…</div> : null}

        {!loading ? (
          <div className="pay-drawer-body">
            <section className="pay-drawer-section">
              <div className="pay-finance-summary">
                <div className="pay-finance-tile">
                  <span>Начислено</span>
                  <strong>{formatMoney(charged, currency)}</strong>
                </div>
                <div className="pay-finance-tile">
                  <span>Оплачено</span>
                  <strong className="pay-balance--ok">{formatMoney(paid, currency)}</strong>
                </div>
                <div className="pay-finance-tile">
                  <span>{debt > 0 ? "К оплате" : credit > 0 ? "Аванс" : "К оплате"}</span>
                  <strong className={debt > 0 ? "pay-balance--debt" : credit > 0 ? "pay-balance--ok" : ""}>
                    {debt > 0
                      ? formatMoney(debt, currency)
                      : credit > 0
                        ? formatMoney(credit, currency)
                        : "0 ₽"}
                  </strong>
                </div>
              </div>
              <div className="pay-drawer-actions pay-drawer-actions--compact">
                <button type="button" className="pay-btn pay-btn--primary" onClick={() => onPayment?.(account.student_id)}>
                  Добавить оплату
                </button>
                <button type="button" className="pay-btn" onClick={() => onSetupTerms?.(account)}>
                  Настройки
                </button>
              </div>
            </section>

            <section className="pay-drawer-section">
              <h3>Занятия</h3>
              {lessons.length === 0 ? (
                <p className="pay-hint">Пока нет занятий в истории оплат</p>
              ) : (
                <ul className="pay-timeline">
                  {lessons.map((lesson) => {
                    const due = Number(lesson.due_amount || 0);
                    const chargedAmt = Number(lesson.charged_amount || 0);
                    const tone = paymentTone(lesson);
                    const canEditCharge = Boolean(
                      onUpdateCharge
                      && lesson.id
                      && ["awaiting_payment", "partially_paid", "price_not_set"].includes(lesson.payment_status)
                    );
                    const editing = editLessonId === lesson.id;
                    return (
                      <li key={lesson.id || lesson.event_id} className="pay-timeline__item">
                        <div>
                          <p className="pay-timeline__date">{formatLessonWhen(lesson.event_starts_at)}</p>
                          <p className="pay-timeline__title">{lesson.event_title || "Занятие"}</p>
                          <p className="pay-timeline__status">
                            <span className="pay-pill pay-pill--muted">
                              {lesson.delivery_status_label || lesson.delivery_status || "Занятие"}
                            </span>
                            <span className={`pay-pill pay-pill--${tone}`}>
                              {lesson.payment_status_label || lesson.financial_status_label || "—"}
                            </span>
                          </p>
                          {editing ? (
                            <form
                              className="pay-inline-edit"
                              onSubmit={async (e) => {
                                e.preventDefault();
                                setSavingId(lesson.id);
                                try {
                                  await onUpdateCharge?.(lesson, editAmount);
                                  setEditLessonId(null);
                                } finally {
                                  setSavingId("");
                                }
                              }}
                            >
                              <input
                                className="pay-input"
                                type="number"
                                min="0"
                                step="1"
                                value={editAmount}
                                onChange={(ev) => setEditAmount(ev.target.value)}
                                aria-label="Сумма начисления"
                              />
                              <button type="submit" className="pay-btn pay-btn--sm pay-btn--primary" disabled={savingId === lesson.id}>
                                {savingId === lesson.id ? "…" : "Сохранить"}
                              </button>
                              <button type="button" className="pay-btn pay-btn--sm" onClick={() => setEditLessonId(null)}>
                                Отмена
                              </button>
                            </form>
                          ) : null}
                        </div>
                        <div className="pay-timeline__amount">
                          <strong className={`pay-balance pay-balance--${tone === "debt" ? "debt" : tone === "ok" ? "ok" : "muted"}`}>
                            {formatMoney(chargedAmt, currency)}
                          </strong>
                          {due > 0 && due !== chargedAmt ? (
                            <span className="pay-hint">осталось {formatMoney(due, currency)}</span>
                          ) : null}
                          {canEditCharge && !editing ? (
                            <button
                              type="button"
                              className="pay-btn pay-btn--ghost pay-btn--sm"
                              onClick={() => {
                                setEditLessonId(lesson.id);
                                setEditAmount(String(chargedAmt || ""));
                              }}
                            >
                              Изменить сумму
                            </button>
                          ) : null}
                        </div>
                      </li>
                    );
                  })}
                </ul>
              )}
            </section>

            {packages.length > 0 ? (
              <section className="pay-drawer-section">
                <div style={{ display: "flex", justifyContent: "space-between", gap: 8, alignItems: "center" }}>
                  <h3 style={{ margin: 0 }}>Абонементы</h3>
                  <button type="button" className="pay-btn pay-btn--ghost pay-btn--sm" onClick={() => onPackage?.(account.student_id)}>
                    Создать
                  </button>
                </div>
                {packages.map((item) => (
                  <div key={item.id} className="pay-pkg-card">
                    <div className="pay-pkg-card__head">
                      <strong>{item.title || "Абонемент"}</strong>
                      <span className="pay-hint">{item.display_status_label || item.status_label}</span>
                    </div>
                    <p className="pay-hint">
                      Осталось {formatUnits(item.remaining_units, item.unit_type)}
                      {item.purchase_amount ? ` · ${formatMoney(item.purchase_amount, currency)}` : ""}
                    </p>
                  </div>
                ))}
                {pkg ? (
                  <button
                    type="button"
                    className="pay-btn pay-btn--secondary"
                    style={{ marginTop: 10 }}
                    onClick={() => onChargeFromPackage?.(account)}
                  >
                    Списать из абонемента
                  </button>
                ) : null}
              </section>
            ) : null}

            <section className="pay-drawer-section">
              <h3>История операций</h3>
              {transactions.length === 0 ? (
                <p className="pay-hint">Операций пока нет</p>
              ) : (
                <ul className="pay-tx-list">
                  {transactions.map((tx) => {
                    const reversed = Boolean(tx.is_reversed);
                    const mod = transactionAmountMod(tx);
                    const canEditPayment = Boolean(
                      onUpdatePayment
                      && tx.student_payment_id
                      && tx.transaction_type === "payment"
                      && !tx.is_reversal
                      && !reversed
                    );
                    const editingPay = editPaymentId === tx.id;
                    return (
                      <li key={tx.id} className={`pay-tx-item${reversed ? " pay-tx-item--reversed" : ""}`}>
                        <div>
                          <p className="pay-tx-item__name">
                            {tx.transaction_type_label || tx.transaction_type}
                            {reversed ? " · отменена" : ""}
                          </p>
                          <p className="pay-tx-item__when">
                            {formatShortDate(tx.occurred_at)}
                            {tx.event_starts_at ? ` · ${formatLessonWhen(tx.event_starts_at)}` : ""}
                            {tx.comment ? ` · ${tx.comment}` : ""}
                          </p>
                          {editingPay ? (
                            <form
                              className="pay-inline-edit"
                              onSubmit={async (e) => {
                                e.preventDefault();
                                setSavingId(tx.id);
                                try {
                                  await onUpdatePayment?.(tx, editPaymentAmount);
                                  setEditPaymentId(null);
                                } finally {
                                  setSavingId("");
                                }
                              }}
                            >
                              <input
                                className="pay-input"
                                type="number"
                                min="0"
                                step="1"
                                value={editPaymentAmount}
                                onChange={(ev) => setEditPaymentAmount(ev.target.value)}
                                aria-label="Сумма платежа"
                              />
                              <button type="submit" className="pay-btn pay-btn--sm pay-btn--primary" disabled={savingId === tx.id}>
                                {savingId === tx.id ? "…" : "Сохранить"}
                              </button>
                              <button type="button" className="pay-btn pay-btn--sm" onClick={() => setEditPaymentId(null)}>
                                Отмена
                              </button>
                            </form>
                          ) : null}
                        </div>
                        <div className="pay-tx-item__actions">
                          <strong className={`pay-balance pay-balance--${mod}`}>
                            {formatTransactionAmount(tx, currency)}
                          </strong>
                          {canEditPayment && !editingPay ? (
                            <button
                              type="button"
                              className="pay-btn pay-btn--ghost pay-btn--sm"
                              onClick={() => {
                                setEditPaymentId(tx.id);
                                setEditPaymentAmount(String(Math.abs(Number(tx.amount || 0))));
                              }}
                            >
                              Изменить
                            </button>
                          ) : null}
                          {canReverseTx(tx) ? (
                            <button
                              type="button"
                              className="pay-btn pay-btn--ghost pay-btn--danger-text pay-btn--sm"
                              disabled={reversingId === tx.id}
                              onClick={() => onReverseTx?.(tx)}
                            >
                              {reversingId === tx.id ? "…" : "Отменить"}
                            </button>
                          ) : null}
                        </div>
                      </li>
                    );
                  })}
                </ul>
              )}
            </section>

            <div className="pay-drawer-actions">
              <button type="button" className="pay-btn pay-btn--ghost" onClick={() => onAdjust?.(account)}>
                Корректировка
              </button>
              <button type="button" className="pay-btn pay-btn--ghost" onClick={() => onRefund?.(account)}>
                Возврат
              </button>
              {onRebuild ? (
                <button type="button" className="pay-btn pay-btn--ghost" onClick={() => onRebuild(account)}>
                  Пересчитать оплаты
                </button>
              ) : null}
            </div>
          </div>
        ) : null}
      </div>
    </div>
  );
}
