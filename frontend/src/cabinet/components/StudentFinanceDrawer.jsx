import {
  formatLessonWhen,
  formatMoney,
  formatPaymentTerms,
  formatShortDate,
  formatUnits,
  resolvePaymentsRowState,
  statusModClass,
  transactionAmountMod,
  formatTransactionAmount,
} from "../billing/billingFormat";

function debtLabel(amount, currency) {
  const n = Number(amount) || 0;
  if (n <= 0) return null;
  return `−${formatMoney(n, currency).replace(/^-/, "")}`;
}

function canReverseTx(tx) {
  if (!tx?.id || tx.is_reversal || tx.is_reversed) return false;
  return [
    "payment", "package_purchase", "charge", "refund", "adjustment",
    "discount", "write_off", "package_consumption", "package_return",
  ].includes(tx.transaction_type);
}

/**
 * Финансовая карточка ученика: сводка, условия, абонементы, долги, история, действия.
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
  reversingId,
}) {
  if (!account) return null;

  const row = resolvePaymentsRowState(account);
  const summary = account.summary || {};
  const unpaid = account.unpaid_lessons || [];
  const transactions = account.recent_transactions || [];
  const packages = (account.packages || []).filter(
    (p) => !["cancelled"].includes(p.status),
  );
  const pkg = account.package;
  const needPackage = !pkg
    || Number(pkg.remaining_units || 0) <= 0
    || ["completed", "expired", "exhausted"].includes(pkg.display_status || pkg.status);
  const hasPackageBalance = (account.available_packages || []).length > 0
    || (packages.length > 0 && packages.some((p) => Number(p.remaining_units || 0) > 0));
  const canSettle = unpaid.length > 0 && hasPackageBalance;
  const debt = Number(account.debt_amount ?? summary.debt_amount ?? account.unpaid_lessons_amount ?? 0);
  const credit = Number(account.credit_amount ?? account.balance?.credit ?? 0);

  return (
    <div className="pay-history pay-overlay" role="dialog" aria-modal="true" aria-label="Финансы ученика">
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
              <h3>Сводка</h3>
              <div className={`pay-status ${statusModClass(account.status_mod || row.balanceMod)}`}>
                {account.headline || row.statusText}
              </div>
              <div className="pay-finance-summary" style={{ marginTop: 12 }}>
                <div className="pay-finance-tile">
                  <span>Баланс / долг</span>
                  <strong className={debt > 0 ? "pay-balance--debt" : credit > 0 ? "pay-balance--ok" : ""}>
                    {debt > 0
                      ? debtLabel(debt, currency)
                      : credit > 0
                        ? `+${formatMoney(credit, currency)}`
                        : "0 ₽"}
                  </strong>
                </div>
                <div className="pay-finance-tile">
                  <span>Неоплаченные уроки</span>
                  <strong>{summary.unpaid_completed_lessons ?? unpaid.length}</strong>
                </div>
                <div className="pay-finance-tile">
                  <span>Активный абонемент</span>
                  <strong>
                    {pkg
                      ? formatUnits(pkg.remaining_units, pkg.unit_type)
                      : "нет"}
                  </strong>
                </div>
                <div className="pay-finance-tile">
                  <span>Последняя оплата</span>
                  <strong>
                    {summary.last_payment_at
                      ? `${formatMoney(summary.last_payment_amount, currency)} · ${formatShortDate(summary.last_payment_at)}`
                      : "—"}
                  </strong>
                </div>
              </div>
            </section>

            <section className="pay-drawer-section">
              <div style={{ display: "flex", justifyContent: "space-between", gap: 8, alignItems: "center" }}>
                <h3 style={{ margin: 0 }}>Условия оплаты</h3>
                <button type="button" className="pay-btn pay-btn--ghost pay-btn--sm" onClick={() => onSetupTerms?.(account)}>
                  Изменить
                </button>
              </div>
              <ul className="pay-drawer-facts">
                <li>
                  <span>Схема</span>
                  <strong>{account.scheme_label || formatPaymentTerms(account)}</strong>
                </li>
                {account.default_lesson_price ? (
                  <li>
                    <span>Цена за урок</span>
                    <strong>{formatMoney(account.default_lesson_price, currency)}</strong>
                  </li>
                ) : null}
                <li>
                  <span>Правило списания</span>
                  <strong>
                    {["package_lessons", "package_minutes"].includes(account.billing_type)
                      ? "Сначала абонемент, иначе начисление"
                      : "Разовая оплата после/до урока"}
                  </strong>
                </li>
                <li>
                  <span>Покрытие прошлых уроков</span>
                  <strong>Можно вручную при создании абонемента</strong>
                </li>
              </ul>
            </section>

            <section className="pay-drawer-section">
              <div style={{ display: "flex", justifyContent: "space-between", gap: 8, alignItems: "center" }}>
                <h3 style={{ margin: 0 }}>Абонементы</h3>
                <button type="button" className="pay-btn pay-btn--ghost pay-btn--sm" onClick={() => onPackage?.(account.student_id)}>
                  Создать
                </button>
              </div>
              {packages.length === 0 ? (
                <p className="pay-hint">Абонементов пока нет</p>
              ) : (
                packages.map((item) => (
                  <div key={item.id} className="pay-pkg-card">
                    <div className="pay-pkg-card__head">
                      <strong>{item.title || "Абонемент"}</strong>
                      <span className={`pay-status ${statusModClass(
                        item.display_status === "ending" || item.display_status === "partially_paid" ? "warn"
                          : item.display_status === "awaiting_payment" ? "muted"
                            : item.display_status === "active" ? "ok" : "muted",
                      )}`}
                      >
                        {item.display_status_label || item.status_label}
                      </span>
                    </div>
                    <div className="pay-pkg-card__grid">
                      <span>Всего</span>
                      <b>{formatUnits(item.total_units, item.unit_type)}</b>
                      <span>Использовано</span>
                      <b>{formatUnits(item.used_units ?? (Number(item.total_units) - Number(item.remaining_units)), item.unit_type)}</b>
                      <span>Осталось</span>
                      <b>{formatUnits(item.remaining_units, item.unit_type)}</b>
                      <span>Сумма</span>
                      <b>{formatMoney(item.purchase_amount, currency)}</b>
                      <span>Оплачено</span>
                      <b>{formatMoney(item.paid_amount, currency)}</b>
                      {item.created_at || item.starts_at ? (
                        <>
                          <span>Дата</span>
                          <b>{formatShortDate(item.starts_at || item.created_at)}</b>
                        </>
                      ) : null}
                    </div>
                  </div>
                ))
              )}
              {hasPackageBalance ? (
                <button
                  type="button"
                  className="pay-btn pay-btn--secondary"
                  style={{ marginTop: 10 }}
                  onClick={() => onChargeFromPackage?.(account)}
                >
                  {canSettle ? "Списать из абонемента" : "Списать занятие из абонемента"}
                </button>
              ) : null}
            </section>

            <section className="pay-drawer-section">
              <div style={{ display: "flex", justifyContent: "space-between", gap: 8, alignItems: "center" }}>
                <h3 style={{ margin: 0 }}>Неоплаченные уроки</h3>
                {unpaid.length > 0 ? (
                  <button
                    type="button"
                    className="pay-btn pay-btn--ghost pay-btn--sm"
                    onClick={() => onPayment?.(account.student_id)}
                  >
                    Оплатить
                  </button>
                ) : null}
              </div>
              {unpaid.length === 0 ? (
                <p className="pay-hint">Неоплаченных уроков нет</p>
              ) : (
                <ul className="pay-unpaid-list">
                  {unpaid.map((lesson) => {
                    const due = Number(lesson.due_amount || 0);
                    return (
                      <li key={lesson.id}>
                        <div>
                          <strong>{formatLessonWhen(lesson.event_starts_at)}</strong>
                          <span>
                            {lesson.duration_minutes || lesson.actual_duration_minutes || lesson.planned_duration_minutes || 60}
                            {" мин"}
                            {lesson.event_title ? ` · ${lesson.event_title}` : ""}
                          </span>
                          {lesson.unpaid_reason ? (
                            <span className="pay-hint">{lesson.unpaid_reason}</span>
                          ) : null}
                          <span className="pay-hint">
                            Можно покрыть: разовая оплата
                            {canSettle ? " / абонемент" : ""}
                          </span>
                        </div>
                        <div className="pay-unpaid-list__right">
                          {lesson.price_missing ? (
                            <span className="pay-balance pay-balance--muted">Стоимость не задана</span>
                          ) : lesson.delivery_status === "rescheduled" && !lesson.is_debt ? (
                            <span className="pay-balance pay-balance--muted">Перенесено</span>
                          ) : (lesson.delivery_status === "cancelled_by_student" || lesson.delivery_status === "cancelled_by_teacher") && !lesson.is_debt ? (
                            <span className="pay-balance pay-balance--muted">Отменено</span>
                          ) : due > 0 ? (
                            <span className="pay-balance pay-balance--debt">{debtLabel(due, currency)}</span>
                          ) : lesson.is_free ? (
                            <span className="pay-balance pay-balance--muted">0 ₽</span>
                          ) : (
                            <span className="pay-balance pay-balance--muted">Стоимость не задана</span>
                          )}
                          <span className={`pay-pill ${due > 0 ? "pay-pill--debt" : "pay-pill--muted"}`}>
                            {lesson.financial_status === "partially_paid"
                              ? "Частично"
                              : lesson.price_missing
                                ? "Стоимость не задана"
                                : due > 0
                                  ? "К оплате"
                                  : (lesson.financial_status_label || "Оформлено")}
                          </span>
                          {canSettle ? (
                            <button
                              type="button"
                              className="pay-btn pay-btn--ghost pay-btn--sm"
                              onClick={() => onChargeFromPackage?.(account, [String(lesson.id)])}
                            >
                              Списать
                            </button>
                          ) : null}
                        </div>
                      </li>
                    );
                  })}
                </ul>
              )}
            </section>

            <section className="pay-drawer-section">
              <h3>История операций</h3>
              {transactions.length === 0 ? (
                <p className="pay-hint">Операций пока нет</p>
              ) : (
                <ul className="pay-tx-list">
                  {transactions.map((tx) => {
                    const reversed = Boolean(tx.is_reversed);
                    const mod = transactionAmountMod(tx);
                    return (
                      <li key={tx.id} className={`pay-tx-item${reversed ? " pay-tx-item--reversed" : ""}`}>
                        <div>
                          <p className="pay-tx-item__name">
                            {tx.transaction_type_label || tx.transaction_type}
                            {reversed ? " · отменена" : ""}
                            {tx.is_legacy ? " · архив" : ""}
                          </p>
                          <p className="pay-tx-item__when">
                            {formatShortDate(tx.occurred_at)}
                            {tx.event_starts_at ? ` · урок ${formatLessonWhen(tx.event_starts_at)}` : ""}
                            {tx.comment ? ` · ${tx.comment}` : ""}
                            {tx.created_by_name ? ` · ${tx.created_by_name}` : ""}
                          </p>
                        </div>
                        <div className="pay-tx-item__actions">
                          <strong className={`pay-balance pay-balance--${mod}`}>
                            {formatTransactionAmount(tx, currency)}
                          </strong>
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
              <button type="button" className="pay-btn pay-btn--primary" onClick={() => onPayment?.(account.student_id)}>
                Добавить оплату
              </button>
              {needPackage ? (
                <button type="button" className="pay-btn" onClick={() => onPackage?.(account.student_id)}>
                  Создать абонемент
                </button>
              ) : null}
              {canSettle ? (
                <button type="button" className="pay-btn" onClick={() => onChargeFromPackage?.(account)}>
                  Списать занятие
                </button>
              ) : null}
              <button type="button" className="pay-btn pay-btn--ghost" onClick={() => onAdjust?.(account)}>
                Корректировка
              </button>
              <button type="button" className="pay-btn pay-btn--ghost" onClick={() => onRefund?.(account)}>
                Возврат
              </button>
              <button type="button" className="pay-btn pay-btn--ghost" onClick={() => onSetupTerms?.(account)}>
                Настроить условия
              </button>
            </div>
          </div>
        ) : null}
      </div>
    </div>
  );
}
