import { useEffect, useMemo, useState } from "react";
import CabinetModal from "./CabinetModal";
import { createBillingPayment, fetchUnresolvedBillingLessons, fetchBillingPackages } from "../../utils/cabinetAuth";
import { formatMoney, formatLessonWhen } from "../billing/billingFormat";
import "../styles/payments.css";

const PURPOSES = [
  { id: "unpaid", label: "Оплата уроков" },
  { id: "package", label: "Оплата абонемента" },
];

export default function BillingPaymentModal({
  open,
  onClose,
  students = [],
  accounts = [],
  defaultStudentId = null,
  defaultAmount = null,
  eventBillingIds = null,
  simple = false,
  onDone,
}) {
  const [studentId, setStudentId] = useState(defaultStudentId || "");
  const [purposeMode, setPurposeMode] = useState("unpaid");
  const [amount, setAmount] = useState("");
  const [paidAt, setPaidAt] = useState("");
  const [comment, setComment] = useState("");
  const [packageId, setPackageId] = useState("");
  const [packages, setPackages] = useState([]);
  const [unpaidLessons, setUnpaidLessons] = useState([]);
  const [selectedLessonIds, setSelectedLessonIds] = useState([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [overpayChoice, setOverpayChoice] = useState(null); // null | 'ask' | 'reduce' | 'advance'

  const lessonLinked = Array.isArray(eventBillingIds) && eventBillingIds.length > 0;
  const selectedAccount = useMemo(
    () => accounts.find((a) => String(a.student_id) === String(studentId)) || null,
    [accounts, studentId],
  );

  const unpaidPackages = useMemo(
    () => packages.filter((p) => (
      String(p.student_id) === String(studentId)
      && ["awaiting_payment", "partially_paid", "active", "ending"].includes(p.display_status || p.status)
      && Number(p.purchase_amount || 0) > Number(p.paid_amount || 0)
    )),
    [packages, studentId],
  );

  const studentUnpaid = useMemo(
    () => unpaidLessons.filter((l) => String(l.student_id) === String(studentId)),
    [unpaidLessons, studentId],
  );

  const selectedDue = useMemo(() => {
    if (purposeMode === "package" && packageId) {
      const pkg = unpaidPackages.find((p) => p.id === packageId);
      if (!pkg) return 0;
      return Math.max(0, Number(pkg.purchase_amount || 0) - Number(pkg.paid_amount || 0));
    }
    const selected = studentUnpaid.filter((l) => selectedLessonIds.includes(l.id || l.record_id));
    return selected.reduce((acc, l) => {
      const due = Math.max(0, Number(l.due_amount ?? (Number(l.charged_amount || l.amount || 0) - Number(l.paid_amount || 0))));
      return acc + due;
    }, 0);
  }, [purposeMode, packageId, unpaidPackages, studentUnpaid, selectedLessonIds]);

  useEffect(() => {
    if (!open) return;
    setStudentId(defaultStudentId || "");
    setAmount(defaultAmount != null && defaultAmount !== "" ? String(defaultAmount) : "");
    setPaidAt(new Date().toISOString().slice(0, 10));
    setComment("");
    setPackageId("");
    setSelectedLessonIds(lessonLinked ? [...eventBillingIds] : []);
    setPurposeMode(lessonLinked ? "unpaid" : "unpaid");
    setError("");
    setOverpayChoice(null);
    Promise.all([
      fetchBillingPackages().catch(() => []),
      fetchUnresolvedBillingLessons().catch(() => []),
    ]).then(([pkgs, lessons]) => {
      const pkgList = Array.isArray(pkgs) ? pkgs : [];
      const lessonList = Array.isArray(lessons) ? lessons : [];
      setPackages(pkgList);
      setUnpaidLessons(lessonList);

      // Если есть незакрытый абонемент и нет неоплаченных уроков — сразу «Оплата абонемента».
      if (!lessonLinked && defaultStudentId) {
        const sid = String(defaultStudentId);
        const hasUnpaidLessons = lessonList.some((l) => String(l.student_id) === sid);
        const hasUnpaidPkg = pkgList.some((p) => (
          String(p.student_id) === sid
          && ["awaiting_payment", "partially_paid"].includes(p.display_status || "")
          && Number(p.purchase_amount || 0) > Number(p.paid_amount || 0)
        ));
        if (hasUnpaidPkg && !hasUnpaidLessons) {
          setPurposeMode("package");
        }
      }
    });
  }, [open, defaultStudentId, defaultAmount, lessonLinked]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (!open || !studentId) return;
    if (purposeMode === "package" && unpaidPackages.length === 1) {
      const pkg = unpaidPackages[0];
      setPackageId(pkg.id);
      const due = Math.max(0, Number(pkg.purchase_amount || 0) - Number(pkg.paid_amount || 0));
      if (due > 0 && !defaultAmount) setAmount(String(due));
    }
    if (purposeMode === "unpaid" && !lessonLinked && studentUnpaid.length && !selectedLessonIds.length) {
      setSelectedLessonIds(studentUnpaid.map((l) => l.id || l.record_id));
    }
  }, [studentId, purposeMode, unpaidPackages.length, studentUnpaid.length]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (purposeMode !== "unpaid" || lessonLinked) return;
    if (selectedDue > 0) setAmount(String(selectedDue));
  }, [selectedDue, purposeMode, lessonLinked]);

  if (!open) return null;

  const toggleLesson = (id) => {
    setSelectedLessonIds((prev) => (
      prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]
    ));
  };

  const submit = async ({ forceAdvance = false } = {}) => {
    if (!studentId) {
      setError("Выберите ученика");
      return;
    }
    if (!amount || Number(amount) <= 0) {
      setError("Укажите сумму");
      return;
    }

    const amountNum = Number(amount);
    if (purposeMode === "unpaid" && selectedDue > 0 && amountNum > selectedDue + 0.009 && !forceAdvance && overpayChoice !== "advance") {
      setOverpayChoice("ask");
      return;
    }
    if (overpayChoice === "reduce") {
      setAmount(String(selectedDue));
      setOverpayChoice(null);
      return;
    }

    setBusy(true);
    setError("");
    try {
      const purpose = PURPOSES.find((p) => p.id === purposeMode)?.label || "";
      const payload = {
        student_id: Number(studentId),
        amount: overpayChoice === "reduce" ? String(selectedDue) : amount,
        paid_at: paidAt || undefined,
        purpose: simple ? "Оплата" : purpose,
        comment,
      };
      if (!simple && purposeMode === "package" && packageId) {
        payload.package_id = packageId;
      }
      if (!simple && purposeMode === "unpaid") {
        const ids = lessonLinked ? eventBillingIds : selectedLessonIds;
        if (ids?.length) payload.event_billing_ids = ids;
      }
      await createBillingPayment(payload);

      const paid = Number(payload.amount);
      const closedDebt = purposeMode === "unpaid" && selectedDue > 0 && paid + 0.009 >= selectedDue;
      const partialLeft = purposeMode === "unpaid" && selectedDue > paid
        ? selectedDue - paid
        : 0;

      onDone?.({
        studentId: studentId || defaultStudentId,
        closedDebt,
        partialLeft,
        message: partialLeft > 0
          ? `Осталось оплатить −${formatMoney(partialLeft, selectedAccount?.currency).replace(/ ₽$/, "")} ₽`
          : undefined,
      });
      onClose?.();
    } catch (err) {
      setError(err.message || "Не удалось сохранить оплату");
    } finally {
      setBusy(false);
      setOverpayChoice(null);
    }
  };

  return (
    <CabinetModal onClose={onClose} title="Добавить оплату">
      <div className="pay-modal-form">
        {error ? <div className="pay-error">{error}</div> : null}

        {overpayChoice === "ask" ? (
          <div className="pay-overpay">
            <p>Сумма больше выбранной задолженности ({formatMoney(selectedDue, selectedAccount?.currency)}).</p>
            <div className="pay-actions">
              <button
                type="button"
                className="pay-btn"
                onClick={() => {
                  setAmount(String(selectedDue));
                  setOverpayChoice(null);
                }}
              >
                Уменьшить сумму
              </button>
              <button
                type="button"
                className="pay-btn pay-btn--primary"
                onClick={() => {
                  setOverpayChoice("advance");
                  void submit({ forceAdvance: true });
                }}
              >
                Сохранить остаток как аванс
              </button>
            </div>
          </div>
        ) : null}

        <div className="pay-field">
          <label>Ученик</label>
          <select className="pay-select" value={studentId} onChange={(e) => setStudentId(e.target.value)}>
            <option value="">Выберите ученика</option>
            {students.map((s) => (
              <option key={s.id} value={s.id}>{s.name || s.full_name || s.student_name}</option>
            ))}
          </select>
        </div>

        {simple ? null : (
        <>
        <div className="pay-field">
          <label>Назначение</label>
          <div className="pay-chip-row">
            {PURPOSES.map((p) => (
              <button
                key={p.id}
                type="button"
                className={`pay-chip${purposeMode === p.id ? " pay-chip--active" : ""}`}
                onClick={() => setPurposeMode(p.id)}
              >
                {p.label}
              </button>
            ))}
          </div>
        </div>

        {purposeMode === "package" ? (
          <div className="pay-field">
            <label>Абонемент</label>
            {unpaidPackages.length === 0 ? (
              <p className="pay-hint">Нет абонементов, ожидающих оплаты.</p>
            ) : (
              <div className="pay-radio-list">
                {unpaidPackages.map((pkg) => {
                  const due = Math.max(0, Number(pkg.purchase_amount || 0) - Number(pkg.paid_amount || 0));
                  return (
                    <label key={pkg.id} className="pay-radio-row">
                      <input
                        type="radio"
                        name="pkg"
                        checked={packageId === pkg.id}
                        onChange={() => {
                          setPackageId(pkg.id);
                          if (due > 0) setAmount(String(due));
                        }}
                      />
                      <span>
                        {pkg.title || "Абонемент"}
                        {" — осталось "}
                        {formatMoney(due, selectedAccount?.currency)}
                      </span>
                    </label>
                  );
                })}
              </div>
            )}
          </div>
        ) : null}

        {purposeMode === "unpaid" && !lessonLinked ? (
          <div className="pay-field">
            <label>Какие уроки оплачиваются</label>
            {studentUnpaid.length === 0 ? (
              <p className="pay-hint">Нет неоплаченных уроков у этого ученика.</p>
            ) : (
              <div className="pay-check-list">
                {studentUnpaid.map((lesson) => {
                  const id = lesson.id || lesson.record_id;
                  const due = Math.max(
                    0,
                    Number(lesson.due_amount ?? (Number(lesson.charged_amount || lesson.amount || 0) - Number(lesson.paid_amount || 0))),
                  );
                  return (
                    <label key={id} className="pay-radio-row">
                      <input
                        type="checkbox"
                        checked={selectedLessonIds.includes(id)}
                        onChange={() => toggleLesson(id)}
                      />
                      <span>
                        {formatLessonWhen(lesson.event_starts_at || lesson.starts_at || lesson.occurred_at || lesson.finalized_at)}
                        {" · "}
                        {formatMoney(due, lesson.currency)}
                      </span>
                    </label>
                  );
                })}
              </div>
            )}
          </div>
        ) : null}
        </>
        )}

        <div className="pay-field-row">
          <div className="pay-field">
            <label>Сумма, ₽</label>
            <input
              className="pay-input"
              type="number"
              min="0"
              step="1"
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
            />
          </div>
          <div className="pay-field">
            <label>Дата</label>
            <input
              className="pay-input"
              type={simple ? "date" : "datetime-local"}
              value={paidAt}
              onChange={(e) => setPaidAt(e.target.value)}
            />
          </div>
        </div>

        <div className="pay-field">
          <label>Комментарий <span className="pay-optional">необязательно</span></label>
          <textarea className="pay-input" rows={2} value={comment} onChange={(e) => setComment(e.target.value)} />
        </div>

        <div className="pay-actions">
          <button type="button" className="pay-btn" onClick={onClose} disabled={busy}>Отмена</button>
          <button type="button" className="pay-btn pay-btn--primary" onClick={() => void submit()} disabled={busy}>
            {busy ? "Сохранение…" : "Сохранить"}
          </button>
        </div>
      </div>
    </CabinetModal>
  );
}
