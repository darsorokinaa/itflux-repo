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
import CabinetIcon from "../CabinetIcons";
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

const MONTH_PREP = {
  январь: "январе",
  февраль: "феврале",
  март: "марте",
  апрель: "апреле",
  май: "мае",
  июнь: "июне",
  июль: "июле",
  август: "августе",
  сентябрь: "сентябре",
  октябрь: "октябре",
  ноябрь: "ноябре",
  декабрь: "декабре",
};

const AVATAR_TONES = ["lilac", "mint", "sand", "sky", "rose"];
const SPARK_BARS = {
  blue: [8, 14, 10, 18, 12, 22, 16, 20],
  green: [10, 16, 12, 20, 14, 18, 24, 15],
  peach: [12, 8, 16, 11, 18, 14, 20, 10],
  violet: [9, 15, 11, 19, 13, 17, 22, 14],
};
const SPARK_COLOR = {
  blue: "#8aafff",
  green: "#8ed4ae",
  peach: "#f3b08a",
  violet: "#c4b5fd",
};

function monthPrepositional(cursor) {
  const name = cursor.toLocaleDateString("ru-RU", { month: "long" });
  return MONTH_PREP[name] || name;
}

function studentsNominative(n) {
  const num = Math.abs(Number(n) || 0);
  const mod10 = num % 10;
  const mod100 = num % 100;
  if (mod10 === 1 && mod100 !== 11) return "ученик";
  if (mod10 >= 2 && mod10 <= 4 && (mod100 < 12 || mod100 > 14)) return "ученика";
  return "учеников";
}

function studentsAfterIz(n) {
  const num = Math.abs(Number(n) || 0);
  const mod10 = num % 10;
  const mod100 = num % 100;
  if (mod10 === 1 && mod100 !== 11) return "ученика";
  return "учеников";
}

function initials(name) {
  const parts = String(name || "").trim().split(/\s+/).filter(Boolean);
  if (!parts.length) return "?";
  if (parts.length === 1) return parts[0].slice(0, 1).toUpperCase();
  return `${parts[0][0]}${parts[1][0]}`.toUpperCase();
}

function avatarTone(name) {
  let hash = 0;
  const value = String(name || "");
  for (let i = 0; i < value.length; i += 1) hash = (hash + value.charCodeAt(i)) % AVATAR_TONES.length;
  return AVATAR_TONES[hash];
}

function changePct(current, previous) {
  const cur = Number(current) || 0;
  const prev = Number(previous) || 0;
  if (prev === 0) return cur === 0 ? 0 : 100;
  return Math.round(((cur - prev) / Math.abs(prev)) * 100);
}

function accountPayKind(account) {
  const dueAmt = studentDue(account);
  const credit = studentCredit(account);
  const unpaid = account?.unpaid_lessons || [];
  const hasPartial = unpaid.some(
    (lesson) => lesson.financial_status === "partially_paid" || lesson.payment_status === "partially_paid",
  );
  if (hasPartial) return "partial";
  if (dueAmt > 0) return "debt";
  if (credit > 0) return "advance";
  return "paid";
}

function statusPresentation(account, currency) {
  const kind = accountPayKind(account);
  const dueAmt = studentDue(account);
  const credit = studentCredit(account);
  if (kind === "advance") {
    return { kind, title: `Аванс: ${formatMoney(credit, currency)}`, note: "На счету ученика" };
  }
  if (kind === "debt") {
    return { kind, title: `К оплате: ${formatMoney(dueAmt, currency)}`, note: "Есть задолженность" };
  }
  if (kind === "partial") {
    return { kind, title: `К оплате: ${formatMoney(dueAmt, currency)}`, note: "Частичная оплата" };
  }
  return { kind: "paid", title: `К оплате: ${formatMoney(0, currency)}`, note: "Задолженности нет" };
}

function detailPresentation(account, currency, monthPrep) {
  const stats = account?.lesson_stats || {};
  const count = Number(stats.conducted_charged_count || 0);
  const chargedAmt = Number(stats.charged_amount ?? account?.charged_total ?? 0);
  const unit = stats.unit_price != null ? Number(stats.unit_price) : null;
  const credit = studentCredit(account);
  let primary = `0 занятий в ${monthPrep}`;
  if (count > 0 && unit != null && unit > 0) {
    primary = `${lessonsWord(count)} × ${formatMoney(unit, currency)} = ${formatMoney(chargedAmt, currency)}`;
  } else if (count > 0) {
    primary = `${lessonsWord(count)} · ${formatMoney(chargedAmt, currency)}`;
  }
  const secondary = credit > 0
    ? `Остаток: ${formatMoney(credit, currency)}`
    : `Баланс: ${formatMoney(0, currency)}`;
  return { primary, secondary };
}

