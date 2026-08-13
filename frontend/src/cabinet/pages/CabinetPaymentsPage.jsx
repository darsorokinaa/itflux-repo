import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useSearchParams } from "react-router-dom";
import BillingOperationWizard from "../components/BillingOperationWizard";
import BillingTermsModal from "../components/BillingTermsModal";
import ChargeFromPackageModal from "../components/ChargeFromPackageModal";
import ConfirmActionModal from "../components/ConfirmActionModal";
import CabinetFloatingMenu from "../components/CabinetFloatingMenu";
import StudentFinanceDrawer from "../components/StudentFinanceDrawer";
import { CabinetSoonBadge } from "../CabinetSectionUi";
import { usePageTitle } from "../hooks/usePageTitle";
import { PAYMENTS_ENABLED } from "../featureFlags";
import {
  fetchBillingAccount,
  fetchBillingAccounts,
  fetchBillingDashboard,
  fetchBillingTransactions,
  fetchStudents,
  normalizeCabinetList,
  notifyBillingChanged,
  reverseBillingTransaction,
} from "../../utils/cabinetAuth";
import {
  accountMatchesTab,
  formatMoney,
  formatShortDate,
  formatTransactionAmount,
  resolvePaymentsRowState,
  statusModClass,
  transactionAmountMod,
} from "../billing/billingFormat";
import "../styles/payments.css";

const REVERSIBLE_TX_TYPES = new Set([
  "payment", "package_purchase", "charge", "refund", "adjustment",
  "discount", "write_off", "package_consumption", "package_return",
]);

const TABS = [
  { id: "all", label: "Все" },
  { id: "action", label: "Требуют действия" },
  { id: "debts", label: "Долги" },
  { id: "packages", label: "Абонементы" },
  { id: "oneshot", label: "Разовые" },
  { id: "history", label: "История" },
];

