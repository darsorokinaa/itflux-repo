import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import BillingPaymentModal from "../components/BillingPaymentModal";
import BillingPackageModal from "../components/BillingPackageModal";
import ConfirmActionModal from "../components/ConfirmActionModal";
import { CabinetSoonBadge } from "../CabinetSectionUi";
import { PAYMENTS_ENABLED } from "../featureFlags";
import {
  fetchBillingAccount,
  fetchBillingAccounts,
  fetchBillingDashboard,
  fetchBillingTransactions,
  fetchStudents,
  normalizeCabinetList,
  reverseBillingTransaction,
} from "../../utils/cabinetAuth";
import {
  formatLessonWhen,
  formatMoney,
  formatShortDate,
  formatUnits,
} from "../billing/billingFormat";
import "../styles/payments.css";

const PAYMENT_TX_TYPES = new Set(["payment", "package_purchase"]);
const REVERSIBLE_TX_TYPES = new Set([
  "payment",
  "package_purchase",
  "charge",
  "refund",
  "adjustment",
  "discount",
  "write_off",
  "package_consumption",
  "package_return",
]);

function canReverseTx(tx) {
  if (!tx?.id) return false;
  if (tx.is_reversal || tx.is_reversed) return false;
  return REVERSIBLE_TX_TYPES.has(tx.transaction_type);
}

function txAmountLabel(tx, currency) {
  const amount = Number(tx.amount || 0);
  const money = formatMoney(Math.abs(amount), tx.currency || currency);
  if (!amount) {
    const units = Number(tx.package_units || 0);
    if (units) {
      const sign = units > 0 ? "+" : "−";
      return `${sign}${formatUnits(Math.abs(units), tx.unit_type || "lesson")}`;
    }
    return "—";
  }
  const sign = amount > 0 ? "+" : "−";
  return `${sign}${money}`;
}

function monthBounds(cursor) {
  const year = cursor.getFullYear();
  const month = cursor.getMonth() + 1;
  const from = new Date(year, month - 1, 1);
  const to = new Date(year, month, 1);
  return {
    year,
    month,
    from: from.toISOString(),
    to: to.toISOString(),
  };
}

function formatMonthSwitcherLabel(cursor) {
  const raw = cursor.toLocaleDateString("ru-RU", { month: "long", year: "numeric" });
  return raw.charAt(0).toUpperCase() + raw.slice(1).replace(/\s*г\.?$/, "");
}

function lessonsCountLabel(n) {
  const num = Number(n) || 0;
  const mod10 = num % 10;
  const mod100 = num % 100;
  if (mod10 === 1 && mod100 !== 11) return `${num} урок`;
  if (mod10 >= 2 && mod10 <= 4 && (mod100 < 12 || mod100 > 14)) return `${num} урока`;
  return `${num} уроков`;
}

function remainingLessonsLabel(n) {
  const num = Number(n) || 0;
  const mod10 = num % 10;
  const mod100 = num % 100;
  if (mod10 === 1 && mod100 !== 11) return `Осталось ${num} занятие`;
  if (mod10 >= 2 && mod10 <= 4 && (mod100 < 12 || mod100 > 14)) return `Осталось ${num} занятия`;
  return `Осталось ${num} занятий`;
}

function debtLabel(amount, currency) {
  const n = Number(amount) || 0;
  if (n <= 0) return null;
  const formatted = formatMoney(n, currency).replace(/^-/, "");
  return `−${formatted}`;
}

