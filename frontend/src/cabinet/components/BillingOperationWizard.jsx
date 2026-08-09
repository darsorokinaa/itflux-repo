import { useEffect, useMemo, useState } from "react";
import CabinetModal from "./CabinetModal";
import {
  chargeAccountFromPackage,
  consumeBillingPackage,
  createBillingAdjustment,
  createBillingPackage,
  createBillingPayment,
  createBillingRefund,
  fetchBillingPackages,
  fetchUnresolvedBillingLessons,
} from "../../utils/cabinetAuth";
import { formatLessonWhen, formatMoney, formatUnits } from "../billing/billingFormat";
import "../styles/payments.css";

const OP_TYPES = [
  { id: "lessons", label: "Оплата уроков", hint: "Один или несколько проведённых уроков" },
  { id: "advance", label: "Аванс / предоплата", hint: "Деньги до урока, без привязки" },
  { id: "package_buy", label: "Покупка абонемента", hint: "Создать абонемент и при необходимости покрыть прошлые" },
  { id: "package_pay", label: "Доплата за абонемент", hint: "Частичная оплата существующего абонемента" },
  { id: "package_charge", label: "Списать из абонемента", hint: "Урок вне расписания, пропуск или погашение долга" },
  { id: "refund", label: "Возврат", hint: "Вернуть деньги ученику" },
  { id: "adjustment", label: "Корректировка", hint: "Ручная правка баланса с комментарием" },
];

const STEPS = ["Ученик", "Тип", "Детали", "Подтверждение"];
const METHODS = [
  { id: "transfer", label: "Перевод" },
  { id: "sbp", label: "СБП" },
  { id: "cash", label: "Наличные" },
  { id: "card", label: "Карта" },
  { id: "other", label: "Другое" },
];

function WizardSteps({ step }) {
  return (
    <div className="pay-wizard-steps" aria-hidden="true">
      {STEPS.map((label, idx) => {
        const n = idx + 1;
        const cls = n < step ? "pay-wizard-step pay-wizard-step--done"
          : n === step ? "pay-wizard-step pay-wizard-step--active"
            : "pay-wizard-step";
        return <span key={label} className={cls}>{n}. {label}</span>;
      })}
    </div>
  );
}

/**
 * Единый мастер финансовых операций: оплата, абонемент, возврат, корректировка.
 */
