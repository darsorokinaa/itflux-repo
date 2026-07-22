import { useCallback, useEffect, useState } from "react";
import { Link } from "react-router-dom";
import {
  fetchStudentBillingAccount,
} from "../../utils/cabinetAuth";
import {
  formatMoney,
  formatPaymentTerms,
  formatUnits,
  resolveAccountState,
  describeTransaction,
  formatTransactionAmount,
  formatTxWhen,
  formatLessonWhen,
} from "../billing/billingFormat";
import "../styles/payments.css";

function debtLabel(amount, currency) {
  const n = Number(amount) || 0;
  if (n <= 0) return null;
  return `−${formatMoney(n, currency).replace(/^-/, "")}`;
}

export default function StudentBillingPanel({
  studentId,
  refreshKey = 0,
  onAddPayment,
  onNewPackage,
  onEditTerms,
}) {
  const [account, setAccount] = useState(null);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);
  const [reloadToken, setReloadToken] = useState(0);

  const reload = useCallback(() => {
    setReloadToken((n) => n + 1);
  }, []);

  useEffect(() => {
    if (!studentId) return undefined;
    let cancelled = false;
    setLoading(true);
    fetchStudentBillingAccount(studentId)
      .then((data) => {
        if (!cancelled) setAccount(data);
      })
      .catch((err) => {
        if (!cancelled) setError(err.message || "Не удалось загрузить оплаты");
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => { cancelled = true; };
  }, [studentId, refreshKey, reloadToken]);

  useEffect(() => {
    const onBilling = (event) => {
      const sid = event?.detail?.studentId;
      if (sid == null || String(sid) === String(studentId)) reload();
    };
    window.addEventListener("cabinet:billing-changed", onBilling);
    return () => window.removeEventListener("cabinet:billing-changed", onBilling);
  }, [studentId, reload]);

  if (!studentId) return null;
  if (loading) return <p className="pay-hint">Загрузка оплат…</p>;
  if (error) return <p className="pay-error">{error}</p>;
  if (!account) return null;

  const state = resolveAccountState(account);
  const pkg = account.package;
  const unpaid = account.unpaid_lessons || [];
  const unpaidAmount = Number(account.unpaid_lessons_amount || 0);
  const currency = account.currency || "RUB";
  const recent = (account.recent_transactions || []).slice(0, 4);

  return (
    <div className="pay-student-block">
      <div className="pay-student-block__head">
        <h4>Оплата занятий</h4>
        <div className={`pay-state pay-state--${state.mod}`}>
          <span>{state.headline}</span>
          {state.detail ? <small>{state.detail}</small> : null}
        </div>
      </div>

      <dl className="pay-student-block__meta">
        <div>
          <dt>Условия</dt>
          <dd>{formatPaymentTerms(account)}</dd>
        </div>
        {pkg ? (
          <div>
            <dt>Остаток</dt>
            <dd>
              {formatUnits(pkg.remaining_units, pkg.unit_type)}
              {pkg.expires_at ? (
                <span className="pay-student-block__meta-sub">
                  до {pkg.expires_at.slice(0, 10)}
                </span>
              ) : null}
            </dd>
          </div>
        ) : null}
        {unpaidAmount > 0 || unpaid.length > 0 ? (
          <div>
            <dt>Неоплачено</dt>
            <dd>
              {debtLabel(unpaidAmount, currency) || "Стоимость не указана"}
              {unpaid.length ? (
                <span className="pay-student-block__meta-sub">
                  {unpaid.length === 1 ? "1 урок" : `${unpaid.length} ур.`}
                </span>
              ) : null}
            </dd>
          </div>
        ) : null}
        <div>
          <dt>Плательщик</dt>
          <dd>{account.payer_name || "не указан"}</dd>
        </div>
      </dl>

      {unpaid.length ? (
        <div className="pay-student-block__ops">
          <p className="pay-student-block__ops-title">Неоплаченные уроки</p>
          <ul className="pay-student-block__ops-list">
            {unpaid.slice(0, 3).map((lesson) => {
              const due = Number(lesson.due_amount || 0);
              return (
                <li key={lesson.id}>
                  <div className="pay-student-block__op-main">
                    <span className="pay-student-block__op-when">
                      {formatLessonWhen(lesson.event_starts_at)}
                    </span>
                    <span className="pay-student-block__op-desc">Не оплачен</span>
                  </div>
                  <strong className="pay-student-block__op-amount">
                    {due > 0 ? debtLabel(due, currency) : "—"}
                  </strong>
                </li>
              );
            })}
          </ul>
        </div>
      ) : null}

      {recent.length ? (
        <div className="pay-student-block__ops">
          <p className="pay-student-block__ops-title">Последние операции</p>
          <ul className="pay-student-block__ops-list">
            {recent.map((tx) => {
              const amountLabel = formatTransactionAmount(tx, currency);
              const showAmount = amountLabel && amountLabel !== "—";
              return (
                <li key={tx.id}>
                  <div className="pay-student-block__op-main">
                    <span className="pay-student-block__op-when">{formatTxWhen(tx.occurred_at)}</span>
                    <span className="pay-student-block__op-desc">{describeTransaction(tx)}</span>
                  </div>
                  {showAmount ? (
                    <strong className="pay-student-block__op-amount">
                      {amountLabel}
                    </strong>
                  ) : null}
                </li>
              );
            })}
          </ul>
        </div>
      ) : null}

      <div className="pay-student-block__actions">
        <button
          type="button"
          className="pay-btn pay-btn--primary"
          onClick={() => {
            if (state.primaryAction === "setup" && onEditTerms) onEditTerms(studentId);
            else if (state.primaryAction === "package") onNewPackage?.(studentId);
            else onAddPayment?.(studentId);
          }}
        >
          {state.primaryLabel === "Открыть" ? "Добавить оплату" : state.primaryLabel}
        </button>
        <Link className="pay-btn" to={`/cabinet/payments?student=${studentId}`}>
          Все оплаты
        </Link>
      </div>
    </div>
  );
}