function canReverseTx(tx) {
  if (!tx?.id) return false;
  if (tx.is_reversal || tx.is_reversed) return false;
  return REVERSIBLE_TX_TYPES.has(tx.transaction_type);
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

function debtLabel(amount, currency) {
  const n = Number(amount) || 0;
  if (n <= 0) return null;
  const formatted = formatMoney(n, currency).replace(/^-/, "");
  return `−${formatted}`;
}

function AddMenu({ onPayment, onPackage, onCharge, onMore }) {
  const [anchor, setAnchor] = useState(null);
  const open = Boolean(anchor);

  return (
    <div className="pay-add-menu">
      <button
        type="button"
        className="pay-btn pay-btn--primary"
        aria-expanded={open}
        onClick={(e) => setAnchor(open ? null : e.currentTarget)}
      >
        + Добавить
      </button>
      <CabinetFloatingMenu
        open={open}
        anchorEl={anchor}
        onClose={() => setAnchor(null)}
        className="pay-add-menu__dropdown"
        align="left"
        width={220}
      >
        <button type="button" role="menuitem" onClick={() => { setAnchor(null); onPayment(); }}>
          Добавить оплату
        </button>
        <button type="button" role="menuitem" onClick={() => { setAnchor(null); onPackage(); }}>
          Создать абонемент
        </button>
        <button type="button" role="menuitem" onClick={() => { setAnchor(null); onCharge?.(); }}>
          Списать из абонемента
        </button>
        <button type="button" role="menuitem" onClick={() => { setAnchor(null); onMore?.(); }}>
          Другая операция…
        </button>
      </CabinetFloatingMenu>
    </div>
  );
}

function CabinetPaymentsPlaceholder() {
  usePageTitle("Оплаты");
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
  usePageTitle("Оплаты");
  const [searchParams, setSearchParams] = useSearchParams();
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
  const [tab, setTab] = useState("all");
  const [query, setQuery] = useState("");
  const [wizardOpen, setWizardOpen] = useState(false);
  const [wizardOp, setWizardOp] = useState(null);
  const [defaultStudentId, setDefaultStudentId] = useState(null);
  const [drawerAccount, setDrawerAccount] = useState(null);
  const [drawerLoading, setDrawerLoading] = useState(false);
  const [reverseTarget, setReverseTarget] = useState(null);
  const [reversingId, setReversingId] = useState(null);
  const [chargeOpen, setChargeOpen] = useState(false);
  const [chargeLessonIds, setChargeLessonIds] = useState(null);
  const [termsOpen, setTermsOpen] = useState(false);
  const [termsStudentId, setTermsStudentId] = useState(null);
  const deepLinkHandled = useRef("");

  const currency = dashboard?.currency || "RUB";
  const monthSwitcherLabel = formatMonthSwitcherLabel(monthCursor);
  const unpaidCount = Number(dashboard?.unpaid_lessons_count || 0);
  const unpaidAmount = Number(dashboard?.unpaid_lessons_amount || 0);
  const expected = Number(dashboard?.expected_amount ?? dashboard?.expected_incoming ?? 0);
  const debtTotal = Number(dashboard?.debt_total || unpaidAmount || 0);
  const endingPackages = Number(dashboard?.ending_packages ?? dashboard?.low_packages ?? 0);

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

  useEffect(() => { reload(); }, [reload]);

  useEffect(() => {
    if (!drawerAccount?.id) return undefined;
    let cancelled = false;
    setDrawerLoading(true);
    fetchBillingAccount(drawerAccount.id)
      .then((data) => { if (!cancelled) setDrawerAccount(data); })
      .catch(() => {})
      .finally(() => { if (!cancelled) setDrawerLoading(false); });
    return () => { cancelled = true; };
  }, [drawerAccount?.id]);

  useEffect(() => {
    if (!toast) return undefined;
    const t = setTimeout(() => setToast(""), 2800);
    return () => clearTimeout(t);
  }, [toast]);

  useEffect(() => {
    const studentId = searchParams.get("student");
    if (!studentId || loading || !accounts.length) return;
    if (deepLinkHandled.current === studentId) return;
    const match = accounts.find((a) => String(a.student_id || a.studentId) === String(studentId));
    if (match) {
      deepLinkHandled.current = studentId;
      setDrawerAccount(match);
      const next = new URLSearchParams(searchParams);
      next.delete("student");
      setSearchParams(next, { replace: true });
    }
  }, [accounts, loading, searchParams, setSearchParams]);

  useEffect(() => {
    const onBilling = () => { void reload(); };
    window.addEventListener("cabinet:billing-changed", onBilling);
    return () => window.removeEventListener("cabinet:billing-changed", onBilling);
  }, [reload]);

  const tabCounts = useMemo(() => {
    const counts = { all: accounts.length, action: 0, debts: 0, packages: 0, oneshot: 0, history: monthTx.length };
    accounts.forEach((a) => {
      if (accountMatchesTab(a, "action")) counts.action += 1;
      if (accountMatchesTab(a, "debts")) counts.debts += 1;
      if (accountMatchesTab(a, "packages")) counts.packages += 1;
      if (accountMatchesTab(a, "oneshot")) counts.oneshot += 1;
    });
    return counts;
  }, [accounts, monthTx.length]);

  const filteredAccounts = useMemo(() => {
    const q = query.trim().toLowerCase();
    return accounts.filter((a) => {
      if (tab !== "history" && !accountMatchesTab(a, tab === "history" ? "all" : tab)) return false;
      if (!q) return true;
      const name = (a.student_name || "").toLowerCase();
      const payer = (a.payer_name || "").toLowerCase();
      const headline = (a.headline || "").toLowerCase();
      return name.includes(q) || payer.includes(q) || headline.includes(q);
    });
  }, [accounts, tab, query]);

  const openWizard = (studentId = null, opType = null) => {
    setDefaultStudentId(studentId);
    setWizardOp(opType);
    setWizardOpen(true);
  };

  const openDrawer = (account) => setDrawerAccount(account);

  const shiftMonth = (delta) => {
    setMonthCursor((prev) => new Date(prev.getFullYear(), prev.getMonth() + delta, 1));
  };

  const refreshDrawer = async () => {
    if (!drawerAccount?.id) return;
    const data = await fetchBillingAccount(drawerAccount.id).catch(() => null);
    if (data) setDrawerAccount(data);
  };

  const onWizardDone = async (meta) => {
    if (meta?.message) setToast(meta.message);
    else setToast(meta?.closedDebt ? "Задолженность закрыта" : "Операция сохранена");
    notifyBillingChanged({ studentId: meta?.studentId || drawerAccount?.student_id || defaultStudentId });
    await reload();
    await refreshDrawer();
  };

  const confirmReverse = async () => {
    if (!reverseTarget?.id) return;
    const studentId = reverseTarget?.student_id || drawerAccount?.student_id;
    setReversingId(reverseTarget.id);
    try {
      await reverseBillingTransaction(reverseTarget.id, { comment: "Отмена операции" });
      setToast("Операция отменена");
      setReverseTarget(null);
      notifyBillingChanged({ studentId });
      await reload();
      await refreshDrawer();
    } catch (err) {
      setToast(err.message || "Не удалось отменить операцию");
      setReverseTarget(null);
    } finally {
      setReversingId(null);
    }
  };

  const onChargeDone = async (result) => {
    setToast(result?.message || "Уроки списаны из абонемента");
    setChargeOpen(false);
    setChargeLessonIds(null);
    notifyBillingChanged({ studentId: drawerAccount?.student_id });
    await reload();
    await refreshDrawer();
  };

  const openChargeFromPackage = async (account, lessonIds = null) => {
    setChargeLessonIds(lessonIds);
    setChargeOpen(true);
    if (!account?.id) return;
    if (account === drawerAccount && (account.available_packages || []).length) {
      return;
    }
    setDrawerAccount(account);
    const data = await fetchBillingAccount(account.id).catch(() => account);
    if (data) setDrawerAccount(data);
  };

  const openTerms = (accountOrId) => {
    const sid = typeof accountOrId === "object"
      ? accountOrId?.student_id
      : accountOrId;
    setTermsStudentId(sid);
    setTermsOpen(true);
  };

  const runPrimaryAction = (account, state) => {
    const action = state.primaryAction || account.primary_action;
    if (action === "payment") openWizard(account.student_id, "lessons");
    else if (action === "package") openWizard(account.student_id, "package_buy");
    else if (action === "setup") openTerms(account);
    else if (action === "charge_package") openChargeFromPackage(account);
    else openDrawer(account);
  };

  return (
    <div className="pay-page">
      <header className="pay-header pay-head">
        <div>
          <div className="pay-header__title-row">
            <h1>Оплаты</h1>
            <div className="pay-month-switch">
              <button type="button" className="pay-btn pay-btn--icon" aria-label="Предыдущий месяц" onClick={() => shiftMonth(-1)}>‹</button>
              <span className="pay-month-switch__label">{monthSwitcherLabel}</span>
              <button type="button" className="pay-btn pay-btn--icon" aria-label="Следующий месяц" onClick={() => shiftMonth(1)}>›</button>
            </div>
          </div>
          <p className="pay-head__sub">Долги, абонементы, разовые оплаты и история операций</p>
        </div>
        <AddMenu
          onPayment={() => openWizard(null, "lessons")}
          onPackage={() => openWizard(null, "package_buy")}
          onCharge={() => openWizard(null, "package_charge")}
          onMore={() => openWizard(null, null)}
        />
      </header>

      {error ? <div className="pay-error">{error}</div> : null}
      {toast ? <div className="pay-toast" role="status">{toast}</div> : null}

      <div className="pay-metrics pay-metrics--grid6">
        <div className="pay-metric pay-metric--ok">
          <p className="pay-summary__label">Получено за месяц</p>
          <p className="pay-summary__value">{formatMoney(dashboard?.month_received, currency)}</p>
        </div>
        <div className={`pay-metric${expected > 0 ? " pay-metric--warn" : ""}`}>
          <p className="pay-summary__label">Ожидается</p>
          <p className="pay-summary__value">{formatMoney(expected, currency)}</p>
        </div>
        <div className={`pay-metric${debtTotal > 0 ? " pay-metric--alert" : ""}`}>
          <p className="pay-summary__label">Задолженность</p>
          <p className="pay-summary__value">{debtLabel(debtTotal, currency) || "0 ₽"}</p>
        </div>
        <div className={`pay-metric${unpaidCount > 0 ? " pay-metric--alert" : ""}`}>
          <p className="pay-summary__label">Неоплаченных уроков</p>
          <p className="pay-summary__value">{unpaidCount}</p>
        </div>
        <div className="pay-metric">
          <p className="pay-summary__label">Активных абонементов</p>
          <p className="pay-summary__value">{dashboard?.active_packages ?? "—"}</p>
        </div>
        <div className={`pay-metric${endingPackages > 0 ? " pay-metric--warn" : ""}`}>
          <p className="pay-summary__label">Заканчивающихся</p>
          <p className="pay-summary__value">{endingPackages}</p>
        </div>
      </div>

      <div className="pay-tabs pay-tabs--pills" role="tablist">
        {TABS.map((t) => (
          <button
            key={t.id}
            type="button"
            role="tab"
            aria-selected={tab === t.id}
            className={`pay-tab${tab === t.id ? " pay-tab--active" : ""}`}
            onClick={() => setTab(t.id)}
          >
            {t.label}
            {t.id !== "history" ? (
              <span className="pay-tab__count">{tabCounts[t.id] ?? 0}</span>
            ) : (
              <span className="pay-tab__count">{monthTx.length}</span>
            )}
          </button>
        ))}
      </div>

      {tab !== "history" ? (
        <div className="pay-search-row">
          <input
            className="pay-input pay-input--search"
            placeholder="Поиск ученика…"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />
        </div>
      ) : null}

      {tab === "history" ? (
        <section className="pay-section">
          <div className="pay-history-panel">
            {loading ? <div className="pay-empty">Загрузка…</div> : null}
            {!loading && monthTx.length === 0 ? (
              <div className="pay-empty">За этот месяц операций нет</div>
            ) : null}
            {!loading && monthTx.length > 0 ? (
              <ul className="pay-tx-list" style={{ padding: "8px 14px" }}>
                {monthTx.map((tx) => {
                  const reversed = Boolean(tx.is_reversed);
                  const mod = transactionAmountMod(tx);
                  return (
                    <li key={tx.id} className={`pay-tx-item${reversed ? " pay-tx-item--reversed" : ""}`}>
                      <div>
                        <p className="pay-tx-item__name">
                          {tx.student_name || "Ученик"}
                          {" · "}
                          {tx.transaction_type_label || tx.transaction_type}
                          {reversed ? " · отменена" : ""}
                        </p>
                        <p className="pay-tx-item__when">
                          {formatShortDate(tx.occurred_at)}
                          {tx.comment ? ` · ${tx.comment}` : ""}
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
                            onClick={() => setReverseTarget(tx)}
                          >
                            Отменить
                          </button>
                        ) : null}
                      </div>
                    </li>
                  );
                })}
              </ul>
            ) : null}
          </div>
        </section>
      ) : (
        <section className="pay-section">
          {loading ? <div className="pay-empty">Загрузка…</div> : null}
          {!loading && filteredAccounts.length === 0 ? (
            <div className="pay-empty">
              {accounts.length === 0
                ? "Пока нет учеников с оплатами. Создайте абонемент или проведите урок."
                : "Нет учеников в этой вкладке."}
            </div>
          ) : null}
          {!loading && filteredAccounts.length > 0 ? (
            <ul className="pay-student-list pay-student-list--rich">
              {filteredAccounts.map((account) => {
                const state = resolvePaymentsRowState(account);
                return (
                  <li key={account.id} className="pay-student-card">
                    <div>
                      <p className="pay-student-card__name">{account.student_name}</p>
                      <p className="pay-student-card__meta">
                        {state.scheme || account.scheme_label}
                        {account.next_lesson_at ? ` · след. ${formatShortDate(account.next_lesson_at)}` : ""}
                      </p>
                      <span className={`pay-status ${statusModClass(account.status_mod || state.balanceMod)}`}>
                        {account.headline || state.statusText}
                      </span>
                    </div>
                    <div className="pay-student-card__finance">
                      <span className={`pay-student-card__amount pay-balance--${state.balanceMod}`}>
                        {state.balanceText}
                      </span>
                      <span className="pay-student-card__hint">
                        {state.primaryLabel || account.primary_label || "Открыть карточку"}
                      </span>
                    </div>
                    <div className="pay-student-card__actions">
                      {(state.suggestedActions || account.suggested_actions || []).includes("payment") ? (
                        <button
                          type="button"
                          className="pay-btn pay-btn--sm"
                          onClick={() => openWizard(account.student_id, "lessons")}
                        >
                          <span className="pay-btn__full">Оплата</span>
                          <span className="pay-btn__short">₽</span>
                        </button>
                      ) : null}
                      {(state.suggestedActions || []).includes("package") || state.primaryAction === "package" ? (
                        <button
                          type="button"
                          className="pay-btn pay-btn--sm"
                          onClick={() => openWizard(account.student_id, "package_buy")}
                        >
                          Абон.
                        </button>
                      ) : null}
                      {(state.suggestedActions || []).includes("charge_package") ? (
                        <button
                          type="button"
                          className="pay-btn pay-btn--sm"
                          onClick={() => openChargeFromPackage(account)}
                        >
                          Списать
                        </button>
                      ) : null}
                      {(state.suggestedActions || []).includes("setup") || state.primaryAction === "setup" ? (
                        <button
                          type="button"
                          className="pay-btn pay-btn--sm"
                          onClick={() => openTerms(account)}
                        >
                          Настроить
                        </button>
                      ) : null}
                      <button
                        type="button"
                        className="pay-btn pay-btn--sm pay-btn--cta"
                        onClick={() => {
                          if (state.actionNeedsAttention && state.primaryAction && state.primaryAction !== "open") {
                            runPrimaryAction(account, state);
                          } else {
                            openDrawer(account);
                          }
                        }}
                      >
                        {state.actionNeedsAttention && state.primaryLabel && state.primaryAction !== "open"
                          ? state.primaryLabel
                          : "Открыть"}
                      </button>
                    </div>
                  </li>
                );
              })}
            </ul>
          ) : null}
        </section>
      )}

      <StudentFinanceDrawer
        account={drawerAccount}
        loading={drawerLoading}
        currency={currency}
        onClose={() => setDrawerAccount(null)}
        onPayment={(studentId) => openWizard(studentId, "lessons")}
        onPackage={(studentId) => openWizard(studentId, "package_buy")}
        onChargeFromPackage={openChargeFromPackage}
        onSetupTerms={openTerms}
        onAdjust={(acc) => openWizard(acc.student_id, "adjustment")}
        onRefund={(acc) => openWizard(acc.student_id, "refund")}
        onReverseTx={setReverseTarget}
        reversingId={reversingId}
      />

      <ChargeFromPackageModal
        open={chargeOpen && Boolean(drawerAccount)}
        account={drawerAccount}
        initialLessonIds={chargeLessonIds}
        onClose={() => {
          setChargeOpen(false);
          setChargeLessonIds(null);
        }}
        onDone={onChargeDone}
      />

      <BillingTermsModal
        open={termsOpen}
        studentId={termsStudentId}
        studentName={
          students.find((s) => String(s.id) === String(termsStudentId))?.name
          || drawerAccount?.student_name
          || ""
        }
        onClose={() => setTermsOpen(false)}
        onDone={async () => {
          setToast("Условия оплаты обновлены");
          setTermsOpen(false);
          notifyBillingChanged({ studentId: termsStudentId });
          await reload();
          await refreshDrawer();
        }}
      />

      <ConfirmActionModal
        open={Boolean(reverseTarget)}
        title="Отменить операцию?"
        text={
          reverseTarget
            ? `Будет отменена операция «${reverseTarget.transaction_type_label || reverseTarget.transaction_type}» на ${formatTransactionAmount(reverseTarget, currency)}. Баланс и абонемент пересчитаются.`
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

      <BillingOperationWizard
        open={wizardOpen}
        onClose={() => setWizardOpen(false)}
        students={students}
        accounts={accounts}
        defaultStudentId={defaultStudentId}
        defaultOpType={wizardOp}
        onDone={onWizardDone}
      />
    </div>
  );
}

export default function CabinetPaymentsPage() {
  if (!PAYMENTS_ENABLED) return <CabinetPaymentsPlaceholder />;
  return <CabinetPaymentsPageInner />;
}