function buildWeekSeries(txs, cursor) {
  const year = cursor.getFullYear();
  const month = cursor.getMonth();
  const last = new Date(year, month + 1, 0).getDate();
  const labels = ["1–7", "8–14", "15–21", `22–${last}`];
  const buckets = labels.map((label) => ({ label, received: 0, charged: 0 }));
  (txs || []).forEach((tx) => {
    if (!tx?.occurred_at || tx.is_reversal || tx.is_reversed) return;
    const dt = new Date(tx.occurred_at);
    if (Number.isNaN(dt.getTime())) return;
    if (dt.getFullYear() !== year || dt.getMonth() !== month) return;
    const day = dt.getDate();
    const idx = day <= 7 ? 0 : day <= 14 ? 1 : day <= 21 ? 2 : 3;
    const amount = Math.abs(Number(tx.amount) || 0);
    if (tx.transaction_type === "payment" || tx.transaction_type === "package_purchase") {
      buckets[idx].received += amount;
    } else if (tx.transaction_type === "charge") {
      buckets[idx].charged += amount;
    }
  });
  return buckets;
}

function niceAxisMax(series) {
  const peak = Math.max(0, ...series.map((bucket) => Math.max(bucket.received, bucket.charged)));
  if (peak <= 0) return 15000;
  const padded = peak * 1.2;
  const pow = 10 ** Math.floor(Math.log10(padded));
  const n = padded / pow;
  const step = n <= 1 ? 1 : n <= 2 ? 2 : n <= 5 ? 5 : 10;
  return step * pow;
}

function formatAxisTick(value) {
  if (value >= 1000) {
    const thousands = value / 1000;
    const text = Number.isInteger(thousands)
      ? String(thousands)
      : thousands.toFixed(1).replace(/\.0$/, "");
    return `${text}K`;
  }
  return String(Math.round(value));
}

function monthQueryRange(cursor) {
  const year = cursor.getFullYear();
  const month = cursor.getMonth() + 1;
  const pad = (n) => String(n).padStart(2, "0");
  const next = new Date(year, month, 1);
  return {
    from: `${year}-${pad(month)}-01`,
    to: `${next.getFullYear()}-${pad(next.getMonth() + 1)}-01`,
  };
}

function MiniBars({ tone }) {
  const bars = SPARK_BARS[tone] || SPARK_BARS.blue;
  const color = SPARK_COLOR[tone] || SPARK_COLOR.blue;
  return (
    <svg className="pay-studio__spark" viewBox="0 0 72 28" aria-hidden="true">
      {bars.map((height, index) => (
        <rect
          key={index}
          x={index * 9}
          y={28 - height}
          width="5"
          height={height}
          rx="1.6"
          fill={color}
          opacity={0.45 + (index % 3) * 0.18}
        />
      ))}
    </svg>
  );
}

function Trend({ value, variant = "up-good" }) {
  const down = variant === "down-muted" || (variant === "down-good" && value <= 0) || (variant === "up-good" && value < 0);
  const mood = variant === "down-muted"
    ? "is-muted"
    : variant === "down-good"
      ? (value > 0 ? "is-bad" : "is-muted")
      : (value < 0 ? "is-bad" : "is-good");
  return (
    <span className={`pay-studio__trend ${mood}`}>
      {down ? "↓" : "↑"} {Math.abs(value)}%
    </span>
  );
}