/** Состояние строки ученика: один главный статус. */
function resolveRowState(account) {
  const currency = account.currency || "RUB";
  const unpaidAmount = Number(account.unpaid_lessons_amount || account.balance?.debt || 0);
  const unpaidCount = Number(account.unpaid_lessons_count || 0);
  const pkg = account.package;
  const remaining = pkg ? Number(pkg.remaining_units || 0) : 0;

  if (unpaidAmount > 0 || unpaidCount > 0) {
    const sub = unpaidCount > 0
      ? (pkg && remaining <= 0
        ? `Абонемент закончился · ${lessonsCountLabel(unpaidCount)}`
        : (!pkg
          ? `Абонемента нет · ${lessonsCountLabel(unpaidCount)}`
          : lessonsCountLabel(unpaidCount)))
      : (pkg ? `Абонемент: ${formatUnits(pkg.total_units, pkg.unit_type)} · осталось ${formatUnits(pkg.remaining_units, pkg.unit_type)}` : "Абонемента нет");
    return {
      subtitle: unpaidCount === 1
        ? (pkg && remaining <= 0 ? "Абонемент закончился · 1 неоплаченный урок" : (!pkg ? "Абонемента нет · 1 неоплаченный урок" : "1 неоплаченный урок"))
        : (unpaidCount > 1
          ? (pkg && remaining <= 0
            ? `Абонемент закончился · ${unpaidCount} неоплаченных урока`
            : (!pkg ? `Абонемента нет · ${unpaidCount} неоплаченных урока` : `${unpaidCount} неоплаченных урока`))
          : sub),
      balanceText: debtLabel(unpaidAmount, currency) || "Стоимость не указана",
      balanceMod: "debt",
    };
  }

  if (pkg) {
    const ending = remaining > 0 && remaining <= 2 && pkg.unit_type !== "minute";
    const endingMin = pkg.unit_type === "minute" && remaining > 0 && remaining <= 120;
    if (remaining <= 0 || pkg.display_status === "completed") {
      return {
        subtitle: "Занятия закончились",
        balanceText: "Занятия закончились",
        balanceMod: "warn",
      };
    }
    return {
      subtitle: `Абонемент: ${formatUnits(pkg.total_units, pkg.unit_type)} · осталось ${formatUnits(pkg.remaining_units, pkg.unit_type)}`,
      balanceText: ending || endingMin
        ? remainingLessonsLabel(remaining)
        : (pkg.display_status === "awaiting_payment" ? "Ожидает оплаты" : "Оплачено"),
      balanceMod: ending || endingMin ? "warn" : (pkg.display_status === "awaiting_payment" ? "muted" : "ok"),
    };
  }

  return {
    subtitle: "Абонемента нет",
    balanceText: "Абонемента нет",
    balanceMod: "muted",
  };
}

function AddMenu({ onPayment, onPackage }) {
  const [open, setOpen] = useState(false);
  const ref = useRef(null);

  useEffect(() => {
    if (!open) return undefined;
    const onDoc = (e) => {
      if (ref.current && !ref.current.contains(e.target)) setOpen(false);
    };
    document.addEventListener("mousedown", onDoc);
    return () => document.removeEventListener("mousedown", onDoc);
  }, [open]);

  return (
    <div className="pay-add-menu" ref={ref}>
      <button type="button" className="pay-btn pay-btn--primary" onClick={() => setOpen((v) => !v)}>
        + Добавить
      </button>
      {open ? (
        <div className="pay-add-menu__dropdown" role="menu">
          <button
            type="button"
            role="menuitem"
            onClick={() => { setOpen(false); onPayment(); }}
          >
            Добавить оплату
          </button>
          <button
            type="button"
            role="menuitem"
            onClick={() => { setOpen(false); onPackage(); }}
          >
            Создать абонемент
          </button>
        </div>
      ) : null}
    </div>
  );
}

