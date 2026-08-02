import { useCallback, useEffect, useState } from "react";
import { Link } from "react-router-dom";
import {
  fetchStudentBillingAccount,
} from "../../utils/cabinetAuth";
import ChargeFromPackageModal from "./ChargeFromPackageModal";
import PayerEditModal from "./PayerEditModal";
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
  const [chargeOpen, setChargeOpen] = useState(false);
  const [payerOpen, setPayerOpen] = useState(false);
  const [toast, setToast] = useState("");

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

  useEffect(() => {
    if (!toast) return undefined;
    const t = setTimeout(() => setToast(""), 2800);
    return () => clearTimeout(t);
  }, [toast]);

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
  const canSettle = unpaid.length > 0 && (account.available_packages || []).length > 0;

  return (
    <div className="pay-student-block">
      {toast ? <div className="pay-toast" role="status">{toast}</div> : null}
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
          <dd className="pay-student-block__payer">
            <span>{account.payer_name || "не указан"}</span>
            <button
              type="button"
              className="pay-student-block__payer-btn"
              onClick={() => setPayerOpen(true)}
            >
              {account.payer_name ? "Изменить" : "Указать"}
            </button>
          </dd>
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
                    <span className="pay-student-block__op-desc">
                      {lesson.unpaid_reason || "Ожидает оплаты"}
                    </span>
                  </div>
                  <strong className="pay-student-block__op-amount">
                    {due > 0 ? debtLabel(due, currency) : "—"}
                  </strong>
                </li>
              );
            })}
          </ul>
          {canSettle ? (
            <button
              type="button"
              className="pay-btn pay-btn--secondary"
              style={{ marginTop: 8 }}
              onClick={() => setChargeOpen(true)}
            >
              Списать из абонемента
            </button>
          ) : null}
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
            if (state.primaryAction === "setup") {
              onEditTerms?.(studentId);
              return;
            }
            if (state.primaryAction === "package") {
              onNewPackage?.(studentId);
              return;
            }
            if (state.primaryAction === "payment" || state.primaryAction === "finalize") {
              onAddPayment?.(studentId);
              return;
            }
            onAddPayment?.(studentId);
          }}
        >
          {state.primaryAction === "setup"
            ? "Настроить оплату"
            : (state.primaryLabel === "Открыть" ? "Добавить оплату" : state.primaryLabel)}
        </button>
        {onEditTerms && state.primaryAction !== "setup" ? (
          <button
            type="button"
            className="pay-btn"
            onClick={() => onEditTerms(studentId)}
          >
            Условия
          </button>
        ) : null}
        <Link className="pay-btn pay-btn--ghost" to={`/cabinet/payments?student=${studentId}`}>
          Все оплаты
        </Link>
      </div>

      <ChargeFromPackageModal
        open={chargeOpen}
        account={account}
        onClose={() => setChargeOpen(false)}
        onDone={(result) => {
          setToast(result?.message || "Уроки списаны");
          setChargeOpen(false);
          reload();
        }}
      />

      <PayerEditModal
        open={payerOpen}
        account={account}
        onClose={() => setPayerOpen(false)}
        onDone={() => {
          setToast("Плательщик сохранён");
          reload();
        }}
      />
    </div>
  );
}
