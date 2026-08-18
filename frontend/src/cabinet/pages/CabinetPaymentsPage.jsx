import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useSearchParams } from "react-router-dom";
import BillingOperationWizard from "../components/BillingOperationWizard";
import BillingPaymentModal from "../components/BillingPaymentModal";
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
  fetchStudents,
  normalizeCabinetList,
  notifyBillingChanged,
  previewBillingRebuild,
  applyBillingRebuild,
  reverseBillingTransaction,
  updateBillingPayment,
  updateEventBillingCharge,
} from "../../utils/cabinetAuth";
import {
  formatMoney,
  formatShortDate,
  formatTransactionAmount,
} from "../billing/billingFormat";
import "../styles/payments.css";

function monthBounds(cursor) {
  const year = cursor.getFullYear();
  const month = cursor.getMonth() + 1;
  return { year, month };
}

function formatMonthSwitcherLabel(cursor) {
  const raw = cursor.toLocaleDateString("ru-RU", { month: "long", year: "numeric" });
  return raw.charAt(0).toUpperCase() + raw.slice(1).replace(/\s*г\.?$/, "");
}

function lessonsWord(n) {
  const num = Number(n) || 0;
  const mod10 = num % 10;
  const mod100 = num % 100;
  if (mod10 === 1 && mod100 !== 11) return `${num} занятие`;
  if (mod10 >= 2 && mod10 <= 4 && !(mod100 >= 12 && mod100 <= 14)) return `${num} занятия`;
  return `${num} занятий`;
}

function studentDue(account) {
  return Number(account?.debt_amount ?? account?.unpaid_lessons_amount ?? account?.lesson_stats?.due_amount ?? 0);
}

function studentCredit(account) {
  return Number(account?.credit_amount ?? account?.balance?.credit ?? 0);
}

function studentBreakdown(account, currency) {
  const stats = account?.lesson_stats || {};
  const count = Number(stats.conducted_charged_count || 0);
  const charged = Number(stats.charged_amount ?? account?.charged_total ?? 0);
  const paid = Number(stats.paid_amount ?? account?.paid_total ?? 0);
  const unit = stats.unit_price != null ? Number(stats.unit_price) : null;
  const parts = [];
  if (count > 0 && unit != null && unit > 0) {
    parts.push(`${lessonsWord(count)} × ${formatMoney(unit, currency)} = ${formatMoney(charged, currency)}`);
  } else if (charged > 0) {
    parts.push(`Начислено: ${formatMoney(charged, currency)}`);
  }
  if (paid > 0) parts.push(`Оплачено: ${formatMoney(paid, currency)}`);
  return parts;
}