function StudentDetailDrawer({
  account,
  loading,
  currency,
  onClose,
  onPayment,
  onPackage,
  onReverseTx,
  reversingId,
}) {
  if (!account) return null;
  const pkg = account.package;
  const unpaid = account.unpaid_lessons || [];
  const transactions = account.recent_transactions || [];
  const needPackage = !pkg || Number(pkg.remaining_units || 0) <= 0
    || ["completed", "expired", "exhausted"].includes(pkg.display_status || pkg.status);

  return (
    <div className="pay-history pay-overlay" role="dialog" aria-modal="true" aria-label="Подробнее">
      <button type="button" className="pay-overlay__backdrop" aria-label="Закрыть" onClick={onClose} />
      <div className="pay-overlay__panel pay-overlay__panel--drawer">
        <header className="pay-overlay__head">
          <div>
            <h2>{account.student_name}</h2>
            <p className="pay-hint">Оплата и абонемент</p>
          </div>
          <button type="button" className="pay-btn pay-btn--icon" onClick={onClose}>×</button>
        </header>

        {loading ? <div className="pay-empty">Загрузка…</div> : null}

        {!loading ? (
          <div className="pay-drawer-body">
            <section className="pay-drawer-section">
              <h3>Активный абонемент</h3>
              {pkg ? (
                <ul className="pay-drawer-facts">
                  <li>
                    <span>Занятий</span>
                    <strong>{formatUnits(pkg.total_units, pkg.unit_type)}</strong>
                  </li>
                  <li>
                    <span>Осталось</span>
                    <strong>{formatUnits(pkg.remaining_units, pkg.unit_type)}</strong>
                  </li>
                  <li>
                    <span>Стоимость</span>
                    <strong>{formatMoney(pkg.purchase_amount, currency)}</strong>
                  </li>
                  <li>
                    <span>Оплачено</span>
                    <strong>{formatMoney(pkg.paid_amount, currency)}</strong>
                  </li>
                  {pkg.expires_at ? (
                    <li>
                      <span>До</span>
                      <strong>{formatShortDate(pkg.expires_at)}</strong>
                    </li>
                  ) : null}
                  <li>
                    <span>Статус</span>
                    <strong>{pkg.display_status_label || pkg.status_label || "—"}</strong>
                  </li>
                </ul>
              ) : (
                <p className="pay-hint">Активного абонемента нет</p>
              )}
            </section>

            <section className="pay-drawer-section">
              <h3>Неоплаченные уроки</h3>
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
                          </span>
                        </div>
                        <div className="pay-unpaid-list__right">
                          {lesson.price_missing || due <= 0 ? (
                            <span className="pay-balance pay-balance--muted">Стоимость не указана</span>
                          ) : (
                            <span className="pay-balance pay-balance--debt">{debtLabel(due, currency)}</span>
                          )}
                          <span className="pay-pill pay-pill--debt">Не оплачен</span>
                        </div>
                      </li>
                    );
                  })}
                </ul>
              )}
            </section>

            <section className="pay-drawer-section">
              <h3>Операции</h3>
              {transactions.length === 0 ? (
                <p className="pay-hint">Операций пока нет</p>
              ) : (
                <ul className="pay-tx-list">
                  {transactions.map((tx) => {
                    const reversed = Boolean(tx.is_reversed);
                    const amountClass = Number(tx.amount || 0) < 0 || reversed
                      ? "pay-balance--debt"
                      : Number(tx.amount || 0) > 0
                        ? "pay-balance--ok"
                        : "pay-balance--muted";
                    return (
                      <li key={tx.id} className={`pay-tx-item${reversed ? " pay-tx-item--reversed" : ""}`}>
                        <div>
                          <p className="pay-tx-item__name">
                            {tx.transaction_type_label || tx.transaction_type}
                            {reversed ? " · отменена" : ""}
                          </p>
                          <p className="pay-tx-item__when">
                            {formatShortDate(tx.occurred_at)}
                            {tx.comment ? ` · ${tx.comment}` : ""}
                          </p>
                        </div>
                        <div className="pay-tx-item__actions">
                          <strong className={`pay-balance ${amountClass}`}>
                            {txAmountLabel(tx, currency)}
                          </strong>
                          {canReverseTx(tx) ? (
                            <button
                              type="button"
                              className="pay-btn pay-btn--ghost pay-btn--danger-text"
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
              <button type="button" className="pay-btn pay-btn--primary" onClick={() => onPayment(account.student_id)}>
                Добавить оплату
              </button>
              {needPackage ? (
                <button type="button" className="pay-btn" onClick={() => onPackage(account.student_id)}>
                  Создать абонемент
                </button>
              ) : null}
            </div>
          </div>
        ) : null}
      </div>
    </div>
  );
}

function CabinetPaymentsPlaceholder() {
  return (
    <div className="pay-page">
      <header className="pay-head">
        <div>
          <h1>Оплаты</h1>
          <p className="pay-head__sub">Абонементы и неоплаченные уроки</p>
        </div>
      </header>
      <div className="cb-placeholder-panel">
        <CabinetSoonBadge />
        <p>Раздел временно недоступен — скоро откроем полноценные оплаты.</p>
      </div>
    </div>
  );
}

function CabinetPaymentsPageInner() {
  const [monthCursor, setMonthCursor] = useState(() => {
    const now = new Date();
    return new Date(now.getFullYear(), now.getMonth(), 1);
  });
  const [dashboard, setDashboard] = useState(null);
  const [accounts, setAccounts] = useState([]);
  const [monthTx, setMonthTx] = useState([]);
  const [students, setStudents] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [toast, setToast] = useState("");
  const [paymentOpen, setPaymentOpen] = useState(false);
  const [packageOpen, setPackageOpen] = useState(false);
  const [defaultStudentId, setDefaultStudentId] = useState(null);
  const [drawerAccount, setDrawerAccount] = useState(null);
  const [drawerLoading, setDrawerLoading] = useState(false);
  const [reverseTarget, setReverseTarget] = useState(null);
  const [reversingId, setReversingId] = useState(null);

  const currency = dashboard?.currency || "RUB";
  const monthSwitcherLabel = formatMonthSwitcherLabel(monthCursor);
  const unpaidCount = Number(dashboard?.unpaid_lessons_count || 0);
  const unpaidAmount = Number(dashboard?.unpaid_lessons_amount || 0);

  const reload = useCallback(async () => {
    setLoading(true);
    setError("");
    const bounds = monthBounds(monthCursor);
    try {
      const [dash, acc, stud, txRows] = await Promise.all([
        fetchBillingDashboard({ year: bounds.year, month: bounds.month }),
        fetchBillingAccounts({}),
        fetchStudents(),
        fetchBillingTransactions({ from: bounds.from, to: bounds.to }),
      ]);
      setDashboard(dash);
      setAccounts(Array.isArray(acc) ? acc : []);
      setMonthTx(Array.isArray(txRows) ? txRows : []);
      const studentList = normalizeCabinetList(stud);
      setStudents(
        studentList.map((s) => ({
          id: s.id,
          name: s.full_name || `${s.first_name || ""} ${s.last_name || ""}`.trim(),
        })),
      );
    } catch (err) {
      setError(err.message || "Не удалось загрузить оплаты");
    } finally {
      setLoading(false);
    }
  }, [monthCursor]);

  useEffect(() => {
    document.title = "Оплаты — Личный кабинет";
  }, []);

  useEffect(() => {
    reload();
  }, [reload]);

  useEffect(() => {
    if (!drawerAccount?.id) return undefined;
    let cancelled = false;
    setDrawerLoading(true);
    fetchBillingAccount(drawerAccount.id)
      .then((data) => {
        if (!cancelled) setDrawerAccount(data);
      })
      .catch(() => {})
      .finally(() => {
        if (!cancelled) setDrawerLoading(false);
      });
    return () => { cancelled = true; };
  }, [drawerAccount?.id]);

  useEffect(() => {
    if (!toast) return undefined;
    const t = setTimeout(() => setToast(""), 2800);
    return () => clearTimeout(t);
  }, [toast]);

  const recentPayments = useMemo(
    () => monthTx
      .filter((tx) => PAYMENT_TX_TYPES.has(tx.transaction_type) && !tx.is_reversal)
      .slice(0, 8),
    [monthTx],
  );

  const openPayment = (studentId = null) => {
    setDefaultStudentId(studentId);
    setPaymentOpen(true);
  };

  const openPackage = (studentId = null) => {
    setDefaultStudentId(studentId);
    setPackageOpen(true);
  };

  const openDrawer = (account) => {
    setDrawerAccount(account);
  };

  const shiftMonth = (delta) => {
    setMonthCursor((prev) => new Date(prev.getFullYear(), prev.getMonth() + delta, 1));
  };

  const onPaymentDone = async (meta) => {
    if (meta?.message) setToast(meta.message);
    else setToast(meta?.closedDebt ? "Задолженность закрыта" : "Оплата добавлена");
    await reload();
    if (drawerAccount?.id) {
      const data = await fetchBillingAccount(drawerAccount.id).catch(() => null);
      if (data) setDrawerAccount(data);
    }
  };

  const onPackageDone = async () => {
    setToast("Абонемент создан");
    await reload();
    if (drawerAccount?.id) {
      const data = await fetchBillingAccount(drawerAccount.id).catch(() => null);
      if (data) setDrawerAccount(data);
    }
  };

  const confirmReverse = async () => {
    if (!reverseTarget?.id) return;
    setReversingId(reverseTarget.id);
    try {
      await reverseBillingTransaction(reverseTarget.id, {
        comment: "Отмена операции",
      });
      setToast("Операция отменена");
      setReverseTarget(null);
      await reload();
      if (drawerAccount?.id) {
        const data = await fetchBillingAccount(drawerAccount.id).catch(() => null);
        if (data) setDrawerAccount(data);
      }
    } catch (err) {
      setError(err?.message || "Не удалось отменить операцию");
      setReverseTarget(null);
    } finally {
      setReversingId(null);
    }
  };

  return (
    <div className="pay-page">
      <header className="pay-header pay-head">
        <div>
          <div className="pay-header__title-row">
            <h1>Оплаты</h1>
            <div className="pay-month-switch">
              <button type="button" className="pay-btn pay-btn--icon" aria-label="Предыдущий месяц" onClick={() => shiftMonth(-1)}>
                ‹
              </button>
              <span className="pay-month-switch__label">{monthSwitcherLabel}</span>
              <button type="button" className="pay-btn pay-btn--icon" aria-label="Следующий месяц" onClick={() => shiftMonth(1)}>
                ›
              </button>
            </div>
          </div>
          <p className="pay-head__sub">Остаток занятий, неоплаченные уроки и оплаты</p>
        </div>
        <AddMenu onPayment={() => openPayment()} onPackage={() => openPackage()} />
      </header>

      {error ? <div className="pay-error">{error}</div> : null}
      {toast ? <div className="pay-toast" role="status">{toast}</div> : null}

      <div className="pay-metrics pay-metrics--simple">
        <div className="pay-metric">
          <p className="pay-summary__label">Получено</p>
          <p className="pay-summary__value">{formatMoney(dashboard?.month_received, currency)}</p>
        </div>
        <div className={`pay-metric${unpaidCount > 0 ? " pay-metric--alert" : ""}`}>
          <p className="pay-summary__label">Неоплаченные уроки</p>
          <p className="pay-summary__value">
            {unpaidCount}
            {unpaidAmount > 0 ? (
              <span className="pay-summary__debt"> · {debtLabel(unpaidAmount, currency)}</span>
            ) : null}
          </p>
        </div>
        <div className="pay-metric">
          <p className="pay-summary__label">Активные абонементы</p>
          <p className="pay-summary__value">{dashboard?.active_packages ?? "—"}</p>
        </div>
      </div>

      <section className="pay-section">
        <div className="pay-section__head">
          <h2>Ученики</h2>
        </div>

        {loading ? <div className="pay-empty">Загрузка…</div> : null}

        {!loading && accounts.length === 0 ? (
          <div className="pay-empty">
            Пока нет учеников с оплатами. Создайте абонемент или проведите урок.
          </div>
        ) : null}

        {!loading && accounts.length > 0 ? (
          <ul className="pay-student-list">
            {accounts.map((account) => {
              const state = resolveRowState(account);
              return (
                <li key={account.id} className="pay-student-row">
                  <div className="pay-student-row__main">
                    <strong className="pay-student-row__name">{account.student_name}</strong>
                    <span className="pay-student-row__sub">{state.subtitle}</span>
                  </div>
                  <div className="pay-student-row__side">
                    <span className={`pay-balance pay-balance--${state.balanceMod}`}>
                      {state.balanceText}
                    </span>
                    <button
                      type="button"
                      className="pay-btn pay-btn--ghost"
                      onClick={() => openDrawer(account)}
                    >
                      Подробнее
                    </button>
                  </div>
                </li>
              );
            })}
          </ul>
        ) : null}
      </section>

      {recentPayments.length ? (
        <section className="pay-section">
          <div className="pay-section__head">
            <h2>Последние оплаты</h2>
          </div>
          <ul className="pay-recent-list">
            {recentPayments.map((tx) => (
              <li key={tx.id} className={tx.is_reversed ? "is-reversed" : ""}>
                <span>
                  {formatShortDate(tx.occurred_at)}
                  {" · "}
                  {tx.student_name || "Ученик"}
                  {tx.is_reversed ? " · отменена" : ""}
                </span>
                <div className="pay-recent-list__actions">
                  <strong className={`pay-balance ${tx.is_reversed ? "pay-balance--muted" : "pay-balance--ok"}`}>
                    +{formatMoney(tx.amount, tx.currency || currency)}
                  </strong>
                  {canReverseTx(tx) ? (
                    <button
                      type="button"
                      className="pay-btn pay-btn--ghost pay-btn--danger-text"
                      disabled={reversingId === tx.id}
                      onClick={() => setReverseTarget(tx)}
                    >
                      Отменить
                    </button>
                  ) : null}
                </div>
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      <StudentDetailDrawer
        account={drawerAccount}
        loading={drawerLoading}
        currency={currency}
        onClose={() => setDrawerAccount(null)}
        onPayment={(studentId) => {
          openPayment(studentId);
        }}
        onPackage={(studentId) => {
          openPackage(studentId);
        }}
        onReverseTx={setReverseTarget}
        reversingId={reversingId}
      />

      <ConfirmActionModal
        open={Boolean(reverseTarget)}
        title="Отменить операцию?"
        text={
          reverseTarget
            ? `Будет отменена операция «${reverseTarget.transaction_type_label || reverseTarget.transaction_type}» на ${txAmountLabel(reverseTarget, currency)}. Баланс и абонемент пересчитаются.`
            : ""
        }
        confirmLabel="Отменить операцию"
        cancelLabel="Закрыть"
        danger
        loading={Boolean(reversingId)}
        onConfirm={() => void confirmReverse()}
        onClose={() => {
          if (!reversingId) setReverseTarget(null);
        }}
      />

      <BillingPaymentModal
        open={paymentOpen}
        onClose={() => setPaymentOpen(false)}
        students={students}
        accounts={accounts}
        defaultStudentId={defaultStudentId}
        onDone={onPaymentDone}
      />
      <BillingPackageModal
        open={packageOpen}
        onClose={() => setPackageOpen(false)}
        students={students}
        defaultStudentId={defaultStudentId}
        onDone={onPackageDone}
      />
    </div>
  );
}

export default function CabinetPaymentsPage() {
  if (!PAYMENTS_ENABLED) return <CabinetPaymentsPlaceholder />;
  return <CabinetPaymentsPageInner />;
}