function StatusDonut({ total, stats }) {
  const parts = [
    { key: "paid", value: stats.paid, color: "#3dcc7a" },
    { key: "partial", value: stats.partial, color: "#3b82f6" },
    { key: "debt", value: stats.debt, color: "#ef5350" },
    { key: "advance", value: stats.advance, color: "#c5cde0" },
  ];
  const sum = parts.reduce((acc, part) => acc + part.value, 0);
  const radius = 46;
  const circ = 2 * Math.PI * radius;
  const gap = parts.filter((part) => part.value > 0).length > 1 ? 5 : 0;
  let offset = 0;
  const arcs = sum === 0 ? [] : parts.filter((part) => part.value > 0).map((part) => {
    const len = Math.max((part.value / sum) * circ - gap, 2);
    const arc = { ...part, len, offset };
    offset += len + gap;
    return arc;
  });

  return (
    <div className="pay-studio__donut-wrap">
      <svg viewBox="0 0 120 120" className="pay-studio__donut" aria-hidden="true">
        <circle cx="60" cy="60" r={radius} fill="none" stroke="#eef2f8" strokeWidth="14" />
        <g transform="rotate(-90 60 60)">
          {arcs.map((arc) => (
            <circle
              key={arc.key}
              cx="60"
              cy="60"
              r={radius}
              fill="none"
              stroke={arc.color}
              strokeWidth="14"
              strokeDasharray={`${arc.len} ${circ}`}
              strokeDashoffset={-arc.offset}
            />
          ))}
        </g>
      </svg>
      <div className="pay-studio__donut-label">
        <strong>{total}</strong>
        <span>{studentsNominative(total)}</span>
      </div>
    </div>
  );
}