function AddMenu({ onPayment, onPackage, onMore }) {
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
        Добавить оплату
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
  const [students, setStudents] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [toast, setToast] = useState("");
  const [query, setQuery] = useState("");
  const [debtOnly, setDebtOnly] = useState(false);
  const [payFilter, setPayFilter] = useState("all");
  const [studentFilter, setStudentFilter] = useState("");
  const [wizardOpen, setWizardOpen] = useState(false);
  const [wizardOp, setWizardOp] = useState(null);
  const [paymentOpen, setPaymentOpen] = useState(false);
  const [defaultStudentId, setDefaultStudentId] = useState(null);
  const [drawerAccount, setDrawerAccount] = useState(null);
  const [drawerLoading, setDrawerLoading] = useState(false);
  const [reverseTarget, setReverseTarget] = useState(null);
  const [reversingId, setReversingId] = useState(null);
  const [chargeOpen, setChargeOpen] = useState(false);
  const [chargeLessonIds, setChargeLessonIds] = useState(null);
  const [termsOpen, setTermsOpen] = useState(false);
  const [termsStudentId, setTermsStudentId] = useState(null);
  const [rebuildAccount, setRebuildAccount] = useState(null);
  const [rebuildStep, setRebuildStep] = useState(""); // intro | preview
  const [rebuildPreview, setRebuildPreview] = useState(null);
  const [rebuildBusy, setRebuildBusy] = useState(false);
  const deepLinkHandled = useRef("");

  const currency = dashboard?.currency || "RUB";
  const monthSwitcherLabel = formatMonthSwitcherLabel(monthCursor);
  const charged = Number(dashboard?.month_charged || 0);
  const received = Number(dashboard?.month_received || 0);
  const due = Number(dashboard?.unpaid_lessons_amount || dashboard?.debt_total || 0);
  const creditTotal = Number(dashboard?.credit_total || 0);

  const reload = useCallback(async () => {
    setLoading(true);
    setError("");
    const bounds = monthBounds(monthCursor);
    try {
      const [dash, acc, stud] = await Promise.all([
        fetchBillingDashboard({ year: bounds.year, month: bounds.month }),
        fetchBillingAccounts({}),
        fetchStudents(),
      ]);
      setDashboard(dash);
      setAccounts(Array.isArray(acc) ? acc : []);
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

  const filteredAccounts = useMemo(() => {
    const q = query.trim().toLowerCase();
    return accounts.filter((a) => {
      if (studentFilter && String(a.student_id) !== String(studentFilter)) return false;
      const dueAmt = studentDue(a);
      const credit = studentCredit(a);
      if (debtOnly && dueAmt <= 0) return false;
      if (payFilter === "debt" && dueAmt <= 0) return false;
      if (payFilter === "partial") {
        const unpaid = a.unpaid_lessons || [];
        const hasPartial = unpaid.some((l) => l.financial_status === "partially_paid" || l.payment_status === "partially_paid");
        if (!hasPartial) return false;
      }
      if (payFilter === "paid" && dueAmt > 0) return false;
      if (payFilter === "credit" && credit <= 0) return false;
      if (!q) return true;
      const name = (a.student_name || "").toLowerCase();
      return name.includes(q);
    });
  }, [accounts, query, debtOnly, payFilter, studentFilter]);

  const openWizard = (studentId = null, opType = null) => {
    setDefaultStudentId(studentId);
    setWizardOp(opType);
    setWizardOpen(true);
  };

  const openPayment = (studentId = null) => {
    setDefaultStudentId(studentId);
    setPaymentOpen(true);
  };

  const shiftMonth = (delta) => {
    setMonthCursor((prev) => new Date(prev.getFullYear(), prev.getMonth() + delta, 1));
  };

  const refreshDrawer = async () => {
    if (!drawerAccount?.id) return;
    const data = await fetchBillingAccount(drawerAccount.id).catch(() => null);
    if (data) setDrawerAccount(data);
  };

  const onSaved = async (meta) => {
    if (meta?.message) setToast(meta.message);
    else setToast("Сохранено");
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

  const openChargeFromPackage = async (account, lessonIds = null) => {
    setChargeLessonIds(lessonIds);
    setChargeOpen(true);
    if (!account?.id) return;
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

  const filterHint = [
    monthSwitcherLabel,
    studentFilter
      ? (students.find((s) => String(s.id) === String(studentFilter))?.name || "Ученик")
      : "Все ученики",
    debtOnly || payFilter === "debt" ? "Есть долг" : null,
  ].filter(Boolean).join(" · ");

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
          <p className="pay-head__sub">Сколько начислено, сколько уже оплатили и сколько сейчас должны</p>
        </div>
        <AddMenu
          onPayment={() => openPayment(null)}
          onPackage={() => openWizard(null, "package_buy")}
          onMore={() => openWizard(null, null)}
        />
      </header>

      {error ? <div className="pay-error">{error}</div> : null}
      {toast ? <div className="pay-toast" role="status">{toast}</div> : null}

      <div className="pay-metrics pay-metrics--hero">
        <div className="pay-metric">
          <p className="pay-summary__label">Начислено за {monthSwitcherLabel.replace(/ \d{4}$/, "")}</p>
          <p className="pay-summary__value">{formatMoney(charged, currency)}</p>
        </div>
        <div className="pay-metric pay-metric--ok">
          <p className="pay-summary__label">Получено</p>
          <p className="pay-summary__value">{formatMoney(received, currency)}</p>
        </div>
        <div className={`pay-metric${due > 0 ? " pay-metric--alert" : ""}`}>
          <p className="pay-summary__label">К оплате</p>
          <p className="pay-summary__value">{formatMoney(due, currency)}</p>
        </div>
        {creditTotal > 0 ? (
          <div className="pay-metric pay-metric--ok">
            <p className="pay-summary__label">Аванс</p>
            <p className="pay-summary__value">{formatMoney(creditTotal, currency)}</p>
          </div>
        ) : null}
      </div>

      <div className="pay-filters">
        <p className="pay-filters__hint">{filterHint}</p>
        <div className="pay-filters__row">
          <input
            className="pay-input pay-input--search"
            placeholder="Ученик"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />
          <select
            className="pay-select pay-select--compact"
            value={studentFilter}
            onChange={(e) => setStudentFilter(e.target.value)}
            aria-label="Ученик"
          >
            <option value="">Все ученики</option>
            {students.map((s) => (
              <option key={s.id} value={s.id}>{s.name}</option>
            ))}
          </select>
          <select
            className="pay-select pay-select--compact"
            value={payFilter}
            onChange={(e) => {
              setPayFilter(e.target.value);
              if (e.target.value === "debt") setDebtOnly(true);
              else setDebtOnly(false);
            }}
            aria-label="Статус оплаты"
          >
            <option value="all">Все статусы</option>
            <option value="debt">Есть долг</option>
            <option value="partial">Частично оплачено</option>
            <option value="paid">Оплачено</option>
            <option value="credit">Есть аванс</option>
          </select>
          <label className="pay-check">
            <input
              type="checkbox"
              checked={debtOnly}
              onChange={(e) => {
                setDebtOnly(e.target.checked);
                if (e.target.checked) setPayFilter("debt");
                else if (payFilter === "debt") setPayFilter("all");
              }}
            />
            Только с задолженностью
          </label>
        </div>
      </div>

      <section className="pay-section">
        {loading ? <div className="pay-empty">Загрузка…</div> : null}
        {!loading && filteredAccounts.length === 0 ? (
          <div className="pay-empty">
            {accounts.length === 0
              ? "Пока нет учеников с оплатами. Добавьте стоимость занятия или оплату."
              : "Нет учеников по выбранным фильтрам."}
          </div>
        ) : null}
        {!loading && filteredAccounts.length > 0 ? (
          <ul className="pay-student-list pay-student-list--air">
            {filteredAccounts.map((account) => {
              const dueAmt = studentDue(account);
              const credit = studentCredit(account);
              const lines = studentBreakdown(account, currency);
              return (
                <li key={account.id} className="pay-student-card pay-student-card--air">
                  <div>
                    <p className="pay-student-card__name">{account.student_name}</p>
                    <p className={`pay-student-card__due${dueAmt > 0 ? " pay-student-card__due--debt" : credit > 0 ? " pay-student-card__due--ok" : ""}`}>
                      {dueAmt > 0
                        ? `К оплате: ${formatMoney(dueAmt, currency)}`
                        : credit > 0
                          ? `Аванс: ${formatMoney(credit, currency)}`
                          : "К оплате: 0 ₽"}
                    </p>
                    {lines.map((line) => (
                      <p key={line} className="pay-student-card__meta">{line}</p>
                    ))}
                  </div>
                  <div className="pay-student-card__actions">
                    <button
                      type="button"
                      className="pay-btn pay-btn--sm pay-btn--primary"
                      onClick={() => openPayment(account.student_id)}
                    >
                      Добавить оплату
                    </button>
                    <button
                      type="button"
                      className="pay-btn pay-btn--sm"
                      onClick={() => setDrawerAccount(account)}
                    >
                      История
                    </button>
                    <button
                      type="button"
                      className="pay-btn pay-btn--sm"
                      onClick={() => openTerms(account)}
                    >
                      Настройки
                    </button>
                  </div>
                </li>
              );
            })}
          </ul>
        ) : null}
      </section>

      <StudentFinanceDrawer
        account={drawerAccount}
        loading={drawerLoading}
        currency={currency}
        onClose={() => setDrawerAccount(null)}
        onPayment={(studentId) => openPayment(studentId)}
        onPackage={(studentId) => openWizard(studentId, "package_buy")}
        onChargeFromPackage={openChargeFromPackage}
        onSetupTerms={openTerms}
        onAdjust={(acc) => openWizard(acc.student_id, "adjustment")}
        onRefund={(acc) => openWizard(acc.student_id, "refund")}
        onReverseTx={setReverseTarget}
        onRebuild={(account) => {
          setRebuildAccount(account);
          setRebuildPreview(null);
          setRebuildStep("intro");
        }}
        onUpdateCharge={async (lesson, amount) => {
          await updateEventBillingCharge(lesson.id, { amount: String(amount), comment: "Ручное изменение суммы" });
          setToast("Сумма начисления обновлена");
          notifyBillingChanged({ studentId: drawerAccount?.student_id });
          await reload();
          await refreshDrawer();
        }}
        onUpdatePayment={async (tx, amount) => {
          await updateBillingPayment(tx.student_payment_id, { amount: String(amount) });
          setToast("Платёж обновлён");
          notifyBillingChanged({ studentId: drawerAccount?.student_id });
          await reload();
          await refreshDrawer();
        }}
        reversingId={reversingId}
      />

      <BillingPaymentModal
        open={paymentOpen}
        simple
        students={students}
        accounts={accounts}
        defaultStudentId={defaultStudentId}
        onClose={() => setPaymentOpen(false)}
        onDone={onSaved}
      />

      <ChargeFromPackageModal
        open={chargeOpen && Boolean(drawerAccount)}
        account={drawerAccount}
        initialLessonIds={chargeLessonIds}
        onClose={() => {
          setChargeOpen(false);
          setChargeLessonIds(null);
        }}
        onDone={async (result) => {
          setToast(result?.message || "Уроки списаны из абонемента");
          setChargeOpen(false);
          setChargeLessonIds(null);
          notifyBillingChanged({ studentId: drawerAccount?.student_id });
          await reload();
          await refreshDrawer();
        }}
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
        open={rebuildStep === "intro"}
        title="Пересчитать оплаты?"
        text="Мы проверим начисления и платежи ученика и найдём расхождения. Суммы не изменятся, пока вы не подтвердите исправление."
        confirmLabel="Проверить"
        cancelLabel="Закрыть"
        loading={rebuildBusy}
        onConfirm={async () => {
          if (!rebuildAccount?.id) return;
          setRebuildBusy(true);
          try {
            const preview = await previewBillingRebuild(rebuildAccount.id);
            setRebuildPreview(preview);
            setRebuildStep("preview");
          } catch (err) {
            setToast(err.message || "Не удалось проверить оплаты");
            setRebuildStep("");
            setRebuildAccount(null);
          } finally {
            setRebuildBusy(false);
          }
        }}
        onClose={() => {
          if (rebuildBusy) return;
          setRebuildStep("");
          setRebuildAccount(null);
        }}
      />

      <ConfirmActionModal
        open={rebuildStep === "preview"}
        title="Результат проверки"
        text={(
          <div>
            <p className="cb-confirm-text">
              Сейчас к оплате: {formatMoney(rebuildPreview?.current_due, currency)}
              <br />
              После пересчёта: {formatMoney(rebuildPreview?.correct_due, currency)}
            </p>
            {rebuildPreview?.problems?.length ? (
              <p className="pay-hint">
                Найдены проблемы: {rebuildPreview.problems.join("; ")}
              </p>
            ) : (
              <p className="pay-hint">Расхождений нет. Исправлять ничего не нужно.</p>
            )}
          </div>
        )}
        confirmLabel={rebuildPreview?.needs_repair ? "Исправить" : "Понятно"}
        cancelLabel="Закрыть"
        loading={rebuildBusy}
        onConfirm={async () => {
          if (!rebuildPreview?.needs_repair) {
            setRebuildStep("");
            setRebuildAccount(null);
            setRebuildPreview(null);
            return;
          }
          if (!rebuildAccount?.id) return;
          setRebuildBusy(true);
          try {
            const result = await applyBillingRebuild(rebuildAccount.id);
            if (result?.account) setDrawerAccount(result.account);
            setToast("Оплаты пересчитаны");
            notifyBillingChanged({ studentId: rebuildAccount.student_id });
            await reload();
            setRebuildStep("");
            setRebuildAccount(null);
            setRebuildPreview(null);
          } catch (err) {
            setToast(err.message || "Не удалось пересчитать оплаты");
          } finally {
            setRebuildBusy(false);
          }
        }}
        onClose={() => {
          if (rebuildBusy) return;
          setRebuildStep("");
          setRebuildAccount(null);
          setRebuildPreview(null);
        }}
      />

      <ConfirmActionModal
        open={Boolean(reverseTarget)}
        title="Отменить операцию?"
        text={
          reverseTarget
            ? `Будет отменена операция «${reverseTarget.transaction_type_label || reverseTarget.transaction_type}» на ${formatTransactionAmount(reverseTarget, currency)}. Баланс пересчитается.`
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
        onDone={onSaved}
      />
    </div>
  );
}

export default function CabinetPaymentsPage() {
  if (!PAYMENTS_ENABLED) return <CabinetPaymentsPlaceholder />;
  return <CabinetPaymentsPageInner />;
}