export default function BillingOperationWizard({
  open,
  onClose,
  students = [],
  accounts = [],
  defaultStudentId = null,
  defaultOpType = null,
  defaultAmount = null,
  eventBillingIds = null,
  onDone,
}) {
  const [step, setStep] = useState(1);
  const [studentId, setStudentId] = useState(defaultStudentId || "");
  const [opType, setOpType] = useState(defaultOpType || "");
  const [amount, setAmount] = useState("");
  const [paidAt, setPaidAt] = useState("");
  const [method, setMethod] = useState("transfer");
  const [comment, setComment] = useState("");
  const [packages, setPackages] = useState([]);
  const [unpaidLessons, setUnpaidLessons] = useState([]);
  const [selectedLessonIds, setSelectedLessonIds] = useState([]);
  const [packageId, setPackageId] = useState("");
  const [pkgUnits, setPkgUnits] = useState("8");
  const [pkgDuration, setPkgDuration] = useState("60");
  const [coverPast, setCoverPast] = useState(null); // null | 'past' | 'future'
  const [selectedCoverIds, setSelectedCoverIds] = useState([]);
  const [chargeMode, setChargeMode] = useState("manual"); // lessons | manual
  const [chargeUnits, setChargeUnits] = useState("1");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [overpayChoice, setOverpayChoice] = useState(null);

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

  const chargeablePackages = useMemo(
    () => packages.filter((p) => (
      String(p.student_id) === String(studentId)
      && Number(p.remaining_units || 0) > 0
      && !["cancelled", "frozen"].includes(p.status)
    )),
    [packages, studentId],
  );

  const studentUnpaid = useMemo(
    () => unpaidLessons.filter((l) => String(l.student_id) === String(studentId)),
    [unpaidLessons, studentId],
  );

  const selectedDue = useMemo(() => {
    if (opType === "package_pay" && packageId) {
      const pkg = unpaidPackages.find((p) => p.id === packageId);
      if (!pkg) return 0;
      return Math.max(0, Number(pkg.purchase_amount || 0) - Number(pkg.paid_amount || 0));
    }
    if (opType !== "lessons") return 0;
    return studentUnpaid
      .filter((l) => selectedLessonIds.includes(l.id || l.record_id))
      .reduce((acc, l) => {
        const due = Math.max(0, Number(l.due_amount ?? (Number(l.charged_amount || l.amount || 0) - Number(l.paid_amount || 0))));
        return acc + due;
      }, 0);
  }, [opType, packageId, unpaidPackages, studentUnpaid, selectedLessonIds]);

  const hasUnpaidForCover = studentUnpaid.length > 0;

  useEffect(() => {
    if (!open) return;
    setStep(defaultStudentId ? (defaultOpType ? 3 : 2) : 1);
    setStudentId(defaultStudentId || "");
    setOpType(defaultOpType || (lessonLinked ? "lessons" : ""));
    setAmount(defaultAmount != null && defaultAmount !== "" ? String(defaultAmount) : "");
    setPaidAt(new Date().toISOString().slice(0, 10));
    setMethod("transfer");
    setComment("");
    setPackageId("");
    setPkgUnits("8");
    setPkgDuration("60");
    setCoverPast(null);
    setSelectedCoverIds([]);
    setChargeMode("manual");
    setChargeUnits("1");
    setSelectedLessonIds(lessonLinked ? [...eventBillingIds] : []);
    setError("");
    setOverpayChoice(null);
    Promise.all([
      fetchBillingPackages().catch(() => []),
      fetchUnresolvedBillingLessons().catch(() => []),
    ]).then(([pkgs, lessons]) => {
      setPackages(Array.isArray(pkgs) ? pkgs : []);
      setUnpaidLessons(Array.isArray(lessons) ? lessons : []);
    });
  }, [open, defaultStudentId, defaultAmount, defaultOpType, lessonLinked]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (!open || !studentId) return;
    if (opType === "package_pay" && unpaidPackages.length === 1) {
      const pkg = unpaidPackages[0];
      setPackageId(pkg.id);
      const due = Math.max(0, Number(pkg.purchase_amount || 0) - Number(pkg.paid_amount || 0));
      if (due > 0 && !defaultAmount) setAmount(String(due));
    }
    if (opType === "package_charge") {
      if (chargeablePackages.length === 1 && !packageId) {
        setPackageId(chargeablePackages[0].id);
      }
      if (studentUnpaid.length > 0 && chargeMode === "lessons" && !selectedLessonIds.length) {
        setSelectedLessonIds(studentUnpaid.map((l) => l.id || l.record_id));
      }
    }
    if (opType === "lessons" && !lessonLinked && studentUnpaid.length && !selectedLessonIds.length) {
      setSelectedLessonIds(studentUnpaid.map((l) => l.id || l.record_id));
    }
    if (opType === "package_buy" && hasUnpaidForCover && coverPast === null) {
      setCoverPast("past");
      setSelectedCoverIds(studentUnpaid.map((l) => String(l.id || l.record_id)));
    }
  }, [studentId, opType, unpaidPackages.length, studentUnpaid.length, chargeablePackages.length, open]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (opType === "lessons" && !lessonLinked && selectedDue > 0) setAmount(String(selectedDue));
  }, [selectedDue, opType, lessonLinked]);

  if (!open) return null;

  const title = {
    lessons: "Оплата уроков",
    advance: "Аванс / предоплата",
    package_buy: "Покупка абонемента",
    package_pay: "Доплата за абонемент",
    package_charge: "Списать из абонемента",
    refund: "Возврат",
    adjustment: "Корректировка",
  }[opType] || "Финансовая операция";

  const goNext = () => {
    setError("");
    if (step === 1 && !studentId) {
      setError("Выберите ученика");
      return;
    }
    if (step === 2 && !opType) {
      setError("Выберите тип операции");
      return;
    }
    if (step === 3) {
      if (opType === "package_charge") {
        if (!packageId) {
          setError("Выберите абонемент");
          return;
        }
        if (chargeMode === "lessons" && !selectedLessonIds.length) {
          setError("Выберите уроки или спишите вручную");
          return;
        }
        if (chargeMode === "manual" && (!chargeUnits || Number(chargeUnits) <= 0)) {
          setError("Укажите количество занятий");
          return;
        }
        if (chargeMode === "manual" && !String(comment || "").trim()) {
          setError("Укажите причину списания");
          return;
        }
      } else if (["lessons", "advance", "package_pay", "package_buy", "refund"].includes(opType)) {
        if ((!amount || Number(amount) <= 0) && opType !== "package_buy") {
          // package_buy may have amount 0 if await payment, but we require amount for clarity
        }
        if (opType === "package_buy" && (!pkgUnits || Number(pkgUnits) <= 0)) {
          setError("Укажите количество занятий");
          return;
        }
        if (opType !== "package_buy" && opType !== "adjustment" && (!amount || Number(amount) <= 0)) {
          setError("Укажите сумму");
          return;
        }
        if (opType === "adjustment" && (amount === "" || Number.isNaN(Number(amount)) || Number(amount) === 0)) {
          setError("Укажите сумму корректировки (можно отрицательную)");
          return;
        }
        if (opType === "adjustment" && !String(comment || "").trim()) {
          setError("Для корректировки нужен комментарий");
          return;
        }
        if (opType === "lessons" && !lessonLinked && !selectedLessonIds.length && studentUnpaid.length) {
          setError("Выберите уроки или оформите аванс");
          return;
        }
        if (opType === "package_pay" && !packageId) {
          setError("Выберите абонемент");
          return;
        }
        if (opType === "package_buy" && hasUnpaidForCover && !coverPast) {
          setError("Укажите, покрывать ли прошлые уроки");
          return;
        }
      }
    }
    setStep((s) => Math.min(4, s + 1));
  };

  const submit = async ({ forceAdvance = false } = {}) => {
    const amountNum = Number(amount);
    if (opType === "lessons" && selectedDue > 0 && amountNum > selectedDue + 0.009 && !forceAdvance && overpayChoice !== "advance") {
      setOverpayChoice("ask");
      return;
    }

    setBusy(true);
    setError("");
    try {
      let meta = { studentId };
      if (opType === "lessons" || opType === "advance") {
        const payload = {
          student_id: Number(studentId),
          amount: overpayChoice === "reduce" ? String(selectedDue) : amount,
          paid_at: paidAt || undefined,
          method,
          purpose: opType === "advance" ? "Аванс" : "Оплата уроков",
          comment,
        };
        if (opType === "lessons") {
          const ids = lessonLinked ? eventBillingIds : selectedLessonIds;
          if (ids?.length) payload.event_billing_ids = ids;
        }
        await createBillingPayment(payload);
        const paid = Number(payload.amount);
        const closedDebt = opType === "lessons" && selectedDue > 0 && paid + 0.009 >= selectedDue;
        meta = {
          ...meta,
          closedDebt,
          message: opType === "advance"
            ? "Аванс сохранён — закроет следующий урок автоматически"
            : undefined,
        };
      } else if (opType === "package_pay") {
        await createBillingPayment({
          student_id: Number(studentId),
          amount,
          paid_at: paidAt || undefined,
          method,
          purpose: "Оплата абонемента",
          comment,
          package_id: packageId,
        });
        meta.message = "Доплата по абонементу сохранена";
      } else if (opType === "package_buy") {
        const unitsNum = Number(pkgUnits) || 0;
        const amountNumLocal = Number(amount) || 0;
        const durationLabel = pkgDuration ? `${pkgDuration} мин` : "";
        const titleText = amountNumLocal > 0
          ? `${unitsNum} занятий · ${formatMoney(amountNumLocal)}`
          : `Абонемент на ${unitsNum} занятий${durationLabel ? ` по ${durationLabel}` : ""}`;
        const payload = {
          student_id: Number(studentId),
          title: titleText,
          unit_type: "lesson",
          total_units: String(unitsNum),
          purchase_amount: amount || "0",
          starts_at: paidAt || null,
          lesson_duration_minutes: pkgDuration ? Number(pkgDuration) : null,
          auto_use: true,
          await_payment: amountNumLocal <= 0,
          notes: comment,
        };
        if (coverPast === "past" && hasUnpaidForCover) {
          payload.cover_past_unpaid = true;
          if (selectedCoverIds.length) payload.event_billing_ids = selectedCoverIds;
        }
        const pkg = await createBillingPackage(payload);
        meta = {
          ...meta,
          message: pkg?.covered_past_count
            ? `Абонемент создан, покрыто прошлых уроков: ${pkg.covered_past_count}`
            : "Абонемент создан",
        };
      } else if (opType === "package_charge") {
        if (chargeMode === "lessons") {
          const accountId = selectedAccount?.id;
          if (!accountId) throw new Error("Не найден счёт ученика");
          const result = await chargeAccountFromPackage(accountId, {
            package_id: packageId,
            event_billing_ids: selectedLessonIds,
            comment,
            idempotency_key: `wizard-settle-${accountId}-${packageId}-${[...selectedLessonIds].sort().join(",")}`,
          });
          meta.message = result?.message || `Списано уроков: ${result?.charged_count || selectedLessonIds.length}`;
        } else {
          const result = await consumeBillingPackage(packageId, {
            units: String(chargeUnits),
            comment: comment.trim(),
          });
          meta.message = result?.message || "Списание из абонемента сохранено";
        }
      } else if (opType === "refund") {
        await createBillingRefund({
          student_id: Number(studentId),
          amount,
          comment: comment || "Возврат",
        });
        meta.message = "Возврат записан";
      } else if (opType === "adjustment") {
        await createBillingAdjustment({
          student_id: Number(studentId),
          amount,
          comment: comment || "Ручная корректировка",
        });
        meta.message = "Корректировка сохранена";
      }
      onDone?.(meta);
      onClose?.();
    } catch (err) {
      setError(err.message || "Не удалось выполнить операцию");
      setStep(3);
    } finally {
      setBusy(false);
      setOverpayChoice(null);
    }
  };

  const studentName = students.find((s) => String(s.id) === String(studentId))?.name
    || selectedAccount?.student_name
    || "Ученик";

  return (
    <CabinetModal onClose={onClose} title={step > 2 ? title : "Финансовая операция"}>
      <div className="pay-modal-form">
        <WizardSteps step={step} />
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

        {step === 1 ? (
          <div className="pay-field">
            <label>Ученик</label>
            <select className="pay-select" value={studentId} onChange={(e) => setStudentId(e.target.value)}>
              <option value="">Выберите ученика</option>
              {students.map((s) => (
                <option key={s.id} value={s.id}>{s.name || s.full_name || s.student_name}</option>
              ))}
            </select>
          </div>
        ) : null}

        {step === 2 ? (
          <div className="pay-op-type-grid">
            {OP_TYPES.map((t) => (
              <button
                key={t.id}
                type="button"
                className={`pay-op-type${opType === t.id ? " pay-op-type--active" : ""}`}
                onClick={() => setOpType(t.id)}
              >
                <strong>{t.label}</strong>
                <span>{t.hint}</span>
              </button>
            ))}
          </div>
        ) : null}

        {step === 3 && opType === "lessons" ? (
          <>
            {!lessonLinked ? (
              <div className="pay-field">
                <label>Какие уроки оплачиваются</label>
                {studentUnpaid.length === 0 ? (
                  <p className="pay-hint">Нет неоплаченных уроков — оформите аванс или выберите другой тип.</p>
                ) : (
                  <div className="pay-check-list">
                    {studentUnpaid.map((lesson) => {
                      const id = lesson.id || lesson.record_id;
                      const due = Math.max(0, Number(lesson.due_amount ?? (Number(lesson.charged_amount || 0) - Number(lesson.paid_amount || 0))));
                      return (
                        <label key={id} className="pay-radio-row">
                          <input
                            type="checkbox"
                            checked={selectedLessonIds.includes(id)}
                            onChange={() => {
                              setSelectedLessonIds((prev) => (
                                prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]
                              ));
                            }}
                          />
                          <span>
                            {formatLessonWhen(lesson.event_starts_at)}
                            {" — "}
                            {formatMoney(due, selectedAccount?.currency)}
                          </span>
                        </label>
                      );
                    })}
                  </div>
                )}
              </div>
            ) : (
              <p className="pay-hint">Оплата привязана к выбранному уроку.</p>
            )}
          </>
        ) : null}

        {step === 3 && opType === "package_pay" ? (
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
                        {" · "}
                        {formatUnits(pkg.remaining_units, pkg.unit_type)}
                      </span>
                    </label>
                  );
                })}
              </div>
            )}
          </div>
        ) : null}

        {step === 3 && opType === "package_charge" ? (
          <>
            <div className="pay-field">
              <label>Абонемент</label>
              {chargeablePackages.length === 0 ? (
                <p className="pay-hint">Нет абонемента с остатком занятий.</p>
              ) : (
                <div className="pay-radio-list">
                  {chargeablePackages.map((pkg) => (
                    <label key={pkg.id} className="pay-radio-row">
                      <input
                        type="radio"
                        name="charge-pkg"
                        checked={String(packageId) === String(pkg.id)}
                        onChange={() => setPackageId(pkg.id)}
                      />
                      <span>
                        {pkg.title || "Абонемент"}
                        {" — остаток "}
                        {formatUnits(pkg.remaining_units, pkg.unit_type)}
                      </span>
                    </label>
                  ))}
                </div>
              )}
            </div>
            <div className="pay-field">
              <label>Что списать</label>
              <div className="pay-cover-choice">
                <label className={chargeMode === "manual" ? "is-active" : ""}>
                  <input
                    type="radio"
                    name="charge-mode"
                    checked={chargeMode === "manual"}
                    onChange={() => setChargeMode("manual")}
                  />
                  <span>
                    <strong>Без урока в расписании</strong>
                    <em>Урок в другом месте или пропуск, который нужно списать</em>
                  </span>
                </label>
                <label className={chargeMode === "lessons" ? "is-active" : ""}>
                  <input
                    type="radio"
                    name="charge-mode"
                    checked={chargeMode === "lessons"}
                    disabled={studentUnpaid.length === 0}
                    onChange={() => {
                      setChargeMode("lessons");
                      if (!selectedLessonIds.length) {
                        setSelectedLessonIds(studentUnpaid.map((l) => l.id || l.record_id));
                      }
                    }}
                  />
                  <span>
                    <strong>Неоплаченные уроки из расписания</strong>
                    <em>
                      {studentUnpaid.length > 0
                        ? `Погасить ${studentUnpaid.length} уроков абонементом`
                        : "Неоплаченных уроков нет"}
                    </em>
                  </span>
                </label>
              </div>
            </div>
            {chargeMode === "manual" ? (
              <div className="pay-field">
                <label>Количество занятий</label>
                <div className="pay-chip-row">
                  {[1, 2, 3].map((n) => (
                    <button
                      key={n}
                      type="button"
                      className={`pay-chip${chargeUnits === String(n) ? " pay-chip--active" : ""}`}
                      onClick={() => setChargeUnits(String(n))}
                    >
                      {n}
                    </button>
                  ))}
                </div>
                <input
                  className="pay-input"
                  type="number"
                  min="0.5"
                  step="0.5"
                  value={chargeUnits}
                  onChange={(e) => setChargeUnits(e.target.value)}
                  style={{ marginTop: 8 }}
                />
              </div>
            ) : (
              <div className="pay-field">
                <label>Уроки</label>
                <div className="pay-check-list">
                  {studentUnpaid.map((lesson) => {
                    const id = lesson.id || lesson.record_id;
                    return (
                      <label key={id} className="pay-radio-row">
                        <input
                          type="checkbox"
                          checked={selectedLessonIds.includes(id)}
                          onChange={() => {
                            setSelectedLessonIds((prev) => (
                              prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]
                            ));
                          }}
                        />
                        <span>{formatLessonWhen(lesson.event_starts_at)}</span>
                      </label>
                    );
                  })}
                </div>
              </div>
            )}
            <div className="pay-field">
              <label>Комментарий{chargeMode === "manual" ? " *" : ""}</label>
              <textarea
                className="pay-textarea"
                value={comment}
                onChange={(e) => setComment(e.target.value)}
                placeholder={chargeMode === "manual"
                  ? "Например: урок вне кабинета / пропуск 12.03"
                  : "Необязательно"}
              />
            </div>
          </>
        ) : null}

        {step === 3 && opType === "package_buy" ? (
          <>
            <div className="pay-field">
              <label>Количество занятий</label>
              <div className="pay-chip-row">
                {[4, 8, 12].map((n) => (
                  <button
                    key={n}
                    type="button"
                    className={`pay-chip${pkgUnits === String(n) ? " pay-chip--active" : ""}`}
                    onClick={() => setPkgUnits(String(n))}
                  >
                    {n}
                  </button>
                ))}
              </div>
              <input
                className="pay-input"
                type="number"
                min="1"
                value={pkgUnits}
                onChange={(e) => setPkgUnits(e.target.value)}
                style={{ marginTop: 8 }}
              />
            </div>
            <div className="pay-field">
              <label>Длительность занятия</label>
              <div className="pay-chip-row">
                {[45, 60, 90].map((n) => (
                  <button
                    key={n}
                    type="button"
                    className={`pay-chip${pkgDuration === String(n) ? " pay-chip--active" : ""}`}
                    onClick={() => setPkgDuration(String(n))}
                  >
                    {n} мин
                  </button>
                ))}
              </div>
            </div>
            {hasUnpaidForCover ? (
              <div className="pay-field">
                <label>Прошлые неоплаченные уроки ({studentUnpaid.length})</label>
                <div className="pay-cover-choice">
                  <label className={coverPast === "past" ? "is-active" : ""}>
                    <input
                      type="radio"
                      name="cover"
                      checked={coverPast === "past"}
                      onChange={() => {
                        setCoverPast("past");
                        setSelectedCoverIds(studentUnpaid.map((l) => String(l.id || l.record_id)));
                      }}
                    />
                    <span>
                      <strong>Покрыть прошлые уроки этим абонементом</strong>
                      <em>Задним числом списать занятия с самых ранних неоплаченных</em>
                    </span>
                  </label>
                  <label className={coverPast === "future" ? "is-active" : ""}>
                    <input
                      type="radio"
                      name="cover"
                      checked={coverPast === "future"}
                      onChange={() => setCoverPast("future")}
                    />
                    <span>
                      <strong>Только для будущих уроков</strong>
                      <em>Долг по прошлым урокам останется — погасите отдельно</em>
                    </span>
                  </label>
                </div>
                {coverPast === "past" ? (
                  <div className="pay-check-list" style={{ marginTop: 10 }}>
                    {studentUnpaid.map((lesson) => {
                      const id = String(lesson.id || lesson.record_id);
                      return (
                        <label key={id} className="pay-radio-row">
                          <input
                            type="checkbox"
                            checked={selectedCoverIds.includes(id)}
                            onChange={() => {
                              setSelectedCoverIds((prev) => (
                                prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]
                              ));
                            }}
                          />
                          <span>{formatLessonWhen(lesson.event_starts_at)}</span>
                        </label>
                      );
                    })}
                  </div>
                ) : null}
              </div>
            ) : null}
          </>
        ) : null}

        {step === 3 && ["lessons", "advance", "package_pay", "package_buy", "refund", "adjustment"].includes(opType) ? (
          <>
            <div className="pay-form-grid">
              <label>
                Сумма, ₽
                <input
                  className="pay-input"
                  type="number"
                  step="0.01"
                  value={amount}
                  onChange={(e) => setAmount(e.target.value)}
                  placeholder={opType === "adjustment" ? "+/− сумма" : "0"}
                />
              </label>
              {opType !== "adjustment" && opType !== "refund" ? (
                <label>
                  Дата
                  <input
                    className="pay-input"
                    type="date"
                    value={paidAt}
                    onChange={(e) => setPaidAt(e.target.value)}
                  />
                </label>
              ) : (
                <label>
                  &nbsp;
                  <span className="pay-hint" style={{ display: "block", paddingTop: 10 }}>
                    {opType === "adjustment" ? "Плюс — кредит, минус — долг" : "Сумма возврата"}
                  </span>
                </label>
              )}
            </div>
            {opType !== "adjustment" && opType !== "refund" ? (
              <div className="pay-field">
                <label>Способ оплаты</label>
                <select className="pay-select" value={method} onChange={(e) => setMethod(e.target.value)}>
                  {METHODS.map((m) => (
                    <option key={m.id} value={m.id}>{m.label}</option>
                  ))}
                </select>
              </div>
            ) : null}
            <div className="pay-field">
              <label>Комментарий{opType === "adjustment" ? " *" : ""}</label>
              <textarea
                className="pay-textarea"
                value={comment}
                onChange={(e) => setComment(e.target.value)}
                placeholder="Например: перевод от мамы, ошибка в сумме…"
              />
            </div>
          </>
        ) : null}

        {step === 4 ? (
          <div className="pay-drawer-section">
            <ul className="pay-drawer-facts">
              <li><span>Ученик</span><strong>{studentName}</strong></li>
              <li><span>Операция</span><strong>{title}</strong></li>
              {opType === "package_buy" ? (
                <li><span>Занятий</span><strong>{pkgUnits}</strong></li>
              ) : null}
              {opType === "package_charge" ? (
                <>
                  <li>
                    <span>Режим</span>
                    <strong>
                      {chargeMode === "manual" ? "Без урока в расписании" : "Неоплаченные уроки"}
                    </strong>
                  </li>
                  <li>
                    <span>Списать</span>
                    <strong>
                      {chargeMode === "manual"
                        ? formatUnits(chargeUnits, "lesson")
                        : `${selectedLessonIds.length} уроков`}
                    </strong>
                  </li>
                </>
              ) : null}
              {opType !== "package_charge" ? (
                <li>
                  <span>Сумма</span>
                  <strong>{amount ? formatMoney(amount, selectedAccount?.currency) : "—"}</strong>
                </li>
              ) : null}
              {opType === "package_buy" && coverPast === "past" ? (
                <li>
                  <span>Покрытие прошлых</span>
                  <strong>{selectedCoverIds.length || studentUnpaid.length} уроков</strong>
                </li>
              ) : null}
              {opType === "package_buy" && coverPast === "future" ? (
                <li><span>Покрытие</span><strong>Только будущие уроки</strong></li>
              ) : null}
              {comment ? <li><span>Комментарий</span><strong>{comment}</strong></li> : null}
            </ul>
            {(opType === "refund" || opType === "adjustment" || opType === "package_charge") ? (
              <p className="pay-warn-box">
                {opType === "package_charge"
                  ? "Списание уменьшит остаток абонемента и попадёт в историю операций."
                  : "Критичное действие: будет записано в историю и повлияет на баланс ученика."}
              </p>
            ) : null}
          </div>
        ) : null}

        <div className="pay-actions">
          {step > 1 ? (
            <button type="button" className="pay-btn" disabled={busy} onClick={() => setStep((s) => s - 1)}>
              Назад
            </button>
          ) : (
            <button type="button" className="pay-btn" onClick={onClose}>Отмена</button>
          )}
          {step < 4 ? (
            <button type="button" className="pay-btn pay-btn--primary" onClick={goNext}>
              Далее
            </button>
          ) : (
            <button
              type="button"
              className="pay-btn pay-btn--primary"
              disabled={busy}
              onClick={() => void submit()}
            >
              {busy ? "Сохраняем…" : "Подтвердить"}
            </button>
          )}
        </div>
      </div>
    </CabinetModal>
  );
}