function WeekChart({ series }) {
  const max = niceAxisMax(series);
  const ticks = [1, 2 / 3, 1 / 3, 0].map((part) => max * part);
  return (
    <div className="pay-studio__chart">
      <div className="pay-studio__chart-y">
        {ticks.map((tick) => (
          <span key={tick}>{formatAxisTick(tick)}</span>
        ))}
      </div>
      <div className="pay-studio__chart-plot">
        {series.map((bucket) => (
          <div key={bucket.label} className="pay-studio__chart-col">
            <div className="pay-studio__chart-bars">
              <span
                className="is-received"
                style={{ height: `${Math.max((bucket.received / max) * 100, bucket.received > 0 ? 4 : 0)}%` }}
              />
              <span
                className="is-charged"
                style={{ height: `${Math.max((bucket.charged / max) * 100, bucket.charged > 0 ? 4 : 0)}%` }}
              />
            </div>
            <span className="pay-studio__chart-label">{bucket.label}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

function AddMenu({ onPayment, onPackage, onMore }) {
  const [anchor, setAnchor] = useState(null);
  const open = Boolean(anchor);

  return (
    <div className="pay-add-menu">
      <button
        type="button"
        className="pay-btn pay-btn--primary pay-studio__add"
        aria-expanded={open}
        onClick={(e) => setAnchor(open ? null : e.currentTarget)}
      >
        <CabinetIcon name="plus" />
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
  const [prevDashboard, setPrevDashboard] = useState(null);
  const [monthTxs, setMonthTxs] = useState([]);
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
    const range = monthQueryRange(monthCursor);
    const prevMonth = new Date(bounds.year, bounds.month - 2, 1);
    try {
      const [dash, acc, stud, prevDash, txs] = await Promise.all([
        fetchBillingDashboard({ year: bounds.year, month: bounds.month }),
        fetchBillingAccounts({}),
        fetchStudents(),
        fetchBillingDashboard({
          year: prevMonth.getFullYear(),
          month: prevMonth.getMonth() + 1,
        }).catch(() => null),
        fetchBillingTransactions(range).catch(() => []),
      ]);
      setDashboard(dash);
      setPrevDashboard(prevDash);
      setMonthTxs(Array.isArray(txs) ? txs : []);
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

  const monthPrep = monthPrepositional(monthCursor);
  const monthLower = monthSwitcherLabel.replace(/ \d{4}$/, "").replace(/^./, (ch) => ch.toLowerCase());
  const weekSeries = useMemo(() => buildWeekSeries(monthTxs, monthCursor), [monthTxs, monthCursor]);
  const statusStats = useMemo(() => {
    const stats = { paid: 0, partial: 0, debt: 0, advance: 0 };
    accounts.forEach((account) => {
      stats[accountPayKind(account)] += 1;
    });
    return stats;
  }, [accounts]);
  const recentPayments = useMemo(
    () => monthTxs.filter((tx) => (
      (tx.transaction_type === "payment" || tx.transaction_type === "package_purchase")
      && !tx.is_reversal
      && !tx.is_reversed
    )).slice(0, 5),
    [monthTxs],
  );
  const chargedPct = changePct(charged, prevDashboard?.month_charged);
  const receivedPct = changePct(received, prevDashboard?.month_received);
  const duePct = changePct(due, prevDashboard?.unpaid_lessons_amount ?? prevDashboard?.debt_total);
  const creditPct = changePct(creditTotal, prevDashboard?.credit_total);
  const receivedTotal = weekSeries.reduce((sum, bucket) => sum + bucket.received, 0);
  const chargedSeriesTotal = weekSeries.reduce((sum, bucket) => sum + bucket.charged, 0);

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

  return (
    <div className="pay-page pay-studio">
      {error ? <div className="pay-error">{error}</div> : null}
      {toast ? <div className="pay-toast" role="status">{toast}</div> : null}

      <div className="pay-studio__layout">
        <div className="pay-studio__main">
          <header className="pay-studio__top">
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

          <div className="pay-studio__metrics">
            <article className="pay-studio__metric">
              <div className="pay-studio__metric-top">
                <span className="pay-studio__metric-icon is-blue"><CabinetIcon name="chart" /></span>
                <span>Начислено за {monthLower}</span>
              </div>
              <div className="pay-studio__metric-mid">
                <strong>{formatMoney(charged, currency)}</strong>
                <MiniBars tone="blue" />
              </div>
              <p className="pay-studio__metric-foot">
                {charged === 0 ? "Нет начислений в этом месяце" : (
                  <>
                    <Trend value={chargedPct} />
                    <span>к прошлому месяцу</span>
                  </>
                )}
              </p>
            </article>
            <article className="pay-studio__metric">
              <div className="pay-studio__metric-top">
                <span className="pay-studio__metric-icon is-green"><CabinetIcon name="check" /></span>
                <span>Получено</span>
              </div>
              <div className="pay-studio__metric-mid">
                <strong>{formatMoney(received, currency)}</strong>
                <MiniBars tone="green" />
              </div>
              <p className="pay-studio__metric-foot">
                <Trend value={receivedPct} />
                <span>В сравнении с прошлым месяцем</span>
              </p>
            </article>
            <article className="pay-studio__metric">
              <div className="pay-studio__metric-top">
                <span className="pay-studio__metric-icon is-peach"><CabinetIcon name="clock" /></span>
                <span>К оплате</span>
              </div>
              <div className="pay-studio__metric-mid">
                <strong>{formatMoney(due, currency)}</strong>
                <MiniBars tone="peach" />
              </div>
              <p className="pay-studio__metric-foot">
                <Trend value={due === 0 ? 0 : duePct} variant={due > 0 ? "down-good" : "down-muted"} />
                <span>{due > 0 ? "Есть задолженности" : "Нет задолженностей"}</span>
              </p>
            </article>
            <article className="pay-studio__metric">
              <div className="pay-studio__metric-top">
                <span className="pay-studio__metric-icon is-violet"><CabinetIcon name="wallet" /></span>
                <span>Аванс</span>
              </div>
              <div className="pay-studio__metric-mid">
                <strong>{formatMoney(creditTotal, currency)}</strong>
                <MiniBars tone="violet" />
              </div>
              <p className="pay-studio__metric-foot">
                <Trend value={creditPct} />
                <span>Остаток на счету учеников</span>
              </p>
            </article>
          </div>

          <section className="pay-studio__panel">
            <div className="pay-studio__panel-head">
              <div>
                <h2>
                  Ученики
                  <span className="pay-studio__count">{accounts.length}</span>
                </h2>
                <p>Список учеников и их оплаты за {monthLower} {monthCursor.getFullYear()}</p>
              </div>
              <div className="pay-studio__filters">
                <label className="pay-studio__search">
                  <CabinetIcon name="search" />
                  <input
                    placeholder="Поиск ученика..."
                    value={query}
                    onChange={(e) => setQuery(e.target.value)}
                    aria-label="Поиск ученика"
                  />
                </label>
                <select
                  className="pay-studio__select"
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
                  className="pay-studio__select"
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
                <label className="pay-studio__check">
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

            <div className="pay-studio__table" role="table">
              <div className="pay-studio__row pay-studio__row--head" role="row">
                <span role="columnheader">Ученик</span>
                <span role="columnheader">Статус и сумма</span>
                <span role="columnheader">Детали</span>
                <span role="columnheader">Действия</span>
              </div>
              {loading ? <div className="pay-studio__empty">Загрузка…</div> : null}
              {!loading && filteredAccounts.length === 0 ? (
                <div className="pay-studio__empty">
                  {accounts.length === 0
                    ? "Пока нет учеников с оплатами. Добавьте стоимость занятия или оплату."
                    : "Нет учеников по выбранным фильтрам."}
                </div>
              ) : null}
              {!loading && filteredAccounts.map((account) => {
                const status = statusPresentation(account, currency);
                const detail = detailPresentation(account, currency, monthPrep);
                return (
                  <div key={account.id} className="pay-studio__row" role="row">
                    <div className="pay-studio__who" role="cell">
                      <span className={`pay-studio__avatar is-${avatarTone(account.student_name)}`} aria-hidden="true">
                        {initials(account.student_name)}
                      </span>
                      <span className="pay-studio__name">{account.student_name}</span>
                    </div>
                    <div className="pay-studio__status" role="cell">
                      <span className={`pay-studio__chip is-${status.kind}`}>{status.title}</span>
                      <span className="pay-studio__note">{status.note}</span>
                    </div>
                    <div className="pay-studio__detail" role="cell">
                      <span>
                        <CabinetIcon name="calendar" />
                        {detail.primary}
                      </span>
                      <span className="pay-studio__note">{detail.secondary}</span>
                    </div>
                    <div className="pay-studio__actions" role="cell">
                      <button
                        type="button"
                        className="pay-btn pay-btn--sm pay-btn--primary"
                        onClick={() => openPayment(account.student_id)}
                      >
                        Добавить оплату
                      </button>
                      <button
                        type="button"
                        className="pay-btn pay-btn--sm pay-studio__ghost"
                        onClick={() => setDrawerAccount(account)}
                      >
                        <CabinetIcon name="clock" />
                        История
                      </button>
                      <button
                        type="button"
                        className="pay-btn pay-btn--sm pay-studio__ghost"
                        onClick={() => openTerms(account)}
                      >
                        <CabinetIcon name="settings" />
                        Настройки
                      </button>
                    </div>
                  </div>
                );
              })}
            </div>
            {!loading ? (
              <p className="pay-studio__shown">
                Показано {filteredAccounts.length} из {accounts.length} {studentsAfterIz(accounts.length)}
              </p>
            ) : null}
          </section>
        </div>

        <aside className="pay-studio__aside">
          <section className="pay-studio__card">
            <header className="pay-studio__card-head">
              <span className="pay-studio__card-icon is-blue"><CabinetIcon name="chart" /></span>
              <h3>Платежи за {monthLower}</h3>
            </header>
            <WeekChart series={weekSeries} />
            <div className="pay-studio__legend">
              <span><i className="is-received" /> Получено <b>{formatMoney(receivedTotal, currency)}</b></span>
              <span><i className="is-charged" /> Начислено <b>{formatMoney(chargedSeriesTotal, currency)}</b></span>
            </div>
          </section>

          <section className="pay-studio__card">
            <header className="pay-studio__card-head">
              <span className="pay-studio__card-icon is-violet"><CabinetIcon name="chart" /></span>
              <h3>Статусы оплат</h3>
            </header>
            <div className="pay-studio__status-body">
              <StatusDonut total={accounts.length} stats={statusStats} />
              <ul className="pay-studio__status-list">
                <li><i className="is-paid" /> Оплачено <b>{statusStats.paid}</b></li>
                <li><i className="is-partial" /> Частичная оплата <b>{statusStats.partial}</b></li>
                <li><i className="is-debt" /> Задолженность <b>{statusStats.debt}</b></li>
                <li><i className="is-advance" /> Аванс <b>{statusStats.advance}</b></li>
              </ul>
            </div>
          </section>

          <section className="pay-studio__card">
            <header className="pay-studio__card-head">
              <span className="pay-studio__card-icon is-peach"><CabinetIcon name="clock" /></span>
              <h3>Последние оплаты</h3>
            </header>
            {recentPayments.length === 0 ? (
              <div className="pay-studio__empty-pay">
                <span className="pay-studio__doc" aria-hidden="true">
                  <CabinetIcon name="note" />
                </span>
                <strong>Пока нет оплат</strong>
                <p>В этом месяце ещё не было поступлений</p>
              </div>
            ) : (
              <ul className="pay-studio__recent">
                {recentPayments.map((tx) => (
                  <li key={tx.id}>
                    <span className={`pay-studio__avatar is-${avatarTone(tx.student_name)}`} aria-hidden="true">
                      {initials(tx.student_name)}
                    </span>
                    <span className="pay-studio__recent-text">
                      <strong>{tx.student_name || "Оплата"}</strong>
                      <span>{formatShortDate(tx.occurred_at)}</span>
                    </span>
                    <b>{formatMoney(tx.amount, tx.currency || currency)}</b>
                  </li>
                ))}
              </ul>
            )}
          </section>
        </aside>
      </div>

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
