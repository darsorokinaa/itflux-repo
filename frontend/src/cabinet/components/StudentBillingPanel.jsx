import { useEffect, useState } from "react";
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
  formatTxWhen,
} from "../billing/billingFormat";
import "../styles/payments.css";

export default function StudentBillingPanel({ studentId, onAddPayment, onNewPackage, onEditTerms }) {
  const [account, setAccount] = useState(null);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);

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
  }, [studentId]);

  if (!studentId) return null;
  if (loading) return <p className="pay-hint">Загрузка оплат…</p>;
  if (error) return <p className="pay-error">{error}</p>;
  if (!account) return null;

  const state = resolveAccountState(account);
  const pkg = account.package;
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
        <div>
          <dt>Плательщик</dt>
          <dd>{account.payer_name || "не указан"}</dd>
        </div>
      </dl>

      {recent.length ? (
        <div className="pay-student-block__ops">
          <p className="pay-student-block__ops-title">Последние операции</p>
          <ul className="pay-student-block__ops-list">
            {recent.map((tx) => {
              const amount = Number(tx.amount || 0);
              const showAmount = amount !== 0 || tx.transaction_type === "payment";
              return (
                <li key={tx.id}>
                  <div className="pay-student-block__op-main">
                    <span className="pay-student-block__op-when">{formatTxWhen(tx.occurred_at)}</span>
                    <span className="pay-student-block__op-desc">{describeTransaction(tx)}</span>
                  </div>
                  {showAmount ? (
                    <strong className="pay-student-block__op-amount">
                      {formatMoney(tx.amount, tx.currency)}
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
        <Link className="pay-btn" to="/cabinet/payments">Все оплаты</Link>
      </div>
    </div>
  );
}
